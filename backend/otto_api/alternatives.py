"""Cheaper alternatives: catalog pieces with the same label and a lower price, each checked
against the room as a dry run of Replace. Nothing is written."""
import os

from fastapi import APIRouter, HTTPException

from . import ikea
from .agent import AgentError
from .fit import footprint_corners, footprints_overlap, outside_walls
from .place import add_item

router = APIRouter()

KEYS = ("id", "title", "label", "url", "price", "currency", "size", "rgba", "model", "photo", "shape")


def replace_problems(room, objects, item, name):
    """What would be wrong if item replaced the object called name. Empty if it fits."""
    new_objects, new_name = add_item(room, objects, item, replace=name)
    new = next(o for o in new_objects if o["name"] == new_name)
    corners = footprint_corners(new["pos"], new["size"], new["yaw"])
    problems = []
    if outside_walls(corners, room["size_xy"]):
        problems.append("Goes through a wall")
    for o in new_objects:
        if o["name"] in (name, new_name) or o.get("hidden"):
            continue
        if footprints_overlap(corners, footprint_corners(o["pos"], o["size"], o["yaw"])):
            title = (o.get("product") or {}).get("title")
            problems.append(f"Overlaps {title or o.get('label') or o['name']}")
    ceiling = room.get("ceiling_height")
    if ceiling and item["size"][2] > ceiling + 0.001:
        problems.append("Taller than the ceiling")
    return problems


@router.get("/api/rooms/{room_id}/objects/{name}/alternatives")
def get_alternatives(room_id: str, name: str):
    from . import main
    with main.lock:
        scene = main.load_scene(room_id)
        catalog = main.load_catalog()
    obj = main.find_object(scene, name)
    if obj.get("hidden"):
        raise HTTPException(404, "Object not found")
    product = obj.get("product") or {}
    price = product.get("price")
    currency = product.get("currency") or "USD"
    alternatives = []
    if price is not None and obj.get("movable", True):
        for item in catalog:
            if (
                item["label"].lower() != (obj.get("label") or "").lower()
                or item["id"] == obj.get("catalog_id")
                or item.get("currency") != currency
                or item["price"] >= price
            ):
                continue
            problems = replace_problems(scene["room"], scene["objects"], item, name)
            alternatives.append({
                **{k: item[k] for k in KEYS if k in item},
                "savings": round(price - item["price"], 2),
                "savings_pct": round((price - item["price"]) / price * 100),
                "fits": not problems,
                "problems": problems,
            })
        alternatives.sort(key=lambda a: (not a["fits"], -a["savings"], a["title"]))
    return {"object": name, "price": price, "currency": currency, "alternatives": alternatives}


def load_visible(room_id, name):
    """(scene, object) for a piece that is in the room. 404 if it is missing or hidden."""
    from . import main
    with main.lock:
        scene = main.load_scene(room_id)
    obj = main.find_object(scene, name)
    if obj.get("hidden"):
        raise HTTPException(404, "Object not found")
    return scene, obj


@router.post("/api/rooms/{room_id}/objects/{name}/alternatives/ikea")
def get_ikea_alternatives(room_id: str, name: str):
    """Look for similar pieces on IKEA, live. Like the catalog list, each is fit-checked and nothing is written."""
    from . import main
    scene, obj = load_visible(room_id, name)
    product = obj.get("product") or {}
    price = product.get("price")
    currency = product.get("currency") or "USD"
    label = obj.get("label")
    answer = {"object": name, "price": price, "currency": currency, "alternatives": []}
    api_key = os.environ.get("ANTHROPIC_API_KEY")
    if not api_key:
        raise HTTPException(503, "Add ANTHROPIC_API_KEY to .env")
    if not obj.get("movable", True) or not (label or "").strip():
        return {**answer, "message": "This piece can't be swapped, so there is nothing to search for."}
    prompt = ikea.prompt_for(label, product.get("title"), obj["size"], price, currency, obj.get("rgba"))
    try:
        products = ikea.find_products(main.make_client(api_key), prompt)
    except AgentError as e:
        raise HTTPException(502, str(e))
    wanted = {
        "label": label, "size": obj["size"], "price": price, "currency": currency, "own_url": product.get("url"),
    }
    items = ikea.shortlist(products, wanted)
    scene, obj = load_visible(room_id, name)  # the room may have changed during the search
    alternatives = []
    for item in items:
        problems = replace_problems(scene["room"], scene["objects"], item, name)
        alternatives.append({**item, "fits": not problems, "problems": problems})
    alternatives.sort(key=lambda a: (not a["fits"], -(a["savings"] or 0), -a["similarity"], a["title"]))
    alternatives = alternatives[:ikea.MAX_RESULTS]
    kind = "cheaper similar" if price is not None else "similar"
    message = (
        f"Found {len(alternatives)} {kind} piece{'s' if len(alternatives) != 1 else ''} on IKEA."
        if alternatives else f"No {kind} pieces found on IKEA right now."
    )
    return {**answer, "alternatives": alternatives, "message": message}

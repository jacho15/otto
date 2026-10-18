"""Cheaper alternatives: catalog pieces with the same label and a lower price, each checked
against the room as a dry run of Replace. Nothing is written."""
import os

from fastapi import APIRouter, HTTPException

from . import ikea, shops
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


CANT_SWAP = "This piece can't be swapped, so there is nothing to search for."


def piece_of(obj):
    """(label, price, currency) of a room piece."""
    product = obj.get("product") or {}
    return obj.get("label"), product.get("price"), product.get("currency") or "USD"


def found_message(items, price, where, limit):
    kind = "cheaper similar" if price is not None else "similar"
    count = min(len(items), limit)
    if not items:
        return f"No {kind} pieces found {where} right now."
    return f"Found {count} {kind} piece{'s' if count != 1 else ''} {where}."


def ikea_search(obj):
    """The shortlisted IKEA items for a piece (before the fit check), searched live.
    Raise HTTPException if a key is missing or the search fails."""
    from . import main
    label, price, currency = piece_of(obj)
    if not obj.get("movable", True) or not (label or "").strip():
        return {"items": [], "message": CANT_SWAP}
    api_key = os.environ.get("ANTHROPIC_API_KEY")
    if not api_key:
        raise HTTPException(503, "Add ANTHROPIC_API_KEY to .env")
    product = obj.get("product") or {}
    prompt = ikea.prompt_for(label, product.get("title"), obj["size"], price, currency, obj.get("rgba"))
    client = main.make_client(api_key)
    try:
        products = ikea.find_products(client, prompt)
    except AgentError as e:
        raise HTTPException(502, str(e))
    wanted = {
        "label": label, "size": obj["size"], "price": price, "currency": currency, "own_url": product.get("url"),
        "obj": obj, "client": client,
    }
    items = ikea.shortlist(products, wanted)
    return {"items": items, "message": found_message(items, price, "on IKEA", ikea.MAX_RESULTS)}


def shops_search(obj):
    """The shortlisted shop items for a piece (before the fit check), searched live.
    Raise HTTPException if a key is missing or the search fails."""
    from . import main
    label, price, currency = piece_of(obj)
    if not obj.get("movable", True) or not (label or "").strip():
        return {"items": [], "message": CANT_SWAP}
    if price is not None and currency != "USD":
        message = f"Shop prices are in USD, so they can't be compared with a price in {currency}."
        return {"items": [], "message": message}
    serp_key = os.environ.get("SERPAPI_API_KEY")
    if not serp_key:
        raise HTTPException(503, "Add SERPAPI_API_KEY to .env")
    api_key = os.environ.get("ANTHROPIC_API_KEY")
    if not api_key:
        raise HTTPException(503, "Add ANTHROPIC_API_KEY to .env")
    wanted = {"label": label, "size": obj["size"], "price": price, "currency": currency, "rgba": obj.get("rgba"), "obj": obj}
    try:
        items = shops.find_items(main.make_client(api_key), serp_key, wanted)
    except AgentError as e:
        raise HTTPException(502, str(e))
    return {"items": items, "message": found_message(items, price, "in other shops", shops.MAX_RESULTS)}


def fit_checked(room_id, name, items, limit):
    """The items with their fit against the room as it is now, fits first, at most limit."""
    scene, _ = load_visible(room_id, name)  # the room may have changed during the search
    alternatives = []
    for item in items:
        problems = replace_problems(scene["room"], scene["objects"], item, name)
        alternatives.append({**item, "fits": not problems, "problems": problems})
    alternatives.sort(key=lambda a: (not a["fits"], a.get("look") is None, -a["similarity"], -(a["savings"] or 0), a["title"]))
    return alternatives[:limit]


def search_answer(room_id, name, obj, found, limit):
    _, price, currency = piece_of(obj)
    return {
        "object": name, "price": price, "currency": currency,
        "alternatives": fit_checked(room_id, name, found["items"], limit),
        "message": found["message"],
    }


@router.post("/api/rooms/{room_id}/objects/{name}/alternatives/ikea")
def get_ikea_alternatives(room_id: str, name: str):
    """Look for similar pieces on IKEA, live. Like the catalog list, each is fit-checked and nothing in the room
    is written."""
    _, obj = load_visible(room_id, name)
    return search_answer(room_id, name, obj, ikea_search(obj), ikea.MAX_RESULTS)


@router.post("/api/rooms/{room_id}/objects/{name}/alternatives/shops")
def get_shop_alternatives(room_id: str, name: str):
    """Look for similar pieces in other shops (Google Shopping through SerpApi), live. Prices are the listed ones
    and sizes are estimated. Like the IKEA list, each is fit-checked and nothing in the room is written."""
    _, obj = load_visible(room_id, name)
    return search_answer(room_id, name, obj, shops_search(obj), shops.MAX_RESULTS)

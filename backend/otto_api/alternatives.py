"""Cheaper alternatives: catalog pieces with the same label and a lower price, each checked
against the room as a dry run of Replace. Nothing is written."""
from fastapi import APIRouter, HTTPException

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

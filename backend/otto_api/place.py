"""Add a catalog item to a room. Pure functions, no file access."""
import math

from .fit import footprint_corners, footprints_overlap, outside_walls

STEP = 0.05  # 5 cm grid
YAWS = (0.0, math.pi / 2)
CLEARANCES = (0.6, 0.3, 0.0)  # metres kept free around a new piece: a walkway first, then less


def bounds(corners):
    xs, ys = [c[0] for c in corners], [c[1] for c in corners]
    return min(xs), max(xs), min(ys), max(ys)


def free_spot(room, objects, size):
    """Nearest (x, y, yaw) to the room centre inside the walls with no overlap.

    Prefers a spot with a 60 cm walkway to other pieces, then 30 cm, then any free spot.
    Falls back to the centre with yaw 0 if nothing is free.
    """
    hx, hy = room["size_xy"][0] / 2, room["size_xy"][1] / 2
    nx, ny = int(hx / STEP), int(hy / STEP)
    spots = sorted(
        ((i * STEP, j * STEP) for i in range(-nx, nx + 1) for j in range(-ny, ny + 1)),
        key=lambda p: (math.hypot(*p), p),
    )
    others = []
    for o in objects:
        if not o.get("hidden"):
            c = footprint_corners(o["pos"], o["size"], o["yaw"])
            others.append((bounds(c), c))
    for gap in CLEARANCES:
        padded = (size[0] + 2 * gap, size[1] + 2 * gap, size[2])
        for x, y in spots:
            for yaw in YAWS:
                if outside_walls(footprint_corners((x, y), size, yaw), room["size_xy"]):
                    continue
                corners = footprint_corners((x, y), padded, yaw)
                x0, x1, y0, y1 = bounds(corners)
                if not any(
                    ox0 < x1 and x0 < ox1 and oy0 < y1 and y0 < oy1 and footprints_overlap(corners, c)
                    for (ox0, ox1, oy0, oy1), c in others
                ):
                    return x, y, yaw
    return 0.0, 0.0, 0.0


def nudge_inside(room, pos, size, yaw):
    """Shift pos inward along x and y by the overshoot. Unchanged if it fits."""
    corners = footprint_corners(pos, size, yaw)
    if not outside_walls(corners, room["size_xy"]):
        return pos[0], pos[1]
    hx, hy = room["size_xy"][0] / 2, room["size_xy"][1] / 2
    xs = [c[0] for c in corners]
    ys = [c[1] for c in corners]
    dx = max(0.0, -hx - min(xs)) + min(0.0, hx - max(xs))
    dy = max(0.0, -hy - min(ys)) + min(0.0, hy - max(ys))
    return pos[0] + dx, pos[1] + dy


def unique_name(catalog_id, objects):
    base = catalog_id.replace("-", "_")
    taken = {o["name"] for o in objects}
    name, n = base, 1
    while name in taken:
        n += 1
        name = f"{base}_{n}"
    return name


def catalog_object(item, name, pos, yaw):
    """A room object for a catalog item. An item with no model gets a stand-in box of its label.

    A custom item's model is an /api/... URL of any size, so it is scaled to the item size."""
    custom = item.get("custom")
    mesh = item["model"] if custom else f"catalog/{item['model']}" if item["model"] else None
    obj = {
        "name": name,
        "label": item["label"],
        "source": "catalog",
        "catalog_id": item["id"],
        "mesh": mesh,
        "pos": [pos[0], pos[1], 0.0],
        "yaw": yaw,
        "size": item["size"],
        "movable": True,
        "rgba": item["rgba"],
        "product": {
            "title": item["title"],
            "url": item["url"],
            "price": item["price"],
            "currency": item["currency"],
        },
    }
    if item.get("price_source"):
        obj["product"]["price_source"] = item["price_source"]
    if custom and item["model"]:
        obj["normalize"] = True
    if not item["model"]:
        obj["shape"] = item.get("shape", item["label"])
    return obj


def add_at(room, objects, item, pos, yaw):
    """Return (new object list, new object name) with the item exactly at pos and yaw.

    Return None if the footprint leaves the walls or overlaps a visible object.
    """
    corners = footprint_corners(pos, item["size"], yaw)
    if outside_walls(corners, room["size_xy"]):
        return None
    for o in objects:
        if not o.get("hidden") and footprints_overlap(corners, footprint_corners(o["pos"], o["size"], o["yaw"])):
            return None
    name = unique_name(item["id"], objects)
    return objects + [catalog_object(item, name, pos, yaw)], name


def add_item(room, objects, item, replace=None):
    """Return (new object list, new object name). Inputs are not changed.

    replace is the name of an object in the list, or None.
    """
    target = next((o for o in objects if o["name"] == replace), None) if replace else None
    size = item["size"]
    if target:
        yaw = target["yaw"]
        x, y = nudge_inside(room, target["pos"], size, yaw)
    else:
        x, y, yaw = free_spot(room, objects, size)
    name = unique_name(item["id"], objects)
    new = catalog_object(item, name, (x, y), yaw)
    if target:
        new["replaces"] = target["name"]
    objects = [{**o, "hidden": True} if o is target else o for o in objects]
    return objects + [new], name

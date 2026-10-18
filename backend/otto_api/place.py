"""Add a catalog item to a room. Pure functions, no file access."""
import math

from .fit import footprint_corners, footprints_overlap, outside_walls

STEP = 0.05  # 5 cm grid
YAWS = (0.0, math.pi / 2)


def free_spot(room, objects, size):
    """Nearest (x, y, yaw) to the room centre inside the walls with no overlap.

    Falls back to the centre with yaw 0 if nothing is free.
    """
    hx, hy = room["size_xy"][0] / 2, room["size_xy"][1] / 2
    nx, ny = int(hx / STEP), int(hy / STEP)
    spots = sorted(
        ((i * STEP, j * STEP) for i in range(-nx, nx + 1) for j in range(-ny, ny + 1)),
        key=lambda p: (math.hypot(*p), p),
    )
    others = [
        footprint_corners(o["pos"], o["size"], o["yaw"])
        for o in objects
        if not o.get("hidden")
    ]
    for x, y in spots:
        for yaw in YAWS:
            corners = footprint_corners((x, y), size, yaw)
            if outside_walls(corners, room["size_xy"]):
                continue
            if not any(footprints_overlap(corners, c) for c in others):
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
    new = {
        "name": name,
        "label": item["label"],
        "source": "catalog",
        "catalog_id": item["id"],
        "mesh": f"meshes/{item['id']}.glb",
        "pos": [x, y, 0.0],
        "yaw": yaw,
        "size": size,
        "movable": True,
        "rgba": item["rgba"],
        "product": {
            "title": item["title"],
            "url": item["url"],
            "price": item["price"],
            "currency": item["currency"],
        },
    }
    if target:
        new["replaces"] = target["name"]
    objects = [{**o, "hidden": True} if o is target else o for o in objects]
    return objects + [new], name

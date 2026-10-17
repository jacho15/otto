"""Footprint fit checks. Pure 2D functions, heights are ignored."""
import math

TOL = 0.001  # 1 mm


def footprint_corners(pos, size, yaw):
    """Corners of the w x d footprint centred at pos, rotated CCW by yaw."""
    hw, hd = size[0] / 2, size[1] / 2
    c, s = math.cos(yaw), math.sin(yaw)
    return [
        (pos[0] + lx * c - ly * s, pos[1] + lx * s + ly * c)
        for lx, ly in ((-hw, -hd), (hw, -hd), (hw, hd), (-hw, hd))
    ]


def _axes(corners):
    axes = []
    for i in range(2):
        ex = corners[i + 1][0] - corners[i][0]
        ey = corners[i + 1][1] - corners[i][1]
        n = math.hypot(ex, ey)
        if n > 0:  # a zero-length edge has no direction, skip it
            axes.append((-ey / n, ex / n))
    return axes


def _project(corners, axis):
    vals = [x * axis[0] + y * axis[1] for x, y in corners]
    return min(vals), max(vals)


def footprints_overlap(a, b, tol=TOL):
    """Separating axis test. Overlap depth of tol or less counts as touching."""
    for axis in _axes(a) + _axes(b):
        amin, amax = _project(a, axis)
        bmin, bmax = _project(b, axis)
        if min(amax, bmax) - max(amin, bmin) <= tol:
            return False
    return True


def outside_walls(corners, size_xy, tol=TOL):
    """True if any corner is outside the interior floor by more than tol."""
    hx, hy = size_xy[0] / 2, size_xy[1] / 2
    return any(abs(x) > hx + tol or abs(y) > hy + tol for x, y in corners)


def find_warnings(room, objects):
    """Overlap and wall warnings for a list of scene objects."""
    corners = {
        o["name"]: footprint_corners(o["pos"], o["size"], o["yaw"]) for o in objects
    }
    warnings = []
    for i, a in enumerate(objects):
        for b in objects[i + 1:]:
            if footprints_overlap(corners[a["name"]], corners[b["name"]]):
                warnings.append({"type": "overlap", "objects": [a["name"], b["name"]]})
    for o in objects:
        if outside_walls(corners[o["name"]], room["size_xy"]):
            warnings.append({"type": "wall", "object": o["name"]})
    return warnings

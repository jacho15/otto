import math

import pytest

from otto_api.fit import (
    find_warnings,
    footprint_corners,
    footprints_overlap,
    outside_walls,
)


def box(x, y, w=1.0, d=1.0, yaw=0.0):
    return footprint_corners([x, y, 0], [w, d, 1], yaw)


def test_corners_yaw_0():
    c = footprint_corners([1, 2, 0], [2, 1, 1], 0)
    expected = [(0, 1.5), (2, 1.5), (2, 2.5), (0, 2.5)]
    for got, want in zip(c, expected):
        assert got == pytest.approx(want)


def test_corners_yaw_90():
    c = footprint_corners([1, 2, 0], [2, 1, 1], math.pi / 2)
    expected = [(1.5, 1), (1.5, 3), (0.5, 3), (0.5, 1)]
    for got, want in zip(c, expected):
        assert got == pytest.approx(want)


def test_overlap_yes():
    assert footprints_overlap(box(0, 0), box(0.5, 0.5))


def test_overlap_no():
    assert not footprints_overlap(box(0, 0), box(2, 0))


def test_flush_contact_is_not_overlap():
    assert not footprints_overlap(box(0, 0), box(1.0, 0))


def test_overlap_within_tolerance_is_not_overlap():
    assert not footprints_overlap(box(0, 0), box(0.9995, 0))


def test_overlap_beyond_tolerance():
    assert footprints_overlap(box(0, 0), box(0.99, 0))


def test_rotated_overlap():
    # A 2 x 0.2 plank crossing the middle of a 2 x 2 box once rotated.
    assert footprints_overlap(box(0, 0, 2, 2), box(0, 0, 2, 0.2, math.pi / 2))
    # A diamond whose tip reaches into the box.
    assert footprints_overlap(box(0, 0, 2, 2), box(1.1, 0.9, 1, 1, math.pi / 4))


def test_rotated_boxes_apart():
    # Axis-aligned bounding boxes would overlap here, the shapes do not.
    a = box(0, 0, 2, 0.2, math.pi / 4)
    b = box(0.9, -0.9, 2, 0.2, math.pi / 4)
    assert not footprints_overlap(a, b)
    assert not footprints_overlap(box(0, 0, 2, 2), box(2.2, 1.9, 1, 1, math.pi / 4))


def test_wall_inside_and_flush():
    assert not outside_walls(box(0, 0), [5, 4])
    assert not outside_walls(box(2.0, 1.5), [5, 4])


def test_wall_outside():
    assert outside_walls(box(2.2, 0), [5, 4])
    assert not outside_walls(box(2.0005, 1.5), [5, 4])


def test_wall_rotated_corner():
    assert outside_walls(box(2.0, 0, 1, 1, math.pi / 4), [5, 4])


def test_find_warnings():
    room = {"size_xy": [5, 4]}
    objs = [
        {"name": "a", "pos": [0, 0, 0], "size": [1, 1, 1], "yaw": 0},
        {"name": "b", "pos": [0.5, 0, 0], "size": [1, 1, 1], "yaw": 0},
        {"name": "c", "pos": [2.4, 0, 0], "size": [1, 1, 1], "yaw": 0},
    ]
    w = find_warnings(room, objs)
    assert {"type": "overlap", "objects": ["a", "b"]} in w
    assert {"type": "wall", "object": "c"} in w
    assert len(w) == 2


def test_zero_width_does_not_crash():
    # Zero-length axes are skipped. The zero-width piece keeps one axis (x),
    # where it has no extent, so the overlap depth is 0 and it counts as touching.
    assert not footprints_overlap(box(0, 0, 0, 1), box(0, 0, 1, 1))
    assert not footprints_overlap(box(0, 0, 0, 0), box(0, 0, 1, 1))
    room = {"size_xy": [5, 4]}
    objs = [
        {"name": "a", "pos": [0, 0, 0], "size": [0, 0, 1], "yaw": 0},
        {"name": "b", "pos": [0, 0, 0], "size": [1, 1, 1], "yaw": 0},
    ]
    assert find_warnings(room, objs) == []


# Parity cases, shared with the frontend geometry tests.
def test_parity_flush():
    assert not footprints_overlap(box(0, 0), box(1, 0))


def test_parity_just_overlapping():
    assert footprints_overlap(box(0, 0), box(0.998, 0))


def test_parity_rotated_quarter_turn():
    assert footprints_overlap(box(0, 0, 2, 0.5), box(0, 0, 2, 0.5, math.pi / 2))


def test_parity_diagonal():
    # Half diagonal 0.7071 + half width 0.5 = 1.2071 > 1.2, so they overlap.
    assert footprints_overlap(box(0, 0, 1, 1, math.pi / 4), box(1.2, 0))


def test_parity_wall_flush_and_beyond():
    assert not outside_walls(box(1.5, 0), [4, 3])
    assert outside_walls(box(1.502, 0), [4, 3])

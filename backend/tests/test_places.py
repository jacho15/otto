import json
import math
import re
import subprocess
import sys
import time
from pathlib import Path

import pytest

from conftest import ROOM
from otto_api import main
from otto_api.fit import footprint_corners
from otto_api.places import candidate_spots, front_faces_wall
from test_agent import FakeApi, text

ROOMS = "/api/rooms"
SAVED = "/api/saved"
DESIGN = f"/api/rooms/{ROOM}/agent/design"
BLUEPRINT = {"name": "My New Flat!", "width": 5, "depth": 4, "height": 2.6}


def call(tool, **args):
    return {"type": "tool_use", "id": f"toolu_{tool}", "name": tool, "input": args}


def test_create_blueprint(client, data_dir):
    r = client.post(ROOMS, json=BLUEPRINT)
    assert r.status_code == 200
    body = r.json()
    assert re.fullmatch(r"my-new-flat-[0-9a-f]{6}", body["id"]) and main.ROOM_ID.match(body["id"])
    assert body["objects"] == [] and body["warnings"] == []
    assert body["room"] == {"size_xy": [5, 4], "ceiling_height": 2.6, "wall_thickness": 0.1, "kind": "blueprint"}
    assert (data_dir / "rooms" / body["id"] / "meshes").is_dir()
    assert client.get(f"{ROOMS}/{body['id']}").json() == body
    kinds = {r["id"]: r["kind"] for r in client.get(ROOMS).json()}
    assert kinds == {ROOM: "scan", body["id"]: "blueprint"}


def test_slug_fallback(client):
    assert client.post(ROOMS, json={**BLUEPRINT, "name": "???"}).json()["id"].startswith("place-")


@pytest.mark.parametrize("change", [
    {"name": ""}, {"name": "x" * 61}, {"width": 1.4}, {"width": 15.1}, {"depth": 1}, {"depth": 16},
    {"height": 1.9}, {"height": 4.1}, {"width": "wide"},
])
def test_create_validation(client, change):
    assert client.post(ROOMS, json={**BLUEPRINT, **change}).status_code == 422


def test_saved_flow(client):
    assert client.get(SAVED).json() == []
    assert client.post(SAVED, json={"catalog_id": "nope"}).status_code == 404
    client.post(SAVED, json={"catalog_id": "small-chair", "note": "for the desk"})
    saved = client.post(SAVED, json={"catalog_id": "big-table"}).json()
    assert [s["catalog_id"] for s in saved] == ["big-table", "small-chair"]
    assert saved[1]["note"] == "for the desk" and saved[1]["item"]["title"] == "small-chair title"
    assert saved[0]["saved_at"]
    updated = client.post(SAVED, json={"catalog_id": "small-chair", "note": "new"}).json()
    assert len(updated) == 2 and {s["catalog_id"]: s["note"] for s in updated}["small-chair"] == "new"
    assert client.post(SAVED, json={"catalog_id": "big-table", "note": "x" * 201}).status_code == 422
    left = client.delete(f"{SAVED}/big-table").json()
    assert [s["catalog_id"] for s in left] == ["small-chair"]
    assert client.get(SAVED).json() == left


@pytest.fixture
def design(client, monkeypatch):
    monkeypatch.setenv("ANTHROPIC_API_KEY", "test-key")

    def run(api, instruction="lay it out"):
        monkeypatch.setattr(main, "make_client", lambda key: api.client())
        return client.post(DESIGN, json={"instruction": instruction})

    return run


def objects(client):
    return {o["name"]: o for o in client.get(f"{ROOMS}/{ROOM}").json()["objects"]}


def test_request_shape(design):
    api = FakeApi([[text("ok")]])
    design(api)
    body = api.body(0)
    assert body["model"] == "claude-opus-5-5"
    assert body["thinking"] == {"type": "adaptive"} and body["output_config"] == {"effort": "medium"}
    assert body["fallbacks"] == "default"
    for key in ("temperature", "tool_choice"):
        assert key not in body
    names = [t["name"] for t in body["tools"]]
    assert names == ["get_room", "get_catalog", "get_saved", "get_mandate", "find_spots", "place_item", "move_item", "remove_item"]
    for t in body["tools"]:
        schema = t["input_schema"]
        assert t["strict"] and schema["additionalProperties"] is False
        assert set(schema.get("required", [])) == set(schema["properties"])


def test_read_tools(design, client):
    client.post(SAVED, json={"catalog_id": "small-chair", "note": "keep"})
    api = FakeApi([
        [call("get_room")], [call("get_saved")], [call("get_mandate")], [text("done")],
    ])
    design(api)
    room = json.loads(api.result_text(1))
    assert room["room_size"] == [5.0, 4.0]
    assert {o["name"] for o in room["objects"]} == {"sofa", "chair", "shelf"}
    assert all(o["placed_by_agent"] is False for o in room["objects"])
    saved = json.loads(api.result_text(2))
    assert saved[0]["id"] == "small-chair" and saved[0]["note"] == "keep"
    assert json.loads(api.result_text(3)) is None


def test_find_spots(design):
    api = FakeApi([
        [call("find_spots", catalog_id="small-chair", near=None, against_wall=True)],
        [call("find_spots", catalog_id="small-chair", near="chair", against_wall=False)],
        [call("find_spots", catalog_id="small-chair", near="nobody", against_wall=False)],
        [text("ok")],
    ])
    design(api)
    wall = json.loads(api.result_text(1))
    assert 1 <= len(wall) <= 5
    for s in wall:
        # 5 x 4 room, 0.5 deep piece: back edge flush means the centre is 0.25 m from a wall.
        assert abs(s["x"]) == pytest.approx(2.25) or abs(s["y"]) == pytest.approx(1.75)
        assert s["note"]
    near = json.loads(api.result_text(2))
    dist = [((s["x"] + 1) ** 2 + (s["y"] + 1) ** 2) ** 0.5 for s in near]
    assert dist == sorted(dist) and len(near) == 5 and dist[0] >= 0.5
    assert api.tool_results(3)[0]["is_error"]


def test_place_item(design, client, data_dir):
    api = FakeApi([
        [call("place_item", catalog_id="small-chair", x=1.0, y=-1.0, yaw_degrees=90)],
        [text("I put a chair by the window.")],
    ])
    r = design(api)
    assert r.status_code == 200
    body = r.json()
    assert json.loads(api.result_text(1)) == {"name": "small_chair"}
    assert body["message"] == "I put a chair by the window."
    assert body["changes"] == [{"action": "placed", "name": "small_chair", "title": "small-chair title"}]
    placed = {o["name"]: o for o in body["room"]["objects"]}["small_chair"]
    assert placed["pos"] == [1.0, -1.0, 0.0] and abs(placed["yaw"] - 1.5708) < 1e-3
    assert body["room"]["warnings"] == []
    assert objects(client)["small_chair"] == placed
    assert (data_dir / "rooms" / ROOM / "meshes" / "small-chair.glb").is_file()


def test_rejected_placements_leave_room_unchanged(design, client):
    before = client.get(f"{ROOMS}/{ROOM}").json()
    api = FakeApi([
        [call("place_item", catalog_id="small-chair", x=0.0, y=1.0, yaw_degrees=0)],
        [call("place_item", catalog_id="small-chair", x=2.4, y=0.0, yaw_degrees=0)],
        [call("place_item", catalog_id="wide-bench", x=0.0, y=-1.8, yaw_degrees=0)],
        [text("Could not place it.")],
    ])
    r = design(api)
    assert r.json()["changes"] == []
    for turn in (1, 2, 3):
        assert api.tool_results(turn)[0]["is_error"] is True
    assert "overlaps sofa" in api.result_text(1)
    assert "wall" in api.result_text(2)
    assert "wall" in api.result_text(3)
    assert client.get(f"{ROOMS}/{ROOM}").json() == before


def test_move_item(design, client):
    api = FakeApi([
        [call("move_item", name="chair", x=-2.0, y=-1.0, yaw_degrees=180)],
        [call("move_item", name="shelf", x=2.0, y=1.0, yaw_degrees=0)],
        [call("move_item", name="chair", x=0.0, y=1.0, yaw_degrees=0)],
        [text("Moved the chair.")],
    ])
    r = design(api)
    assert r.json()["changes"] == [{"action": "moved", "name": "chair", "title": "chair"}]
    assert api.tool_results(2)[0]["is_error"] and "not movable" in api.result_text(2)
    assert api.tool_results(3)[0]["is_error"]
    chair = objects(client)["chair"]
    assert chair["pos"] == [-2.0, -1.0, 0.0] and abs(chair["yaw"] - 3.1416) < 1e-3
    assert objects(client)["shelf"]["pos"] == [2.0, 0.0, 0.0]


def test_remove_only_own_pieces(design, client):
    api = FakeApi([
        [call("remove_item", name="sofa")],
        [call("place_item", catalog_id="small-chair", x=1.0, y=-1.0, yaw_degrees=0)],
        [call("remove_item", name="small_chair")],
        [text("Tried again.")],
    ])
    r = design(api)
    assert api.tool_results(1)[0]["is_error"] and "not placed by you" in api.result_text(1)
    assert [(c["action"], c["name"]) for c in r.json()["changes"]] == [
        ("placed", "small_chair"), ("removed", "small_chair"),
    ]
    assert set(objects(client)) == {"sofa", "chair", "shelf"}


def test_hidden_objects_are_ignored(design, client, data_dir):
    path = data_dir / "rooms" / ROOM / "scene.json"
    scene = json.loads(path.read_text("utf-8"))
    scene["objects"][0]["hidden"] = True
    path.write_text(json.dumps(scene), "utf-8")
    api = FakeApi([
        [call("get_room")],
        [call("place_item", catalog_id="small-chair", x=0.0, y=1.0, yaw_degrees=0)],
        [call("move_item", name="sofa", x=0.0, y=0.0, yaw_degrees=0)],
        [text("ok")],
    ])
    design(api)
    assert "sofa" not in {o["name"] for o in json.loads(api.result_text(1))["objects"]}
    assert not api.tool_results(2)[0].get("is_error")
    assert api.tool_results(3)[0]["is_error"]


def test_agent_has_no_buying_or_mandate_tools(design):
    api = FakeApi([[text("ok")]])
    design(api)
    names = {t["name"] for t in api.body(0)["tools"]}
    assert names.isdisjoint({"propose_order", "approve_order", "set_mandate", "delete_object"})


def test_api_error_is_502(design):
    r = design(FakeApi([[]], status=500))
    assert r.status_code == 502 and "API error (500)" in r.json()["detail"]


def test_no_api_key_is_503(client):
    r = client.post(DESIGN, json={"instruction": "lay it out"})
    assert r.status_code == 503
    assert r.json()["detail"] == "Add ANTHROPIC_API_KEY to .env"


def test_design_validation(client):
    assert client.post(DESIGN, json={"instruction": ""}).status_code == 422
    assert client.post("/api/rooms/nope/agent/design", json={"instruction": "x"}).status_code == 404


def test_wall_spots_face_into_the_room():
    # Fronts face local -y: yaw 0 at the +y wall, 180 at -y, 90 at the -x wall, -90 at the +x wall.
    room = {"size_xy": [6.0, 4.0]}
    spots = candidate_spots(room, [], [1.0, 0.5, 0.8], against_wall=True, limit=10000)
    expected = {"y=2": 0.0, "y=-2": 180.0, "x=-3": 90.0, "x=3": -90.0}
    seen = set()
    for s in spots:
        wall = s["note"].rsplit(" ", 1)[1]
        assert s["yaw_degrees"] == expected[wall]
        # The front points at (sin yaw, -cos yaw), which must point from the wall to the centre.
        fx, fy = math.sin(math.radians(s["yaw_degrees"])), -math.cos(math.radians(s["yaw_degrees"]))
        assert fx * s["x"] + fy * s["y"] < 0
        seen.add(wall)
    assert seen == set(expected)


WALL_CASES = [
    # wall, centre of a 1.0 x 0.5 piece with its back flush, correct yaw
    ("y=-2", (0.0, -1.75), 180),
    ("y=2", (0.0, 1.75), 0),
    ("x=-3", (-2.75, 0.0), 90),
    ("x=3", (2.75, 0.0), -90),
]


def wall_check(pos, yaw):
    corners = footprint_corners(pos, [1.0, 0.5, 0.8], math.radians(yaw))
    return front_faces_wall(corners, [6.0, 4.0], yaw)


@pytest.mark.parametrize("wall, pos, good", WALL_CASES)
def test_front_faces_wall_helper(wall, pos, good):
    assert wall_check(pos, good) is None
    assert wall_check(pos, good + 360) is None
    assert wall_check(pos, good + 180) == (wall, good)
    # Sideways to the wall is fine.
    assert wall_check(pos, good + 90) is None


def test_front_faces_wall_ignores_the_middle_of_the_room():
    for yaw in range(-180, 360, 15):
        assert wall_check((0.0, 0.0), yaw) is None
        assert wall_check((1.0, -0.8), yaw) is None
    # More than 5 cm from the wall is not "at" the wall.
    assert wall_check((0.0, -1.6), 0) is None


def test_flipped_wall_yaw_is_rejected_then_fixed(design, client):
    api = FakeApi([
        [call("place_item", catalog_id="wide-bench", x=0.0, y=-1.7, yaw_degrees=0)],
        [call("place_item", catalog_id="wide-bench", x=0.0, y=-1.7, yaw_degrees=180)],
        [call("move_item", name="chair", x=-2.2, y=-1.0, yaw_degrees=-90)],
        [call("move_item", name="chair", x=-2.2, y=-1.0, yaw_degrees=90)],
        [text("Done.")],
    ])
    r = design(api)
    assert api.tool_results(1)[0]["is_error"]
    assert "face the wall at y=-2" in api.result_text(1) and "yaw_degrees=180" in api.result_text(1)
    assert not api.tool_results(2)[0].get("is_error")
    assert api.tool_results(3)[0]["is_error"] and "yaw_degrees=90" in api.result_text(3)
    assert not api.tool_results(4)[0].get("is_error")
    assert [(c["action"], c["name"]) for c in r.json()["changes"]] == [("placed", "wide_bench"), ("moved", "chair")]
    objs = objects(client)
    assert objs["wide_bench"]["pos"] == [0.0, -1.7, 0.0] and abs(objs["wide_bench"]["yaw"] - math.pi) < 1e-3
    assert objs["chair"]["pos"] == [-2.2, -1.0, 0.0] and abs(objs["chair"]["yaw"] - math.pi / 2) < 1e-3


def test_crowded_large_room_is_fast():
    # A packed room is the worst case: no spot fits, so every candidate is checked.
    room = {"size_xy": [15.0, 15.0]}
    objects = [
        {"name": f"o{i}", "pos": [-7.2 + i % 15, -7.2 + i // 15, 0.0], "size": [1.0, 1.0, 1.0], "yaw": 0.0}
        for i in range(225)
    ]
    start = time.perf_counter()
    assert candidate_spots(room, objects, [1.0, 1.0, 1.0]) == []
    assert candidate_spots(room, objects, [1.0, 1.0, 1.0], against_wall=True) == []
    assert time.perf_counter() - start < 2


def test_places_imports_on_its_own():
    code = "import otto_api.places"
    r = subprocess.run([sys.executable, "-c", code], capture_output=True, text=True, cwd=Path(__file__).parent.parent)
    assert r.returncode == 0, r.stderr

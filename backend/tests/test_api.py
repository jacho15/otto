import json
import math

ROOM = "test-room"
SOFA = "sofa"
OBJ_URL = f"/api/rooms/{ROOM}/objects/{SOFA}"


def saved(data_dir):
    return json.loads((data_dir / "rooms" / ROOM / "scene.json").read_text("utf-8"))


def test_list_rooms(client):
    r = client.get("/api/rooms")
    assert r.status_code == 200
    assert r.json() == [
        {"id": ROOM, "name": "Test Room", "kind": "scan", "size_xy": [5.0, 4.0], "object_count": 3}
    ]


def test_get_room(client):
    r = client.get(f"/api/rooms/{ROOM}")
    assert r.status_code == 200
    body = r.json()
    assert body["id"] == ROOM
    assert body["name"] == "Test Room"
    assert body["room"]["size_xy"] == [5.0, 4.0]
    assert len(body["objects"]) == 3
    assert isinstance(body["warnings"], list)
    assert body["total"]["currency"] == "USD"
    prices = [o["product"]["price"] for o in body["objects"] if "product" in o]
    assert body["total"]["amount"] == 499.5


def test_get_room_zero_size_object(client, data_dir):
    scene = saved(data_dir)
    scene["objects"][1]["size"] = [0, 0, 0.8]
    (data_dir / "rooms" / ROOM / "scene.json").write_text(json.dumps(scene), "utf-8")
    assert client.get(f"/api/rooms/{ROOM}").status_code == 200
    assert client.patch(OBJ_URL, json={"yaw": 1}).status_code == 200


def test_unknown_or_bad_room_id(client):
    assert client.get("/api/rooms/nope").status_code == 404
    assert client.get("/api/rooms/Bad_ID").status_code == 404
    assert client.get("/api/rooms/-x").status_code == 404
    assert client.patch("/api/rooms/nope/objects/x", json={"yaw": 1}).status_code == 404
    assert client.delete("/api/rooms/nope/objects/x").status_code == 404


def test_patch_pos_saves_to_disk(client, data_dir):
    r = client.patch(OBJ_URL, json={"pos": [0.25, -0.5]})
    assert r.status_code == 200
    obj = next(o for o in r.json()["objects"] if o["name"] == SOFA)
    assert obj["pos"] == [0.25, -0.5, 0.0]
    disk = next(o for o in saved(data_dir)["objects"] if o["name"] == SOFA)
    assert disk["pos"] == [0.25, -0.5, 0.0]
    assert disk["product"]["price"] == 449.0
    again = next(o for o in client.get(f"/api/rooms/{ROOM}").json()["objects"] if o["name"] == SOFA)
    assert again["pos"] == [0.25, -0.5, 0.0]


def test_patch_yaw_saves_to_disk(client, data_dir):
    before = next(o for o in saved(data_dir)["objects"] if o["name"] == SOFA)["pos"]
    r = client.patch(OBJ_URL, json={"yaw": math.pi / 2})
    assert r.status_code == 200
    disk = next(o for o in saved(data_dir)["objects"] if o["name"] == SOFA)
    assert disk["yaw"] == math.pi / 2
    assert disk["pos"] == before


def test_patch_wall_warning(client):
    r = client.patch(OBJ_URL, json={"pos": [10, 0]})
    assert {"type": "wall", "object": SOFA} in r.json()["warnings"]


def test_patch_unknown_object(client):
    r = client.patch(f"/api/rooms/{ROOM}/objects/nope", json={"yaw": 1})
    assert r.status_code == 404


def test_patch_bad_body(client, data_dir):
    before = saved(data_dir)
    for body in ({"pos": [1]}, {"pos": "x"}, {"yaw": "a"}, {"pos": [1, 2, 3]}):
        assert client.patch(OBJ_URL, json=body).status_code == 422
    for raw in ('{"yaw": NaN}', '{"pos": [Infinity, 0]}', '{"pos": [1e999, 0]}'):
        r = client.patch(OBJ_URL, content=raw, headers={"content-type": "application/json"})
        assert r.status_code == 422, raw
    assert saved(data_dir) == before


def test_patch_not_movable(client, data_dir):
    scene = saved(data_dir)
    assert scene["objects"][2]["movable"] is False
    r = client.patch(f"/api/rooms/{ROOM}/objects/shelf", json={"yaw": 1})
    assert r.status_code == 409


def test_delete(client, data_dir):
    r = client.delete(OBJ_URL)
    assert r.status_code == 200
    assert SOFA not in [o["name"] for o in r.json()["objects"]]
    assert SOFA not in [o["name"] for o in saved(data_dir)["objects"]]
    prices = [o["product"]["price"] for o in r.json()["objects"] if "product" in o]
    assert r.json()["total"]["amount"] == 50.5
    assert client.delete(OBJ_URL).status_code == 404


def test_files_served(client):
    r = client.get(f"/files/{ROOM}/meshes/x.glb")
    assert r.status_code == 200
    assert r.content[:4] == b"glTF"
    assert client.get(f"/files/{ROOM}/meshes/missing.glb").status_code == 404


def test_files_path_traversal_blocked(client, data_dir):
    (data_dir / "secret.txt").write_text("secret")
    (data_dir / "rooms" / "secret.txt").write_text("secret")
    for p in (
        "..%2F..%2Fsecret.txt",
        "..%2Fsecret.txt",
        "%2e%2e/secret.txt",
        "meshes/..%2F..%2F..%2Fsecret.txt",
        "..%5C..%5Csecret.txt",
    ):
        r = client.get(f"/files/{ROOM}/{p}")
        assert r.status_code == 404, p
        assert "secret" not in r.text
    assert client.get("/files/..%2Fsecret.txt").status_code == 404


ROOM_URL = f"/api/rooms/{ROOM}"


def test_set_room_size_saves_and_keeps_furniture(client, data_dir):
    before = saved(data_dir)["objects"]
    r = client.patch(ROOM_URL, json={"width": 6.2, "depth": 4.5, "height": 2.7})
    assert r.status_code == 200
    assert r.json()["room"]["size_xy"] == [6.2, 4.5]
    assert r.json()["room"]["ceiling_height"] == 2.7
    disk = saved(data_dir)
    assert disk["room"]["size_xy"] == [6.2, 4.5]
    assert disk["room"]["wall_thickness"] == 0.1
    assert disk["objects"] == before


def test_set_room_size_smaller_warns_about_walls(client):
    # the shelf sits at x = 2.0 with 0.4 m width: outside a 3 m wide room
    r = client.patch(ROOM_URL, json={"width": 3.0, "depth": 4.0, "height": 2.6})
    assert {"type": "wall", "object": "shelf"} in r.json()["warnings"]


def test_set_room_size_rejects_bad_sizes(client, data_dir):
    before = saved(data_dir)
    for body in (
        {"width": 1.0, "depth": 4.0, "height": 2.6},
        {"width": 5.0, "depth": 16.0, "height": 2.6},
        {"width": 5.0, "depth": 4.0, "height": 5.0},
        {"width": 5.0, "depth": 4.0},
        {"width": "x", "depth": 4.0, "height": 2.6},
    ):
        assert client.patch(ROOM_URL, json=body).status_code == 422, body
    raw = '{"width": NaN, "depth": 4, "height": 2.6}'
    assert client.patch(ROOM_URL, content=raw, headers={"content-type": "application/json"}).status_code == 422
    assert saved(data_dir) == before


def test_set_room_size_unknown_room(client):
    assert client.patch("/api/rooms/nope", json={"width": 5, "depth": 4, "height": 2.6}).status_code == 404

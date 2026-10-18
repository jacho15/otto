import json

from conftest import CATALOG, ROOM
from otto_api.fit import footprint_corners, outside_walls
from otto_api.place import add_item

URL = f"/api/rooms/{ROOM}/objects"


def saved(data_dir):
    return json.loads((data_dir / "rooms" / ROOM / "scene.json").read_text("utf-8"))


def find(objects, name):
    return next(o for o in objects if o["name"] == name)


def test_catalog_list(client):
    r = client.get("/api/catalog")
    assert r.status_code == 200
    assert r.json() == CATALOG


def test_catalog_file_served(client):
    r = client.get("/api/catalog/files/models/small-chair.glb")
    assert r.status_code == 200
    assert r.content[:4] == b"glTF"
    assert client.get("/api/catalog/files/models/missing.glb").status_code == 404


def test_catalog_file_traversal_blocked(client, data_dir):
    (data_dir / "secret.txt").write_text("secret")
    for p in ("..%2Fsecret.txt", "%2e%2e/secret.txt", "models/..%2F..%2Fsecret.txt", "..%5Csecret.txt"):
        r = client.get(f"/api/catalog/files/{p}")
        assert r.status_code == 404, p
        assert "secret" not in r.text


def test_add_lands_inside_walls_without_overlap(client, data_dir):
    # The table does not fit at the centre (the sofa is close), so it moves.
    r = client.post(URL, json={"catalog_id": "big-table"})
    assert r.status_code == 200
    body = r.json()
    assert body["added"] == "big_table"
    obj = find(body["objects"], "big_table")
    assert obj["source"] == "catalog"
    assert obj["catalog_id"] == "big-table"
    assert obj["mesh"] == "meshes/big-table.glb"
    assert obj["movable"] is True
    assert obj["size"] == [2.0, 1.4, 0.7]
    assert obj["rgba"] == [0.5, 0.5, 0.5, 1.0]
    assert obj["product"] == {
        "title": "big-table title",
        "url": "https://example.com/big-table",
        "price": 300.0,
        "currency": "USD",
    }
    assert "replaces" not in obj
    assert obj["pos"][:2] != [0.0, 0.0]
    assert body["warnings"] == []
    assert body["total"]["amount"] == 799.5
    assert find(saved(data_dir)["objects"], "big_table") == obj


def test_add_takes_free_centre(client):
    obj = find(client.post(URL, json={"catalog_id": "small-chair"}).json()["objects"], "small_chair")
    assert obj["pos"] == [0.0, 0.0, 0.0]
    assert obj["yaw"] == 0.0


def test_add_name_suffix(client):
    names = [client.post(URL, json={"catalog_id": "small-chair"}).json() for _ in range(3)]
    assert [b["added"] for b in names] == ["small_chair", "small_chair_2", "small_chair_3"]
    assert names[-1]["warnings"] == []


def test_mesh_copied_once(client, data_dir):
    mesh = data_dir / "rooms" / ROOM / "meshes" / "small-chair.glb"
    assert not mesh.exists()
    client.post(URL, json={"catalog_id": "small-chair"})
    assert mesh.read_bytes()[:4] == b"glTF"
    mesh.write_bytes(b"changed")
    client.post(URL, json={"catalog_id": "small-chair"})
    assert mesh.read_bytes() == b"changed"
    assert list(mesh.parent.glob("*.tmp")) == []


def test_replace_copies_pos_and_hides_target(client, data_dir):
    client.patch(f"{URL}/chair", json={"pos": [-1.2, -0.7], "yaw": 0.3})
    r = client.post(URL, json={"catalog_id": "small-chair", "replace": "chair"})
    assert r.status_code == 200
    body = r.json()
    new = find(body["objects"], body["added"])
    assert new["pos"] == [-1.2, -0.7, 0.0]
    assert new["yaw"] == 0.3
    assert new["replaces"] == "chair"
    assert find(body["objects"], "chair")["hidden"] is True
    assert find(saved(data_dir)["objects"], "chair")["hidden"] is True
    assert body["warnings"] == []


def test_replace_nudges_inside_wall(client):
    # The bench spans x from -3.0 to 1.0 around x=-1, so it moves 0.5 right.
    body = client.post(URL, json={"catalog_id": "wide-bench", "replace": "chair"}).json()
    new = find(body["objects"], body["added"])
    assert abs(new["pos"][0] - (-0.5)) < 1e-9
    assert new["pos"][1] == -1.0
    assert not any(w["type"] == "wall" for w in body["warnings"])


def test_replace_allows_overlap_warning(client):
    # The table at the new chair spot reaches the sofa. That is allowed and reported.
    client.patch(f"{URL}/chair", json={"pos": [0.0, 0.2]})
    body = client.post(URL, json={"catalog_id": "big-table", "replace": "chair"}).json()
    assert {"type": "overlap", "objects": ["sofa", body["added"]]} in body["warnings"]


def test_hidden_excluded_from_warnings_total_and_count(client):
    # Move the chair onto the sofa, then replace the sofa. The hidden sofa
    # must not warn, must not count, and must not add to the total.
    client.patch(f"{URL}/chair", json={"pos": [0.0, 1.0]})
    body = client.post(URL, json={"catalog_id": "wide-bench", "replace": "sofa"}).json()
    assert find(body["objects"], "sofa")["hidden"] is True
    for w in body["warnings"]:
        assert "sofa" not in w.get("objects", [])
        assert w.get("object") != "sofa"
    assert body["total"]["amount"] == 50.5 + 90.0
    assert len(body["objects"]) == 4
    assert client.get("/api/rooms").json()[0]["object_count"] == 3
    assert client.get(f"/api/rooms/{ROOM}").json()["total"]["amount"] == 140.5


def test_patch_hidden_is_409(client):
    client.post(URL, json={"catalog_id": "small-chair", "replace": "chair"})
    assert client.patch(f"{URL}/chair", json={"yaw": 1}).status_code == 409


def test_delete_replacement_restores_target(client, data_dir):
    added = client.post(URL, json={"catalog_id": "small-chair", "replace": "chair"}).json()["added"]
    body = client.delete(f"{URL}/{added}").json()
    assert "hidden" not in find(body["objects"], "chair")
    assert "hidden" not in find(saved(data_dir)["objects"], "chair")
    assert body["total"]["amount"] == 499.5


def test_delete_replacement_when_target_gone(client):
    added = client.post(URL, json={"catalog_id": "small-chair", "replace": "chair"}).json()["added"]
    assert client.delete(f"{URL}/chair").status_code == 200
    assert client.delete(f"{URL}/{added}").status_code == 200


def test_add_errors(client, data_dir):
    assert client.post("/api/rooms/nope/objects", json={"catalog_id": "small-chair"}).status_code == 404
    assert client.post(URL, json={"catalog_id": "nope"}).status_code == 404
    assert client.post(URL, json={"catalog_id": "small-chair", "replace": "nope"}).status_code == 404
    assert client.post(URL, json={"catalog_id": "small-chair", "replace": "shelf"}).status_code == 409
    for body in ({}, {"catalog_id": 5}, {"catalog_id": "small-chair", "replace": 5}, []):
        assert client.post(URL, json=body).status_code == 422, body
    assert len(saved(data_dir)["objects"]) == 3
    client.post(URL, json={"catalog_id": "small-chair", "replace": "chair"})
    assert client.post(URL, json={"catalog_id": "small-chair", "replace": "chair"}).status_code == 409


def test_place_fallback_centre_when_full():
    room = {"size_xy": [1.0, 1.0]}
    blocker = {"name": "b", "pos": [0.0, 0.0, 0.0], "yaw": 0.0, "size": [1.0, 1.0, 1.0]}
    objects, name = add_item(room, [blocker], CATALOG[0])
    assert name == "small_chair"
    assert objects[-1]["pos"] == [0.0, 0.0, 0.0]
    assert objects[-1]["yaw"] == 0.0
    assert "hidden" not in blocker


def test_place_tries_quarter_turn():
    # A tall piece fits the room only when turned. The centre spot is free.
    room = {"size_xy": [2.0, 0.5]}
    item = {**CATALOG[0], "size": [0.4, 1.8, 0.5]}
    new = add_item(room, [], item)[0][-1]
    corners = footprint_corners(new["pos"], new["size"], new["yaw"])
    assert new["yaw"] != 0.0
    assert not outside_walls(corners, room["size_xy"])

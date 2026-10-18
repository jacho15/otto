import json

import pytest

from conftest import ROOM
from otto_api import main
from test_agent import FakeApi, text

ROOM_URL = f"/api/rooms/{ROOM}"
UNDO = f"{ROOM_URL}/undo"
REDO = f"{ROOM_URL}/redo"
LAYOUTS = f"{ROOM_URL}/layouts"
DOOR = f"{ROOM_URL}/door"
SOFA = f"{ROOM_URL}/objects/sofa"


@pytest.fixture(autouse=True)
def slow_clock(monkeypatch):
    """Each call is 10 seconds after the last, so edits never merge unless a test says so."""
    ticks = iter(range(0, 10**6, 10))
    monkeypatch.setattr(main, "clock", lambda: float(next(ticks)))


def names(room):
    return {o["name"] for o in room["objects"]}


def after_undo(client):
    """The room after an undo, without can_redo, so it compares with an earlier GET."""
    return {**client.post(UNDO).json(), "can_redo": False}


def history(data_dir):
    path = data_dir / "rooms" / ROOM / "history.json"
    return json.loads(path.read_text("utf-8")) if path.is_file() else []


def test_undo_move(client):
    before = client.get(ROOM_URL).json()
    assert before["can_undo"] is False
    moved = client.patch(SOFA, json={"pos": [1.0, 1.0]}).json()
    assert moved["can_undo"] is True
    r = client.post(UNDO)
    assert r.status_code == 200
    assert r.json() == {**before, "can_redo": True}
    assert client.get(ROOM_URL).json() == {**before, "can_redo": True}


def test_undo_delete(client):
    before = client.get(ROOM_URL).json()
    client.delete(f"{ROOM_URL}/objects/chair")
    assert after_undo(client) == before


def test_undo_add(client):
    before = client.get(ROOM_URL).json()
    added = client.post(f"{ROOM_URL}/objects", json={"catalog_id": "small-chair", "pos": [1.0, -1.0]})
    assert added.status_code == 200
    assert len(added.json()["objects"]) == 4
    assert after_undo(client) == before


def test_undo_room_resize(client):
    before = client.get(ROOM_URL).json()
    client.patch(ROOM_URL, json={"width": 6, "depth": 5, "height": 3})
    assert client.get(ROOM_URL).json()["room"]["size_xy"] == [6, 5]
    assert after_undo(client) == before


def test_undo_design_agent_place(client, monkeypatch):
    monkeypatch.setenv("ANTHROPIC_API_KEY", "test-key")
    api = FakeApi([
        [{"type": "tool_use", "id": "t1", "name": "place_item",
          "input": {"catalog_id": "small-chair", "x": 1.0, "y": -1.0, "yaw_degrees": 90}}],
        [{"type": "tool_use", "id": "t2", "name": "move_item",
          "input": {"name": "chair", "x": -2.0, "y": -1.0, "yaw_degrees": 180}}],
        [text("Done.")],
    ])
    monkeypatch.setattr(main, "make_client", lambda key: api.client())
    before = client.get(ROOM_URL).json()
    r = client.post(f"{ROOM_URL}/agent/design", json={"instruction": "go"})
    assert r.status_code == 200 and len(r.json()["changes"]) == 2
    assert client.post(UNDO).json()["objects"] != before["objects"]  # undoes the move only
    assert after_undo(client) == before  # then the place


def test_undo_twice_goes_back_in_steps(client):
    original = client.get(ROOM_URL).json()
    first = client.patch(SOFA, json={"pos": [1.0, 1.0]}).json()
    client.patch(SOFA, json={"pos": [-1.0, 1.0]})
    assert after_undo(client) == first
    assert after_undo(client) == original


def test_quick_patches_of_one_object_undo_together(client, monkeypatch):
    now = [100.0]
    monkeypatch.setattr(main, "clock", lambda: now[0])
    original = client.get(ROOM_URL).json()
    for n in range(1, 5):
        client.patch(SOFA, json={"yaw": 0.3 * n})
        now[0] += 1.5  # each is within 2 seconds of the one before
    assert after_undo(client) == original
    assert client.post(UNDO).status_code == 409


def test_patches_further_apart_than_2_seconds_stay_separate(client, monkeypatch):
    now = [100.0]
    monkeypatch.setattr(main, "clock", lambda: now[0])
    original = client.get(ROOM_URL).json()
    first = client.patch(SOFA, json={"yaw": 0.3}).json()
    now[0] += 2.5
    client.patch(SOFA, json={"yaw": 0.6})
    assert after_undo(client) == first
    assert after_undo(client) == original


def test_patch_of_another_object_has_its_own_entry(client, monkeypatch):
    monkeypatch.setattr(main, "clock", lambda: 100.0)
    original = client.get(ROOM_URL).json()
    client.patch(SOFA, json={"yaw": 0.3})
    after_sofa = client.patch(SOFA, json={"yaw": 0.6}).json()
    client.patch(f"{ROOM_URL}/objects/chair", json={"yaw": 0.3})
    assert after_undo(client) == after_sofa  # the chair on its own
    assert after_undo(client) == original  # the sofa turns together


def test_other_change_ends_a_burst(client, monkeypatch):
    monkeypatch.setattr(main, "clock", lambda: 100.0)
    client.patch(SOFA, json={"yaw": 0.3})
    client.patch(DOOR, json={"width": 0.7, "height": 2.1})
    after_door = client.patch(SOFA, json={"yaw": 0.6}).json()
    assert client.post(UNDO).json()["door"] == {"width": 0.7, "height": 2.1}
    assert after_door["door"] == {"width": 0.7, "height": 2.1}
    assert client.post(UNDO).json()["door"] == {"width": 0.81, "height": 2.03}


def test_undo_replace_restores_the_original(client):
    before = client.get(ROOM_URL).json()
    r = client.post(f"{ROOM_URL}/objects", json={"catalog_id": "small-chair", "replace": "chair"})
    assert r.status_code == 200
    body = r.json()
    assert next(o for o in body["objects"] if o["name"] == "chair")["hidden"] is True
    assert body["added"] in names(body)
    undone = after_undo(client)
    assert undone == before
    assert "hidden" not in next(o for o in undone["objects"] if o["name"] == "chair")
    assert body["added"] not in names(undone)


def test_undo_with_nothing_is_409(client):
    r = client.post(UNDO)
    assert r.status_code == 409 and r.json()["detail"] == "Nothing to undo."
    client.patch(SOFA, json={"pos": [1.0, 1.0]})
    client.post(UNDO)
    assert client.post(UNDO).status_code == 409
    assert client.post("/api/rooms/nope/undo").status_code == 404


def test_redo_restores_what_undo_took_back(client):
    original = client.get(ROOM_URL).json()
    assert original["can_redo"] is False
    moved = client.patch(SOFA, json={"pos": [1.0, 1.0]}).json()
    assert moved["can_redo"] is False
    undone = client.post(UNDO).json()
    assert undone["can_redo"] is True and undone["can_undo"] is False
    redone = client.post(REDO)
    assert redone.status_code == 200
    assert redone.json() == {**moved, "can_redo": False}
    assert redone.json()["can_undo"] is True
    assert client.get(ROOM_URL).json() == redone.json()
    assert client.post(UNDO).json()["objects"] == original["objects"]  # and undo still works


def test_undo_and_redo_twice_step_through(client):
    original = client.get(ROOM_URL).json()
    first = client.patch(SOFA, json={"pos": [1.0, 1.0]}).json()
    second = client.patch(SOFA, json={"pos": [-1.0, 1.0]}).json()
    client.post(UNDO)
    client.post(UNDO)
    r = client.post(REDO).json()
    assert r["objects"] == first["objects"] and r["can_redo"] is True
    r = client.post(REDO).json()
    assert r["objects"] == second["objects"] and r["can_redo"] is False
    assert original["objects"] != second["objects"]


def test_redo_with_nothing_is_409(client):
    r = client.post(REDO)
    assert r.status_code == 409 and r.json()["detail"] == "Nothing to redo."
    client.patch(SOFA, json={"pos": [1.0, 1.0]})
    client.post(UNDO)
    client.post(REDO)
    assert client.post(REDO).status_code == 409
    assert client.post("/api/rooms/nope/redo").status_code == 404


def test_new_change_after_undo_clears_redo(client):
    client.patch(SOFA, json={"pos": [1.0, 1.0]})
    assert client.post(UNDO).json()["can_redo"] is True
    changed = client.patch(f"{ROOM_URL}/objects/chair", json={"yaw": 0.3}).json()
    assert changed["can_redo"] is False
    assert client.get(ROOM_URL).json()["can_redo"] is False
    assert client.post(REDO).status_code == 409


def test_unchanged_save_after_undo_keeps_redo(client):
    client.patch(SOFA, json={"pos": [1.0, 1.0]})
    client.post(UNDO)
    client.patch(SOFA, json={"yaw": 0.0})
    assert client.get(ROOM_URL).json()["can_redo"] is True


def test_redo_ends_a_patch_burst(client, monkeypatch):
    now = [100.0]
    monkeypatch.setattr(main, "clock", lambda: now[0])
    original = client.get(ROOM_URL).json()
    client.patch(SOFA, json={"yaw": 0.3})
    client.post(UNDO)
    client.post(REDO)
    now[0] += 0.5  # still within 2 seconds of the first patch
    client.patch(SOFA, json={"yaw": 0.6})
    assert client.post(UNDO).json()["objects"] != original["objects"]  # the second patch has its own entry
    assert client.post(UNDO).json()["objects"] == original["objects"]


def test_redo_is_capped_at_30(client, data_dir):
    for n in range(1, 31):
        client.patch(SOFA, json={"pos": [0.01 * n, 1.0]})
    for _ in range(30):
        client.post(UNDO)
    redo_path = data_dir / "rooms" / ROOM / "redo.json"
    assert len(json.loads(redo_path.read_text("utf-8"))) == 30
    for _ in range(30):
        assert client.post(REDO).status_code == 200
    assert client.post(REDO).status_code == 409


def test_layout_restore_clears_redo(client):
    client.patch(SOFA, json={"pos": [1.0, 1.0]})
    lid = client.post(LAYOUTS, json={"name": "A"}).json()[0]["id"]
    client.post(UNDO)
    assert client.get(ROOM_URL).json()["can_redo"] is True
    assert client.post(f"{LAYOUTS}/{lid}/restore").json()["can_redo"] is False


def test_deleting_undo_history_deletes_redo(client, data_dir):
    client.patch(SOFA, json={"pos": [1.0, 1.0]})
    client.post(UNDO)
    redo_path = data_dir / "rooms" / ROOM / "redo.json"
    assert redo_path.is_file()
    assert client.delete("/api/data/history").status_code == 200
    assert not redo_path.exists() and client.get(ROOM_URL).json()["can_redo"] is False


def test_unchanged_save_adds_no_history(client, data_dir):
    client.patch(SOFA, json={"yaw": 0.0})
    client.patch(ROOM_URL, json={"width": 5, "depth": 4, "height": 2.6})
    assert history(data_dir) == []
    assert client.get(ROOM_URL).json()["can_undo"] is False


def test_history_is_capped_at_30(client, data_dir):
    for n in range(35):
        client.patch(SOFA, json={"pos": [0.01 * n, 1.0]})
    assert len(history(data_dir)) == 30
    # The newest entry is the scene just before the last move.
    sofa = next(o for o in history(data_dir)[-1]["objects"] if o["name"] == "sofa")
    assert sofa["pos"][0] == pytest.approx(0.33)
    for _ in range(30):
        assert client.post(UNDO).status_code == 200
    assert client.post(UNDO).status_code == 409


def test_layouts_save_and_list(client):
    assert client.get(LAYOUTS).json() == []
    r = client.post(LAYOUTS, json={"name": "  Sofa first  "})
    assert r.status_code == 200
    (entry,) = r.json()
    assert entry["name"] == "Sofa first" and len(entry["id"]) == 8
    assert entry["count"] == 3 and entry["total"] == {"amount": 499.5, "currency": "USD"}
    assert entry["saved_at"]
    assert client.get(LAYOUTS).json() == [entry]


def test_layout_count_and_total_skip_hidden(client, data_dir):
    path = data_dir / "rooms" / ROOM / "scene.json"
    scene = json.loads(path.read_text("utf-8"))
    scene["objects"][0]["hidden"] = True
    path.write_text(json.dumps(scene), "utf-8")
    (entry,) = client.post(LAYOUTS, json={"name": "x"}).json()
    assert entry["count"] == 2 and entry["total"]["amount"] == 50.5


def test_layout_name_validation(client):
    assert client.post(LAYOUTS, json={"name": "   "}).status_code == 422
    assert client.post(LAYOUTS, json={"name": "x" * 41}).status_code == 422
    assert client.post(LAYOUTS, json={"name": "x" * 40}).status_code == 200


def test_layout_restore_is_undoable(client):
    lid = client.post(LAYOUTS, json={"name": "A"}).json()[0]["id"]
    client.delete(f"{ROOM_URL}/objects/chair")
    client.patch(SOFA, json={"pos": [1.0, 1.0]})
    original = json.loads(json.dumps(client.get(ROOM_URL).json()))
    r = client.post(f"{LAYOUTS}/{lid}/restore")
    assert r.status_code == 200
    body = r.json()
    assert names(body) == {"sofa", "chair", "shelf"}
    assert next(o for o in body["objects"] if o["name"] == "sofa")["pos"] == [0.0, 1.0, 0.0]
    assert body["can_undo"] is True
    assert client.get(ROOM_URL).json() == body
    assert after_undo(client) == original


def test_layout_delete_and_limit(client):
    for n in range(10):
        r = client.post(LAYOUTS, json={"name": f"L{n}"})
        assert r.status_code == 200
    assert client.post(LAYOUTS, json={"name": "one more"}).status_code == 409
    layouts = client.get(LAYOUTS).json()
    assert len(layouts) == 10
    left = client.delete(f"{LAYOUTS}/{layouts[0]['id']}").json()
    assert [l["id"] for l in left] == [l["id"] for l in layouts[1:]]
    assert client.post(LAYOUTS, json={"name": "fits now"}).status_code == 200


def test_layout_bad_ids(client):
    client.post(LAYOUTS, json={"name": "A"})
    for lid in ("nothex12", "ABCDEF12", "abc", "00000000"):
        assert client.post(f"{LAYOUTS}/{lid}/restore").status_code == 404
        assert client.delete(f"{LAYOUTS}/{lid}").status_code == 404
    assert len(client.get(LAYOUTS).json()) == 1
    assert client.get("/api/rooms/nope/layouts").status_code == 404


def test_door_default(client):
    assert client.get(ROOM_URL).json()["door"] == {"width": 0.81, "height": 2.03}


def test_door_patch_is_saved_and_undoable(client, data_dir):
    r = client.patch(DOOR, json={"width": 0.7, "height": 2.1})
    assert r.status_code == 200
    assert r.json()["door"] == {"width": 0.7, "height": 2.1} and r.json()["can_undo"] is True
    assert client.get(ROOM_URL).json()["door"] == {"width": 0.7, "height": 2.1}
    disk = json.loads((data_dir / "rooms" / ROOM / "scene.json").read_text("utf-8"))
    assert disk["door"] == {"width": 0.7, "height": 2.1}
    assert client.post(UNDO).json()["door"] == {"width": 0.81, "height": 2.03}


@pytest.mark.parametrize("body", [
    {"width": 0.49, "height": 2.0},
    {"width": 2.01, "height": 2.0},
    {"width": 0.9, "height": 1.49},
    {"width": 0.9, "height": 3.01},
    {"width": 0.9},
    {"width": "wide", "height": 2.0},
])
def test_door_validation(client, body):
    assert client.patch(DOOR, json=body).status_code == 422
    assert client.get(ROOM_URL).json()["door"] == {"width": 0.81, "height": 2.03}
    assert client.patch("/api/rooms/nope/door", json={"width": 0.9, "height": 2.0}).status_code == 404


def set_currency(data_dir, name, currency):
    path = data_dir / "rooms" / ROOM / "scene.json"
    scene = json.loads(path.read_text("utf-8"))
    next(o for o in scene["objects"] if o["name"] == name)["product"]["currency"] = currency
    path.write_text(json.dumps(scene), "utf-8")


def test_totals_per_currency(client, data_dir):
    room = client.get(ROOM_URL).json()
    assert room["totals"] == [{"currency": "USD", "amount": 499.5}]
    set_currency(data_dir, "chair", "EUR")
    room = client.get(ROOM_URL).json()
    assert room["totals"] == [{"currency": "EUR", "amount": 50.5}, {"currency": "USD", "amount": 449.0}]
    assert room["total"] == {"amount": None, "currency": "MIXED"}
    (entry,) = client.post(LAYOUTS, json={"name": "mixed"}).json()
    assert entry["totals"] == room["totals"] and entry["total"] == room["total"]


def test_totals_skip_hidden_and_unpriced(client, data_dir):
    set_currency(data_dir, "chair", "EUR")
    path = data_dir / "rooms" / ROOM / "scene.json"
    scene = json.loads(path.read_text("utf-8"))
    scene["objects"][1]["hidden"] = True
    path.write_text(json.dumps(scene), "utf-8")
    room = client.get(ROOM_URL).json()
    assert room["totals"] == [{"currency": "USD", "amount": 449.0}]
    assert room["total"] == {"amount": 449.0, "currency": "USD"}

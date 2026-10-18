import json
import subprocess
import sys
from pathlib import Path

import pytest

from conftest import ROOM
from otto_api import main
from test_agent import MANDATE, FakeApi, text

SUGGEST = f"/api/rooms/{ROOM}/agent/suggest"

CHAIR = {"catalog_id": "small-chair", "x": 1.0, "y": -1.0, "yaw_degrees": 90, "reason": "A seat by the window."}
LAMP = {"catalog_id": "flat-lamp", "x": -1.0, "y": 0.0, "yaw_degrees": 0, "reason": "Light for the corner."}


def call(tool, **args):
    return {"type": "tool_use", "id": f"toolu_{tool}", "name": tool, "input": args}


@pytest.fixture
def suggest(client, monkeypatch):
    monkeypatch.setenv("ANTHROPIC_API_KEY", "test-key")

    def run(api, instruction="what goes well here?"):
        monkeypatch.setattr(main, "make_client", lambda key: api.client())
        return client.post(SUGGEST, json={"instruction": instruction})

    return run


def scene_text(data_dir):
    return (data_dir / "rooms" / ROOM / "scene.json").read_text("utf-8")


def test_request_shape(suggest):
    api = FakeApi([[text("ok")]])
    suggest(api)
    body = api.body(0)
    assert body["model"] == "claude-opus-5-5"
    assert body["thinking"] == {"type": "adaptive"} and body["output_config"] == {"effort": "medium"}
    assert body["fallbacks"] == "default"
    for key in ("temperature", "tool_choice"):
        assert key not in body
    assert [t["name"] for t in body["tools"]] == [
        "get_room", "get_catalog", "get_mandate", "find_spots", "propose_suggestions",
    ]
    for t in body["tools"]:
        assert t["strict"] and t["input_schema"]["additionalProperties"] is False


def test_happy_path(suggest, data_dir):
    before = scene_text(data_dir)
    api = FakeApi([
        [call("get_room")],
        [call("find_spots", catalog_id="small-chair", near="sofa", against_wall=False)],
        [call("propose_suggestions", items=[CHAIR, LAMP])],
        [text("A chair and a lamp would suit it.")],
    ])
    r = suggest(api)
    assert r.status_code == 200
    body = r.json()
    assert json.loads(api.result_text(1))["objects"][0]["name"] == "sofa"
    assert json.loads(api.result_text(2))
    assert not api.tool_results(3)[0].get("is_error")
    assert body["message"] == "A chair and a lamp would suit it."
    chair, lamp = body["suggestions"]
    assert chair == {
        "catalog_id": "small-chair", "title": "small-chair title", "label": "thing", "price": 60.0,
        "currency": "USD", "url": "https://example.com/small-chair", "size": [0.5, 0.5, 0.8],
        "rgba": [0.5, 0.5, 0.5, 1.0], "model": "models/small-chair.glb", "photo": "photos/small-chair.jpg",
        "pos": [1.0, -1.0], "yaw": pytest.approx(1.5708, abs=1e-3), "reason": "A seat by the window.",
        "mandate_ok": True, "violations": [],
    }
    assert lamp["title"] == "flat-lamp title" and lamp["price"] == 25.0 and lamp["pos"] == [-1.0, 0.0]
    assert lamp["model"] is None and lamp["photo"] is None
    assert scene_text(data_dir) == before


def test_agent_cannot_edit_the_room(suggest):
    api = FakeApi([[text("ok")]])
    suggest(api)
    names = {t["name"] for t in api.body(0)["tools"]}
    assert names.isdisjoint({"place_item", "move_item", "remove_item", "propose_order", "set_mandate"})


def test_invalid_items_are_rejected_and_valid_ones_kept(suggest, data_dir):
    before = scene_text(data_dir)
    api = FakeApi([
        [call("propose_suggestions", items=[
            CHAIR,
            {**LAMP, "catalog_id": "nope"},
            {**LAMP, "x": 0.0, "y": 1.0},  # overlaps the sofa
            {**LAMP, "x": 1.1, "y": -1.0},  # overlaps the chair suggested just before
        ])],
        [text("Done.")],
    ])
    r = suggest(api)
    assert api.tool_results(1)[0]["is_error"] is True
    error = api.result_text(1)
    assert "Item 2: unknown catalog id nope" in error
    assert "Item 3: the piece overlaps sofa" in error
    assert "Item 4: the piece overlaps an earlier suggestion" in error
    assert "Kept 1 valid" in error
    assert [s["catalog_id"] for s in r.json()["suggestions"]] == ["small-chair"]
    assert scene_text(data_dir) == before


def test_custom_items_are_not_suggested(suggest, client):
    item = client.post("/api/custom-items", json={"title": "Mine", "size": [0.5, 0.5, 0.8], "label": "chair"}).json()
    mine = {**CHAIR, "catalog_id": item["id"]}
    api = FakeApi([
        [call("find_spots", catalog_id=item["id"], near=None, against_wall=False)],
        [call("propose_suggestions", items=[mine])],
        [text("Done.")],
    ])
    r = suggest(api)
    assert api.tool_results(1)[0]["is_error"] is True
    assert f"Unknown catalog id {item['id']}. Use ids from get_catalog." in api.result_text(1)
    assert f"unknown catalog id {item['id']}" in api.result_text(2)
    assert r.json()["suggestions"] == []


def test_repeated_catalog_id_is_rejected(suggest):
    api = FakeApi([[call("propose_suggestions", items=[CHAIR, {**CHAIR, "x": -1.0, "y": 1.5}])], [text("Done.")]])
    r = suggest(api)
    assert "Item 2: small-chair is already suggested. Suggest each product once." in api.result_text(1)
    assert [s["catalog_id"] for s in r.json()["suggestions"]] == ["small-chair"]


def test_item_taller_than_the_ceiling_is_rejected(suggest, data_dir):
    scene_path = data_dir / "rooms" / ROOM / "scene.json"
    scene = json.loads(scene_path.read_text("utf-8"))
    scene["room"]["ceiling_height"] = 1.0  # the chair is 0.8 m, the lamp 1.5 m
    scene_path.write_text(json.dumps(scene), "utf-8")
    api = FakeApi([[call("propose_suggestions", items=[CHAIR, LAMP])], [text("Done.")]])
    r = suggest(api)
    assert "Item 2: flat-lamp is taller than the ceiling" in api.result_text(1)
    assert [s["catalog_id"] for s in r.json()["suggestions"]] == ["small-chair"]


def test_item_over_the_wall_is_rejected(suggest):
    api = FakeApi([[call("propose_suggestions", items=[{**LAMP, "x": -2.45, "y": 0.0}])], [text("Done.")]])
    r = suggest(api)
    assert "the piece crosses a wall" in api.result_text(1)
    assert r.json()["suggestions"] == []


def test_retry_with_a_full_list_replaces_the_kept_ones(suggest):
    api = FakeApi([
        [call("propose_suggestions", items=[CHAIR, {**LAMP, "x": 0.0, "y": 1.0}])],
        [call("propose_suggestions", items=[CHAIR, LAMP])],
        [text("Done.")],
    ])
    r = suggest(api)
    assert api.tool_results(1)[0]["is_error"] and not api.tool_results(2)[0].get("is_error")
    assert [s["catalog_id"] for s in r.json()["suggestions"]] == ["small-chair", "flat-lamp"]


def test_all_invalid_keeps_the_earlier_list(suggest):
    api = FakeApi([
        [call("propose_suggestions", items=[CHAIR])],
        [call("propose_suggestions", items=[{**LAMP, "x": 0.0, "y": 1.0}])],
        [text("Done.")],
    ])
    r = suggest(api)
    assert "Nothing was kept" in api.result_text(2)
    assert [s["catalog_id"] for s in r.json()["suggestions"]] == ["small-chair"]


def test_more_than_four_items_are_rejected(suggest):
    items = [{**LAMP, "x": -2.0 + i * 0.5, "y": -1.8} for i in range(5)]
    api = FakeApi([[call("propose_suggestions", items=items)], [text("Too many.")]])
    r = suggest(api)
    assert api.tool_results(1)[0]["is_error"] and "at most 4" in api.result_text(1)
    assert r.json() == {"message": "Too many.", "suggestions": []}


def test_four_items_are_fine(suggest):
    items = [
        {**CHAIR, "x": 1.2, "y": -0.9},
        {**LAMP, "x": 1.0, "y": 1.5},
        {**LAMP, "catalog_id": "big-table", "x": -1.75, "y": 0.4, "yaw_degrees": 90},
        {**LAMP, "catalog_id": "wide-bench", "x": 0.0, "y": -1.7},
    ]
    r = suggest(FakeApi([[call("propose_suggestions", items=items)], [text("Four.")]]))
    assert len(r.json()["suggestions"]) == 4


def test_no_proposal_gives_an_empty_list(suggest):
    r = suggest(FakeApi([[text("Nothing to add.")]]))
    assert r.status_code == 200
    assert r.json() == {"message": "Nothing to add.", "suggestions": []}


def test_mandate_flags(suggest, client):
    def run():
        api = FakeApi([[call("propose_suggestions", items=[CHAIR, LAMP])], [text("ok")]])
        return suggest(api).json()["suggestions"]

    # No mandate is not a violation here.
    assert [(s["mandate_ok"], s["violations"]) for s in run()] == [(True, []), (True, [])]
    client.put("/api/mandate", json={**MANDATE, "max_item_price": 50})
    chair, lamp = run()
    assert chair["mandate_ok"] is False
    assert len(chair["violations"]) == 1 and "per-item limit" in chair["violations"][0]
    assert lamp["mandate_ok"] is True and lamp["violations"] == []


def test_reply_is_cut_to_three_sentences(suggest):
    r = suggest(FakeApi([[text("One. Two! Three? Four. Five.")]]))
    assert r.json()["message"] == "One. Two! Three?"


def test_empty_instruction_is_allowed(suggest):
    api = FakeApi([[text("ok")]])
    assert suggest(api, "").status_code == 200
    assert api.body(0)["messages"][0]["content"]


def test_api_error_is_502(suggest):
    r = suggest(FakeApi([[]], status=500))
    assert r.status_code == 502 and "API error (500)" in r.json()["detail"]


def test_no_api_key_is_503(client):
    r = client.post(SUGGEST, json={"instruction": "x"})
    assert r.status_code == 503
    assert r.json()["detail"] == "Add ANTHROPIC_API_KEY to .env"


def test_validation(client):
    assert client.post(SUGGEST, json={"instruction": "x" * 1001}).status_code == 422
    assert client.post("/api/rooms/nope/agent/suggest", json={"instruction": "x"}).status_code == 404


def test_suggest_imports_on_its_own():
    r = subprocess.run(
        [sys.executable, "-c", "import otto_api.suggest"],
        capture_output=True, text=True, cwd=Path(__file__).parent.parent,
    )
    assert r.returncode == 0, r.stderr

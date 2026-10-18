import json

import pytest

from conftest import ROOM

DATA = "/api/data"
KINDS = ["mandate", "orders", "chats", "prefs", "history", "layouts", "saved", "custom"]
MANDATE = {"max_item_price": None, "max_total": None, "shops": [], "expires": None}


def write(path, data):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data), "utf-8")


def scene_of(data_dir):
    return json.loads((data_dir / "rooms" / ROOM / "scene.json").read_text("utf-8"))


def fill(data_dir, client):
    """Some of every kind, in two rooms."""
    other = data_dir / "rooms" / "other-room"
    write(other / "scene.json", scene_of(data_dir))
    mandate = client.put("/api/mandate", json=MANDATE).json()
    for room in (data_dir / "rooms" / ROOM, other):
        write(room / "orders" / "a.json", {"id": "a"})
        write(room / "history.json", [scene_of(data_dir)])
        write(room / "layouts.json", [{"id": "x"}, {"id": "y"}])
    write(data_dir / "rooms" / ROOM / "orders" / "b.json", {"id": "b"})
    write(data_dir / "rooms" / ROOM / "chat.json", {"messages": [{"role": "user", "text": "hi"}] * 3, "prefs": ["cheap", "wood"]})
    write(other / "chat.json", {"messages": [{"role": "user", "text": "hi"}], "prefs": ["small"]})
    write(data_dir / "saved.json", [{"catalog_id": "small-chair"}, {"catalog_id": "big-table"}])
    write(data_dir / "custom" / "items.json", [{"id": "c1"}])
    (data_dir / "custom" / "files").mkdir(parents=True)
    (data_dir / "custom" / "files" / "aaaaaaaaaaaa.glb").write_bytes(b"glTF")
    (data_dir / "custom" / "files" / "bbbbbbbbbbbb.jpg").write_bytes(b"x")
    return mandate


def by_kind(body):
    return {i["kind"]: i for i in body["items"]}


def all_files(data_dir):
    return {p for p in data_dir.rglob("*") if p.is_file()}


def keep(data_dir):
    """Files that no delete may touch."""
    return [
        data_dir / "rooms" / ROOM / "scene.json",
        data_dir / "rooms" / ROOM / "meshes" / "x.glb",
        data_dir / "rooms" / "other-room" / "scene.json",
        data_dir / "catalog" / "catalog.json",
        data_dir / "catalog" / "models" / "small-chair.glb",
    ]


def test_empty_summary(client):
    body = client.get(DATA).json()
    assert [i["kind"] for i in body["items"]] == KINDS
    assert all(i["count"] == 0 and i["label"] and i["detail"] for i in body["items"])
    assert by_kind(body)["mandate"]["detail"] == "Not set"
    assert body["note"] == (
        "Everything stays in Otto's data folder on this computer. "
        "Product pages you import are fetched once to read the product. "
        "Chat messages are sent to Anthropic's API to generate replies."
    )


def test_summary_counts(client, data_dir):
    mandate = fill(data_dir, client)
    items = by_kind(client.get(DATA).json())
    assert items["mandate"]["count"] == 1 and items["mandate"]["detail"] == f"Token ending {mandate['token_last4']}"
    assert items["orders"]["count"] == 3
    assert items["chats"]["count"] == 2 and "4 messages" in items["chats"]["detail"]
    assert items["prefs"]["count"] == 3 and items["prefs"]["detail"] == "3 preferences"
    assert items["history"]["count"] == 2
    assert items["layouts"]["count"] == 4
    assert items["saved"]["count"] == 2
    assert items["custom"]["count"] == 1 and "2 uploaded files" in items["custom"]["detail"]


def test_empty_chat_and_history_do_not_count(client, data_dir):
    write(data_dir / "rooms" / ROOM / "chat.json", {"messages": [], "prefs": ["cheap"]})
    write(data_dir / "rooms" / ROOM / "history.json", [])
    items = by_kind(client.get(DATA).json())
    assert items["chats"]["count"] == 0 and items["history"]["count"] == 0
    assert items["prefs"]["count"] == 1


FILES = {
    "mandate": ["mandate.json"],
    "orders": ["rooms/test-room/orders/a.json", "rooms/test-room/orders/b.json", "rooms/other-room/orders/a.json"],
    "chats": [],  # the preferences stay in chat.json
    "prefs": [],  # the messages stay in chat.json
    "history": ["rooms/test-room/history.json", "rooms/other-room/history.json"],
    "layouts": ["rooms/test-room/layouts.json", "rooms/other-room/layouts.json"],
    "saved": ["saved.json"],
    "custom": ["custom/items.json", "custom/files/aaaaaaaaaaaa.glb", "custom/files/bbbbbbbbbbbb.jpg"],
}


@pytest.mark.parametrize("kind", KINDS)
def test_delete_removes_only_that_kind(client, data_dir, kind):
    fill(data_dir, client)
    before = all_files(data_dir)
    r = client.delete(f"{DATA}/{kind}")
    assert r.status_code == 200
    assert r.json() == client.get(DATA).json()
    counts = by_kind(r.json())
    assert counts[kind]["count"] == 0
    assert all(counts[k]["count"] > 0 for k in KINDS if k != kind)
    assert before - all_files(data_dir) == {data_dir / f for f in FILES[kind]}
    assert all(p.is_file() for p in keep(data_dir))


def chat_of(data_dir, room):
    return json.loads((data_dir / "rooms" / room / "chat.json").read_text("utf-8"))


def test_delete_chats_keeps_the_preferences(client, data_dir):
    fill(data_dir, client)
    client.delete(f"{DATA}/chats")
    assert chat_of(data_dir, ROOM) == {"messages": [], "prefs": ["cheap", "wood"]}
    assert chat_of(data_dir, "other-room") == {"messages": [], "prefs": ["small"]}
    assert client.get(f"/api/rooms/{ROOM}/chat").json() == {"messages": [], "prefs": ["cheap", "wood"]}


def test_delete_prefs_keeps_the_messages(client, data_dir):
    fill(data_dir, client)
    client.delete(f"{DATA}/prefs")
    chat = chat_of(data_dir, ROOM)
    assert chat["prefs"] == [] and len(chat["messages"]) == 3
    assert len(chat_of(data_dir, "other-room")["messages"]) == 1


def test_chat_file_goes_when_nothing_is_left(client, data_dir):
    fill(data_dir, client)
    client.delete(f"{DATA}/chats")
    client.delete(f"{DATA}/prefs")
    assert not (data_dir / "rooms" / ROOM / "chat.json").exists()
    assert not (data_dir / "rooms" / "other-room" / "chat.json").exists()
    write(data_dir / "rooms" / ROOM / "chat.json", {"messages": [{"role": "user", "text": "hi"}], "prefs": []})
    client.delete(f"{DATA}/chats")
    assert not (data_dir / "rooms" / ROOM / "chat.json").exists()


def test_delete_everything_then_app_still_works(client, data_dir):
    fill(data_dir, client)
    for kind in KINDS:
        assert client.delete(f"{DATA}/{kind}").status_code == 200
    assert all(i["count"] == 0 for i in client.get(DATA).json()["items"])
    assert all(p.is_file() for p in keep(data_dir))
    assert client.get(f"/api/rooms/{ROOM}").status_code == 200
    assert len(client.get("/api/catalog").json()) == 4


def test_unknown_kind_is_404(client, data_dir):
    fill(data_dir, client)
    before = all_files(data_dir)
    for kind in ("scene", "catalog", "everything", "..", "%2e%2e", "mandate.json"):
        assert client.delete(f"{DATA}/{kind}").status_code == 404
    assert all_files(data_dir) == before


def test_delete_stays_inside_the_data_folder(client, data_dir, tmp_path):
    outside = tmp_path / "outside"
    write(outside / "chat.json", {"messages": [1]})
    write(outside / "orders" / "a.json", {})
    write(outside / "secret.json", [])
    # A room folder and a files folder that link out, and a mandate file that links out.
    try:
        (data_dir / "rooms" / "linked").symlink_to(outside, target_is_directory=True)
        (data_dir / "custom").mkdir()
        (data_dir / "custom" / "files").symlink_to(outside, target_is_directory=True)
        (data_dir / "mandate.json").symlink_to(outside / "secret.json")
    except OSError:
        pytest.skip("symlinks are not allowed here")
    for kind in KINDS:
        assert client.delete(f"{DATA}/{kind}").status_code == 200
    assert sorted(p.name for p in outside.rglob("*") if p.is_file()) == ["a.json", "chat.json", "secret.json"]


def test_paths_outside_the_data_folder_are_never_deleted(client, data_dir, tmp_path, monkeypatch):
    from otto_api import data

    outside = tmp_path / "outside"
    write(outside / "chat.json", {"messages": [1]})
    write(outside / "orders" / "a.json", {})
    monkeypatch.setattr(data, "room_dirs", lambda: [outside])
    for kind in ("orders", "chats", "prefs", "history", "layouts"):
        assert client.delete(f"{DATA}/{kind}").status_code == 200
    assert sorted(p.name for p in outside.rglob("*") if p.is_file()) == ["a.json", "chat.json"]

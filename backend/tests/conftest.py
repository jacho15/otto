import json
import socket
from types import SimpleNamespace

import httpx
import pytest
from fastapi.testclient import TestClient

from otto_api import fetch, looks
from otto_api.main import app

ROOM = "test-room"


def make_item(item_id, size, price):
    return {
        "id": item_id,
        "title": f"{item_id} title",
        "label": "thing",
        "url": f"https://example.com/{item_id}",
        "price": price,
        "currency": "USD",
        "size": size,
        "rgba": [0.5, 0.5, 0.5, 1.0],
        "model": f"models/{item_id}.glb",
        "photo": f"photos/{item_id}.jpg",
    }


def make_flat_item(item_id, size, price):
    """A catalog item with no model file and no photo."""
    return {**make_item(item_id, size, price), "label": "lamp", "model": None, "photo": None}


CATALOG = [
    make_item("small-chair", [0.5, 0.5, 0.8], 60.0),
    make_item("big-table", [2.0, 1.4, 0.7], 300.0),
    make_item("wide-bench", [4.0, 0.6, 0.5], 90.0),
    make_flat_item("flat-lamp", [0.3, 0.3, 1.5], 25.0),
]


def make_object(name, pos, size, price=None, movable=True):
    obj = {
        "name": name,
        "label": name,
        "source": "catalog",
        "mesh": "meshes/x.glb",
        "pos": [pos[0], pos[1], 0.0],
        "yaw": 0.0,
        "size": size,
        "movable": movable,
    }
    if price is not None:
        obj["product"] = {"title": name, "price": price, "currency": "USD"}
    return obj


SCENE = {
    "room": {"size_xy": [5.0, 4.0], "ceiling_height": 2.6, "wall_thickness": 0.1},
    "objects": [
        make_object("sofa", [0.0, 1.0], [1.5, 0.8, 0.7], price=449.0),
        make_object("chair", [-1.0, -1.0], [0.6, 0.6, 0.8], price=50.5),
        make_object("shelf", [2.0, 0.0], [0.4, 1.0, 1.8], movable=False),
    ],
}


@pytest.fixture
def data_dir(tmp_path, monkeypatch):
    """Small fixed data dir in tmp_path, independent of the real data folder."""
    room = tmp_path / "data" / "rooms" / ROOM
    (room / "meshes").mkdir(parents=True)
    (room / "scene.json").write_text(json.dumps(SCENE), "utf-8")
    (room / "meshes" / "x.glb").write_bytes(b"glTF" + bytes(8))
    catalog = tmp_path / "data" / "catalog"
    (catalog / "models").mkdir(parents=True)
    (catalog / "catalog.json").write_text(json.dumps(CATALOG), "utf-8")
    for item in CATALOG:
        if item["model"]:
            (catalog / item["model"]).write_bytes(b"glTF" + bytes(8))
    monkeypatch.setenv("OTTO_DATA", str(tmp_path / "data"))
    return tmp_path / "data"


@pytest.fixture(autouse=True)
def no_api_key(monkeypatch):
    """Tests never see a real key, even if the repo .env has one."""
    monkeypatch.delenv("ANTHROPIC_API_KEY", raising=False)
    monkeypatch.delenv("SERPAPI_API_KEY", raising=False)


@pytest.fixture
def fake_looks(monkeypatch):
    """score_looks without Claude or photos: fake_looks.looks maps a candidate title to its look. A title that
    is not in it can't be judged. fake_looks.calls has what each call was given."""
    state = SimpleNamespace(looks={}, calls=[])

    def score_looks(client, original, candidates, deadline):
        state.calls.append(SimpleNamespace(original=original, candidates=candidates, deadline=deadline))
        found = [state.looks.get(c["title"]) for c in candidates]
        return [None if look is None else {"look": look, "look_why": "Same shell shape."} for look in found]

    monkeypatch.setattr(looks, "score_looks", score_looks)
    return state


@pytest.fixture
def client(data_dir):
    return TestClient(app)


@pytest.fixture
def net(monkeypatch):
    """No real network. Host names resolve through net.hosts (an IP literal resolves to itself)
    and every request goes to net.handler(request) and is kept in net.calls."""
    state = SimpleNamespace(
        hosts={"example.com": "93.184.216.34", "shop.test": "93.184.216.35"},
        handler=lambda request: httpx.Response(404),
        calls=[],
    )

    def getaddrinfo(host, port, *args, **kwargs):
        ip = state.hosts.get(host, host)
        family = socket.AF_INET6 if ":" in ip else socket.AF_INET
        return [(family, socket.SOCK_STREAM, 6, "", (ip, port))]

    def handler(request):
        state.calls.append(request)
        return state.handler(request)

    monkeypatch.setattr(fetch.socket, "getaddrinfo", getaddrinfo)
    monkeypatch.setattr(fetch, "open_client", lambda: httpx.Client(transport=httpx.MockTransport(handler)))
    return state

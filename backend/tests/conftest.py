import json

import pytest
from fastapi.testclient import TestClient

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


CATALOG = [
    make_item("small-chair", [0.5, 0.5, 0.8], 60.0),
    make_item("big-table", [2.0, 1.4, 0.7], 300.0),
    make_item("wide-bench", [4.0, 0.6, 0.5], 90.0),
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
        (catalog / item["model"]).write_bytes(b"glTF" + bytes(8))
    monkeypatch.setenv("OTTO_DATA", str(tmp_path / "data"))
    return tmp_path / "data"


@pytest.fixture
def client(data_dir):
    return TestClient(app)

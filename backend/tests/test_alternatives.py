import json

import pytest

from conftest import ROOM, make_item

URL = f"/api/rooms/{ROOM}/objects"


def chair_item(item_id, size, price, **extra):
    return {**make_item(item_id, size, price), "label": "Chair", **extra}


CHAIRS = [
    chair_item("cheap-chair", [0.5, 0.5, 0.8], 40.0),
    chair_item("budget-chair", [0.5, 0.5, 0.8], 30.0),
    chair_item("alt-chair", [0.5, 0.5, 0.8], 30.0),
    chair_item("wide-chair", [0.6, 3.6, 0.5], 20.0),  # pushed in from the wall, it reaches the sofa
    chair_item("tall-chair", [0.5, 0.5, 3.0], 45.0),  # taller than the 2.6 m ceiling
    chair_item("huge-chair", [6.0, 0.5, 0.5], 10.0),  # wider than the 5 m room
    chair_item("lux-chair", [0.5, 0.5, 0.8], 80.0),  # dearer
    chair_item("same-chair", [0.5, 0.5, 0.8], 50.5),  # same price, not cheaper
    chair_item("euro-chair", [0.5, 0.5, 0.8], 5.0, currency="EUR"),
    make_item("plain-thing", [0.5, 0.5, 0.8], 5.0),  # other label
]


@pytest.fixture
def chairs(data_dir):
    (data_dir / "catalog" / "catalog.json").write_text(json.dumps(CHAIRS), "utf-8")


def alternatives(client, name="chair"):
    return client.get(f"{URL}/{name}/alternatives")


def test_only_cheaper_same_label_items(client, chairs):
    r = alternatives(client)
    assert r.status_code == 200
    body = r.json()
    assert body["object"] == "chair" and body["price"] == 50.5 and body["currency"] == "USD"
    ids = {a["id"] for a in body["alternatives"]}
    assert ids == {"cheap-chair", "budget-chair", "alt-chair", "wide-chair", "tall-chair", "huge-chair"}


def test_alternative_fields_and_savings(client, chairs):
    alts = {a["id"]: a for a in alternatives(client).json()["alternatives"]}
    cheap = alts["cheap-chair"]
    assert cheap["savings"] == 10.5 and cheap["savings_pct"] == 21
    assert alts["budget-chair"]["savings"] == 20.5 and alts["budget-chair"]["savings_pct"] == 41
    assert isinstance(cheap["savings_pct"], int)
    for k in ("title", "label", "url", "price", "currency", "size", "rgba", "model", "photo"):
        assert cheap[k] == CHAIRS[0][k]
    assert "shape" not in cheap
    assert cheap["fits"] is True and cheap["problems"] == []


def test_shape_is_kept(client, data_dir):
    flat = chair_item("flat-chair", [0.5, 0.5, 0.8], 10.0, model=None, photo=None, shape="chair")
    (data_dir / "catalog" / "catalog.json").write_text(json.dumps([flat]), "utf-8")
    alt = alternatives(client).json()["alternatives"][0]
    assert alt["shape"] == "chair" and alt["model"] is None


def test_too_wide_for_the_spot(client, chairs):
    alts = {a["id"]: a for a in alternatives(client).json()["alternatives"]}
    assert alts["wide-chair"]["fits"] is False
    assert alts["wide-chair"]["problems"] == ["Overlaps sofa"]
    assert alts["huge-chair"]["fits"] is False
    assert "Goes through a wall" in alts["huge-chair"]["problems"]


def test_ceiling_problem(client, chairs):
    tall = next(a for a in alternatives(client).json()["alternatives"] if a["id"] == "tall-chair")
    assert tall["fits"] is False
    assert tall["problems"] == ["Taller than the ceiling"]


def test_sort_fits_first_then_savings_then_title(client, chairs):
    ids = [a["id"] for a in alternatives(client).json()["alternatives"]]
    assert ids == ["alt-chair", "budget-chair", "cheap-chair", "huge-chair", "wide-chair", "tall-chair"]


def test_excludes_own_catalog_item(client, data_dir, chairs):
    path = data_dir / "rooms" / ROOM / "scene.json"
    scene = json.loads(path.read_text("utf-8"))
    chair = next(o for o in scene["objects"] if o["name"] == "chair")
    chair["catalog_id"] = "budget-chair"
    path.write_text(json.dumps(scene), "utf-8")
    ids = [a["id"] for a in alternatives(client).json()["alternatives"]]
    assert "budget-chair" not in ids and "alt-chair" in ids


def test_no_price_gives_empty_list(client, chairs):
    r = alternatives(client, "shelf")
    assert r.status_code == 200
    assert r.json() == {"object": "shelf", "price": None, "currency": "USD", "alternatives": []}


def test_fixed_object_gives_empty_list(client, data_dir, chairs):
    path = data_dir / "rooms" / ROOM / "scene.json"
    scene = json.loads(path.read_text("utf-8"))
    next(o for o in scene["objects"] if o["name"] == "chair")["movable"] = False
    path.write_text(json.dumps(scene), "utf-8")
    r = alternatives(client)
    assert r.status_code == 200
    assert r.json()["alternatives"] == []


def test_item_without_currency_is_skipped(client, data_dir):
    nocur = chair_item("nocur-chair", [0.5, 0.5, 0.8], 10.0)
    del nocur["currency"]
    (data_dir / "catalog" / "catalog.json").write_text(json.dumps([nocur, CHAIRS[0]]), "utf-8")
    r = alternatives(client)
    assert r.status_code == 200
    assert [a["id"] for a in r.json()["alternatives"]] == ["cheap-chair"]


def test_errors(client, chairs):
    assert client.get(f"/api/rooms/nope/objects/chair/alternatives").status_code == 404
    assert alternatives(client, "nope").status_code == 404
    client.post(URL, json={"catalog_id": "cheap-chair", "replace": "chair"})
    assert alternatives(client, "chair").status_code == 404  # hidden


def test_room_file_unchanged(client, data_dir, chairs):
    path = data_dir / "rooms" / ROOM / "scene.json"
    before = path.read_bytes()
    assert alternatives(client).status_code == 200
    assert path.read_bytes() == before

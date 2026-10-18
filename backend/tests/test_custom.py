import json
import re

import httpx
import pytest

from conftest import ROOM
from otto_api import main
from test_agent import FakeApi, text
from test_places import call, design  # noqa: F401  (design is a fixture)

UPLOADS = "/api/uploads"
ITEMS = "/api/custom-items"
JPEG = b"\xff\xd8\xff\xe0" + bytes(20)
PNG = b"\x89PNG\r\n\x1a\n" + bytes(20)
WEBP = b"RIFF\x24\x00\x00\x00WEBPVP8 " + bytes(20)
GLB = b"glTF" + bytes(20)
ITEM = {"title": "Cozy Sofa", "size": [2.0, 0.9, 0.8], "label": "sofa"}


def upload(client, data, name="f.bin"):
    return client.post(UPLOADS, files={"file": (name, data)})


@pytest.mark.parametrize("data,ext,kind", [
    (JPEG, "jpg", "image"), (PNG, "png", "image"), (WEBP, "webp", "image"), (GLB, "glb", "model"),
])
def test_upload_and_serve(client, data_dir, data, ext, kind):
    r = upload(client, data)
    assert r.status_code == 200
    body = r.json()
    assert body["kind"] == kind
    assert re.fullmatch(rf"/api/custom/files/[0-9a-f]{{12}}\.{ext}", body["url"])
    assert (data_dir / "custom" / "files" / body["url"].rsplit("/", 1)[1]).read_bytes() == data
    served = client.get(body["url"])
    assert served.status_code == 200 and served.content == data


@pytest.mark.parametrize("data,media_type", [
    (JPEG, "image/jpeg"), (PNG, "image/png"), (WEBP, "image/webp"), (GLB, "model/gltf-binary"),
])
def test_files_are_served_with_a_fixed_type_and_safe_headers(client, data, media_type):
    served = client.get(upload(client, data).json()["url"])
    assert served.headers["content-type"] == media_type
    assert served.headers["x-content-type-options"] == "nosniff"
    assert served.headers["content-security-policy"] == "default-src 'none'"


def test_missing_file_is_404(client, data_dir):
    assert client.get("/api/custom/files/000000000000.png").status_code == 404


def test_the_name_comes_from_the_bytes_not_the_filename(client):
    assert upload(client, PNG, "evil.html").json()["url"].endswith(".png")


@pytest.mark.parametrize("data", [b"", b"hello world", b"<svg></svg>", b"GIF89a....", b"RIFF\x00\x00\x00\x00WAVEfmt ", b"gltf"])
def test_upload_bad_magic(client, data_dir, data):
    r = upload(client, data, "photo.jpg")
    assert r.status_code == 415 and r.json()["detail"]
    assert not (data_dir / "custom").exists()


def test_upload_too_big(client, data_dir):
    assert upload(client, JPEG + bytes(5 * 1024 * 1024 - len(JPEG))).status_code == 200
    assert upload(client, JPEG + bytes(5 * 1024 * 1024 - len(JPEG) + 1)).status_code == 413
    assert upload(client, GLB + bytes(25 * 1024 * 1024 - len(GLB))).status_code == 200
    assert upload(client, GLB + bytes(25 * 1024 * 1024 - len(GLB) + 1)).status_code == 413
    assert len(list((data_dir / "custom" / "files").iterdir())) == 2


def test_upload_needs_a_file(client):
    assert client.post(UPLOADS).status_code == 422


@pytest.mark.parametrize("name", [
    "abc.jpg", "../items.json", "..%2Fitems.json", "%2e%2e/items.json", "000000000000.exe",
    "000000000000.jpg", "items.json", "000000000000.JPG",
])
def test_file_names_are_checked(client, data_dir, name):
    (data_dir / "custom").mkdir(exist_ok=True)
    (data_dir / "custom" / "items.json").write_text("[]", "utf-8")
    assert client.get(f"/api/custom/files/{name}").status_code == 404


def test_create_list_delete(client, data_dir):
    assert client.get(ITEMS).json() == []
    first = client.post(ITEMS, json={**ITEM, "price": 300, "currency": "eur", "url": "https://shop.test/sofa"})
    assert first.status_code == 200
    item = first.json()
    assert re.fullmatch(r"custom-[0-9a-f]{8}", item["id"])
    assert {k: v for k, v in item.items() if k not in ("id", "created_at")} == {
        "title": "Cozy Sofa", "url": "https://shop.test/sofa", "price": 300, "currency": "EUR",
        "size": [2.0, 0.9, 0.8], "label": "sofa", "rgba": [0.7, 0.7, 0.7, 1],
        "model": None, "photo": None, "custom": True,
    }
    assert item["created_at"]
    second = client.post(ITEMS, json={**ITEM, "title": "  Plain Chair  ", "label": "chair"}).json()
    assert second["title"] == "Plain Chair" and second["price"] is None and second["currency"] == "USD"
    assert second["url"] is None
    assert [i["id"] for i in client.get(ITEMS).json()] == [second["id"], item["id"]]
    assert json.loads((data_dir / "custom" / "items.json").read_text("utf-8"))[0]["id"] == item["id"]
    left = client.delete(f"{ITEMS}/{item['id']}")
    assert left.status_code == 200 and [i["id"] for i in left.json()] == [second["id"]]
    assert client.get(ITEMS).json() == left.json()


def test_delete_unknown_item(client):
    assert client.delete(f"{ITEMS}/custom-12345678").status_code == 404
    assert client.delete(f"{ITEMS}/..").status_code in (404, 405)


@pytest.mark.parametrize("change", [
    {"title": ""}, {"title": "   "}, {"title": "x" * 121}, {"label": ""}, {"label": "x" * 41},
    {"price": -1}, {"price": "cheap"}, {"currency": "US"}, {"currency": "DOLLARS"}, {"currency": "U$D"},
    {"size": [1, 1]}, {"size": [1, 1, 1, 1]}, {"size": [0.04, 1, 1]}, {"size": [6.1, 1, 1]},
    {"size": [1, 0.04, 1]}, {"size": [1, 6.1, 1]}, {"size": [1, 1, 0.04]}, {"size": [1, 1, 3.6]},
    {"size": ["a", 1, 1]},
    {"url": "javascript:alert(1)"}, {"url": "ftp://x.test/a"}, {"url": "/relative"}, {"url": "http://x.test/" + "a" * 2000},
    {"image_url": "file:///etc/passwd"},
    {"photo": "https://x.test/a.jpg"}, {"photo": "/api/custom/files/../../x.jpg"},
    {"photo": "/api/custom/files/000000000000.glb"}, {"model": "/api/custom/files/000000000000.jpg"},
    {"model": "/files/x.glb"},
])
def test_validation(client, data_dir, change):
    assert client.post(ITEMS, json={**ITEM, **change}).status_code == 422
    assert not (data_dir / "custom" / "items.json").exists()


def test_infinite_size_is_rejected(client):
    body = '{"title": "x", "label": "x", "size": [1, 1, Infinity]}'
    r = client.post(ITEMS, content=body, headers={"content-type": "application/json"})
    assert r.status_code == 422


@pytest.mark.parametrize("change", [{"size": [0.05, 6, 3.5]}, {"size": [6, 0.05, 0.05]}, {"price": 0}, {"url": ""}])
def test_validation_edges_are_allowed(client, change):
    assert client.post(ITEMS, json={**ITEM, **change}).status_code == 200


def test_missing_required_fields(client):
    for key in ("title", "size", "label"):
        assert client.post(ITEMS, json={k: v for k, v in ITEM.items() if k != key}).status_code == 422


def test_photo_and_model_must_exist(client):
    photo = upload(client, JPEG).json()["url"]
    model = upload(client, GLB).json()["url"]
    item = client.post(ITEMS, json={**ITEM, "photo": photo, "model": model}).json()
    assert item["photo"] == photo and item["model"] == model
    assert client.post(ITEMS, json={**ITEM, "photo": "/api/custom/files/000000000000.jpg"}).status_code == 422
    assert client.post(ITEMS, json={**ITEM, "model": "/api/custom/files/000000000000.glb"}).status_code == 422


def test_deleting_an_item_keeps_its_files(client, data_dir):
    photo = upload(client, JPEG).json()["url"]
    item = client.post(ITEMS, json={**ITEM, "photo": photo}).json()
    client.delete(f"{ITEMS}/{item['id']}")
    assert client.get(photo).status_code == 200


def test_image_url_is_downloaded(client, net, data_dir):
    net.handler = lambda r: httpx.Response(200, content=PNG, headers={"content-type": "image/png"})
    item = client.post(ITEMS, json={**ITEM, "image_url": "https://shop.test/a.png"}).json()
    assert re.fullmatch(r"/api/custom/files/[0-9a-f]{12}\.png", item["photo"]) and "notes" not in item
    assert client.get(item["photo"]).content == PNG
    assert "image" in net.calls[0].headers["accept"]
    assert "image_url" not in item and client.get(ITEMS).json()[0] == item


def test_image_url_is_skipped_when_a_photo_is_given(client, net):
    photo = upload(client, JPEG).json()["url"]
    item = client.post(ITEMS, json={**ITEM, "photo": photo, "image_url": "https://shop.test/a.png"}).json()
    assert item["photo"] == photo and net.calls == []


@pytest.mark.parametrize("handler", [
    lambda r: httpx.Response(404),
    lambda r: httpx.Response(200, content=b"<html>not an image</html>"),
    lambda r: httpx.Response(200, content=GLB),
    lambda r: httpx.Response(200, content=JPEG + bytes(5 * 1024 * 1024)),
    lambda r: httpx.Response(302, headers={"location": "http://127.0.0.1/a.png"}),
])
def test_failed_image_download_is_skipped_with_a_note(client, net, data_dir, handler):
    net.handler = handler
    r = client.post(ITEMS, json={**ITEM, "image_url": "https://shop.test/a.png"})
    assert r.status_code == 200
    item = r.json()
    assert item["photo"] is None and item["notes"] == ["Couldn't download the product image."]
    assert not (data_dir / "custom" / "files").exists()
    assert "notes" not in client.get(ITEMS).json()[0]


def test_private_image_url_is_not_fetched(client, net):
    item = client.post(ITEMS, json={**ITEM, "image_url": "http://169.254.169.254/a.png"}).json()
    assert item["photo"] is None and item["notes"] and net.calls == []


# --- placing custom items ---

def objects(client):
    return {o["name"]: o for o in client.get(f"/api/rooms/{ROOM}").json()["objects"]}


def make(client, **extra):
    return client.post(ITEMS, json={**ITEM, "price": 120, "url": "https://shop.test/sofa", **extra}).json()


def test_add_custom_item_with_model(client):
    model = upload(client, GLB).json()["url"]
    item = make(client, model=model)
    r = client.post(f"/api/rooms/{ROOM}/objects", json={"catalog_id": item["id"]})
    assert r.status_code == 200
    name = r.json()["added"]
    assert name == item["id"].replace("-", "_")
    obj = objects(client)[name]
    assert obj["mesh"] == model and obj["normalize"] is True and "shape" not in obj
    assert obj["size"] == [2.0, 0.9, 0.8] and obj["label"] == "sofa" and obj["catalog_id"] == item["id"]
    assert obj["product"] == {"title": "Cozy Sofa", "url": "https://shop.test/sofa", "price": 120, "currency": "USD"}
    assert "photo" not in obj
    assert r.json()["total"] == {"amount": 120 + 449 + 50.5, "currency": "USD"}


def test_add_custom_item_without_model_is_a_stand_in(client):
    item = make(client, label="lamp")
    r = client.post(f"/api/rooms/{ROOM}/objects", json={"catalog_id": item["id"]})
    obj = objects(client)[r.json()["added"]]
    assert obj["mesh"] is None and obj["shape"] == "lamp" and "normalize" not in obj


def test_add_custom_item_at_a_spot_and_replace(client):
    item = make(client, size=[0.5, 0.5, 0.8])
    r = client.post(f"/api/rooms/{ROOM}/objects", json={"catalog_id": item["id"], "pos": [1.5, -1.5]})
    assert r.status_code == 200 and objects(client)[r.json()["added"]]["pos"] == [1.5, -1.5, 0.0]
    r = client.post(f"/api/rooms/{ROOM}/objects", json={"catalog_id": item["id"], "replace": "chair"})
    assert r.status_code == 200
    assert objects(client)["chair"]["hidden"] is True
    assert objects(client)[r.json()["added"]]["replaces"] == "chair"


def test_deleted_custom_item_cannot_be_added(client):
    item = make(client)
    client.delete(f"{ITEMS}/{item['id']}")
    assert client.post(f"/api/rooms/{ROOM}/objects", json={"catalog_id": item["id"]}).status_code == 404


def test_catalog_objects_are_unchanged(client):
    r = client.post(f"/api/rooms/{ROOM}/objects", json={"catalog_id": "small-chair"})
    obj = objects(client)[r.json()["added"]]
    assert obj["mesh"] == "catalog/models/small-chair.glb" and "normalize" not in obj


def test_catalog_id_wins_over_custom(client, data_dir):
    assert main.find_item("small-chair")["title"] == "small-chair title"
    assert main.find_item("custom-00000000") is None
    item = make(client)
    assert main.find_item(item["id"])["custom"] is True


def test_design_agent_finds_and_places_custom_items(design, client):
    model = upload(client, GLB).json()["url"]
    item = make(client, model=model, size=[0.5, 0.5, 0.8])
    api = FakeApi([
        [call("find_spots", catalog_id=item["id"], near="chair", against_wall=False)],
        [call("place_item", catalog_id=item["id"], x=1.0, y=-1.0, yaw_degrees=0)],
        [text("Placed it.")],
    ])
    r = design(api)
    assert r.status_code == 200
    assert json.loads(api.result_text(1))
    name = item["id"].replace("-", "_")
    assert r.json()["changes"] == [{"action": "placed", "name": name, "title": "Cozy Sofa"}]
    placed = {o["name"]: o for o in r.json()["room"]["objects"]}[name]
    assert placed["mesh"] == model and placed["normalize"] is True and placed["pos"] == [1.0, -1.0, 0.0]


def test_design_agent_catalog_list_stays_catalog_only(design, client):
    item = make(client)
    api = FakeApi([[call("get_catalog")], [text("ok")]])
    design(api)
    assert item["id"] not in {c["id"] for c in json.loads(api.result_text(1))}



def test_custom_item_takes_a_stand_in_colour(client):
    body = {"title": "LIDÅS Chair", "size": [0.5, 0.55, 0.85], "label": "chair", "rgba": [0.1, 0.1, 0.1, 1]}
    r = client.post("/api/custom-items", json=body)
    assert r.status_code == 200, r.text
    assert r.json()["rgba"] == [0.1, 0.1, 0.1, 1]
    assert client.post("/api/custom-items", json={**body, "rgba": [2, 0, 0, 1]}).status_code == 422
    assert client.post("/api/custom-items", json={k: v for k, v in body.items() if k != "rgba"}).json()["rgba"] == [0.7, 0.7, 0.7, 1]

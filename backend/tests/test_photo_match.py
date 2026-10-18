import json

import pytest

from conftest import ROOM
from otto_api import main, photo_match
from otto_api.photo_match import colour_score, rank, size_score, type_score
from test_agent import FakeApi

JPEG = b"\xff\xd8\xff\xe0" + bytes(64)
URL = "/api/match-photo"


def item(item_id, label, size, price, rgba=(0.5, 0.5, 0.5, 1.0)):
    return {
        "id": item_id, "title": f"{item_id.upper()} title", "label": label, "url": f"https://www.ikea.com/us/en/p/{item_id}/",
        "price": price, "currency": "USD", "size": list(size), "rgba": list(rgba),
        "model": f"models/{item_id}.glb", "photo": f"photos/{item_id}.jpg",
    }


CATALOG = [
    item("white-armchair", "armchair", (0.8, 0.85, 0.8), 199, (0.92, 0.91, 0.88, 1)),
    item("black-armchair", "armchair", (0.8, 0.85, 0.8), 149, (0.1, 0.1, 0.1, 1)),
    item("swivel-chair", "chair", (0.6, 0.6, 0.8), 99, (0.9, 0.9, 0.9, 1)),
    item("loveseat", "sofa", (1.7, 0.9, 0.7), 449, (0.9, 0.9, 0.88, 1)),
    item("desk", "desk", (1.1, 0.4, 0.75), 80),
    item("lamp", "lamp", (0.3, 0.3, 1.5), 40),
    {**item("no-photo-chair", "armchair", (0.8, 0.85, 0.8), 89, (0.95, 0.95, 0.95, 1)), "photo": None, "model": None},
]

WHITE_ARMCHAIR = {
    "found": True, "type": "armchair", "description": "white leather armchair", "colour_hex": "#ebe8e0",
    "colours": ["white"], "materials": ["leather"], "style": ["modern"], "search_query": "white leather armchair",
    "size_cm": {"width": 80, "depth": 85, "height": None},
}


def features_turn(features):
    return [{"type": "text", "text": json.dumps(features)}]


@pytest.fixture
def post(client, monkeypatch):
    monkeypatch.setenv("ANTHROPIC_API_KEY", "test-key")
    monkeypatch.setattr(main, "load_catalog", lambda: CATALOG)

    def run(api, data=JPEG, **form):
        monkeypatch.setattr(main, "make_client", lambda key: api.client())
        return client.post(URL, files={"file": ("chair.jpg", data, "image/jpeg")}, data=form)

    return run


# ---- ranking, no model ----

def test_type_score_same_related_unrelated():
    assert type_score("armchair", "armchair") == 1
    assert type_score("couch", "sofa") == 1  # same family
    assert 0 < type_score("armchair", "chair") < 1
    assert type_score("armchair", "lamp") == 0


def test_colour_score_prefers_the_same_colour():
    assert colour_score("#ffffff", [1, 1, 1, 1]) == pytest.approx(1)
    assert colour_score("#ffffff", [0, 0, 0, 1]) == pytest.approx(0)
    assert colour_score("not a colour", [0, 0, 0, 1]) == 0.5


def test_size_score_uses_only_the_estimated_sides():
    assert size_score({"width": 80, "depth": None, "height": None}, [0.8, 5, 5]) == pytest.approx(1)
    assert size_score({"width": 40, "depth": None, "height": None}, [0.8, 5, 5]) == pytest.approx(0.5)
    assert size_score({"width": None, "depth": None, "height": None}, [1, 1, 1]) == 0.5
    assert size_score(None, [1, 1, 1]) == 0.5


def test_rank_puts_the_lookalike_first_and_drops_other_types():
    ranked = rank(WHITE_ARMCHAIR, CATALOG)
    ids = [m["item"]["id"] for m in ranked]
    assert ids[0] == "white-armchair"
    assert "black-armchair" in ids
    assert "desk" not in ids and "lamp" not in ids
    assert len(ranked) == 3
    assert ranked[0]["why"] == "Same type, white and close in size"  # names the colour and material words it matched


def test_rank_falls_back_to_related_types():
    ranked = rank({**WHITE_ARMCHAIR, "type": "armchair"}, [c for c in CATALOG if c["label"] != "armchair"])
    assert {m["item"]["id"] for m in ranked} == {"swivel-chair", "loveseat"}  # chair and sofa stand in for an armchair
    assert all(m["why"].startswith("A close type") for m in ranked)


BLACK_LEATHER_CHAIR = {
    "found": True, "type": "chair", "description": "black leather dining chair with metal legs", "colour_hex": "#1a1a1a",
    "colours": ["black"], "materials": ["leather", "metal"], "style": ["modern"], "search_query": "black leather dining chair",
    "size_cm": {"width": None, "depth": None, "height": None},
}


def live_item(item_id, title, size=(0.5, 0.55, 0.85), price=99.0):
    return {**item(item_id, "chair", size, price), "title": title, "source": "ikea", "rgba": None,
            "image_url": f"https://www.ikea.com/us/en/images/products/{item_id}.jpg", "model": None, "photo": None}


def test_rank_prefers_titles_with_the_colour_and_material_it_saw():
    grey = live_item("grey", "ODGER Chair - anthracite")
    black = live_item("black", "LIDÅS Chair - black leather")
    ranked = rank(BLACK_LEATHER_CHAIR, [grey, black])
    assert [m["item"]["id"] for m in ranked] == ["black", "grey"]
    assert ranked[0]["why"].startswith("Same type, black leather")


def test_wanted_words_skips_filler():
    assert photo_match.wanted_words({"colours": ["dark brown", "black"], "materials": ["faux leather"]}) == ["brown", "black", "faux", "leather"]


def test_search_size_uses_the_estimate_or_a_typical_size():
    assert photo_match.search_size(BLACK_LEATHER_CHAIR) == [0.5, 0.55, 0.85]
    est = {**BLACK_LEATHER_CHAIR, "size_cm": {"width": 46, "depth": None, "height": 80}}
    assert photo_match.search_size(est) == [0.46, 0.55, 0.8]


def test_rank_nothing_for_an_unknown_type():
    assert rank({**WHITE_ARMCHAIR, "type": "other"}, CATALOG) == []


# ---- the endpoint, with the model scripted ----

def test_match_photo_returns_ranked_matches_and_sends_the_image(post):
    api = FakeApi([features_turn(WHITE_ARMCHAIR)])
    r = post(api)
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["features"]["type"] == "armchair"
    assert [m["id"] for m in body["matches"]][0] == "white-armchair"
    assert body["matches"][0]["photo_url"] == "/api/catalog/white-armchair/photo"
    assert "fits" not in body["matches"][0]  # no room given
    sent = api.body(0)
    assert sent["output_config"]["format"]["type"] == "json_schema"
    assert "tool_choice" not in sent and "tools" not in sent  # this model can't be forced to call a tool
    assert sent["fallbacks"] == "default"
    image = sent["messages"][0]["content"][0]
    assert image["type"] == "image" and image["source"]["media_type"] == "image/jpeg"


def test_match_photo_every_piece_gets_a_photo_url(post):
    r = post(FakeApi([features_turn(WHITE_ARMCHAIR)]))
    by_id = {m["id"]: m for m in r.json()["matches"]}
    assert by_id["no-photo-chair"]["photo_url"] == "/api/catalog/no-photo-chair/photo"


def test_match_photo_live_adds_ikea_finds_ranked_with_the_catalog(post, monkeypatch):
    found = [live_item("lidas", "LIDÅS Chair - black leather")]
    seen = []
    monkeypatch.setattr(photo_match, "ikea_finds", lambda client, features: seen.append(features["search_query"]) or found)
    r = post(FakeApi([features_turn(BLACK_LEATHER_CHAIR)]), live="true")
    assert r.status_code == 200, r.text
    first = r.json()["matches"][0]
    assert first["id"] == "lidas" and first["source"] == "ikea"
    assert first["photo_url"] is None and first["image_url"].startswith("https://www.ikea.com/")
    assert seen == ["black leather dining chair"]


def test_match_photo_without_live_does_not_search_ikea(post, monkeypatch):
    monkeypatch.setattr(photo_match, "ikea_finds", lambda client, features: pytest.fail("searched IKEA"))
    assert post(FakeApi([features_turn(WHITE_ARMCHAIR)])).status_code == 200


def test_match_photo_live_falls_back_to_the_catalog_when_ikea_fails(post, monkeypatch):
    def down(client, features):
        raise photo_match.AgentError("IKEA search is unavailable right now.")

    monkeypatch.setattr(photo_match, "ikea_finds", down)
    r = post(FakeApi([features_turn(WHITE_ARMCHAIR)]), live="true")
    assert r.status_code == 200 and r.json()["matches"][0]["id"] == "white-armchair"


def test_ikea_finds_searches_with_the_photo_and_colours_the_stand_in(monkeypatch):
    prompts = []

    def find(client, prompt, system):
        prompts.append((prompt, system))
        return [{"url": "https://www.ikea.com/us/en/p/lidas-chair-s123456/", "why": "black leather"}]

    monkeypatch.setattr(photo_match.ikea, "find_products", find)
    monkeypatch.setattr(photo_match.ikea, "shortlist", lambda products, wanted: [live_item("lidas", "LIDÅS Chair - black")])
    items = photo_match.ikea_finds(object(), BLACK_LEATHER_CHAIR)
    assert items[0]["rgba"] == [0.102, 0.102, 0.102, 1.0]  # the photo's black, for the stand-in shape
    prompt, system = prompts[0]
    assert "black leather dining chair" in prompt and system is photo_match.IKEA_SYSTEM


def test_match_photo_fit_checks_against_a_room(post):
    r = post(FakeApi([features_turn(WHITE_ARMCHAIR)]), room_id=ROOM)
    assert r.status_code == 200, r.text
    first = r.json()["matches"][0]
    assert first["fits"] is True and first["problems"] == []


def test_match_photo_flags_what_does_not_fit(post, data_dir):
    scene_path = data_dir / "rooms" / ROOM / "scene.json"
    scene = json.loads(scene_path.read_text())
    scene["room"]["ceiling_height"] = 0.5  # nothing is that short
    scene_path.write_text(json.dumps(scene))
    r = post(FakeApi([features_turn(WHITE_ARMCHAIR)]), room_id=ROOM)
    first = r.json()["matches"][0]
    assert first["fits"] is False and "Taller than the ceiling" in first["problems"]


def test_match_photo_no_furniture(post):
    r = post(FakeApi([features_turn({**WHITE_ARMCHAIR, "found": False})]))
    assert r.json()["matches"] == []
    assert "couldn't spot" in r.json()["message"]


def test_match_photo_rejects_non_images_before_calling_the_model(post):
    api = FakeApi([features_turn(WHITE_ARMCHAIR)])
    r = post(api, data=b"%PDF-1.4 not an image")
    assert r.status_code == 415
    assert api.requests == []


def test_match_photo_unknown_room_is_404_without_a_model_call(post):
    api = FakeApi([features_turn(WHITE_ARMCHAIR)])
    assert post(api, room_id="nope").status_code == 404
    assert api.requests == []


def test_match_photo_needs_an_api_key(client, monkeypatch):
    monkeypatch.delenv("ANTHROPIC_API_KEY", raising=False)
    r = client.post(URL, files={"file": ("chair.jpg", JPEG, "image/jpeg")})
    assert r.status_code == 503


def test_match_photo_unreadable_reply_is_502(post):
    assert post(FakeApi([[{"type": "text", "text": "not json"}]])).status_code == 502


def test_match_photo_model_failure_is_502(post):
    assert post(FakeApi([features_turn(WHITE_ARMCHAIR)], status=500)).status_code == 502


def test_max_matches_is_small_enough_for_a_text_reply():
    assert photo_match.MAX_MATCHES <= 3


# ---- catalog photos ----

PNG = b"\x89PNG\r\n\x1a\n" + bytes(32)


@pytest.fixture
def shop(client, data_dir, monkeypatch):
    (data_dir / "catalog" / "photos").mkdir(parents=True, exist_ok=True)
    (data_dir / "catalog" / "photos" / "white-armchair.jpg").write_bytes(JPEG)
    monkeypatch.setattr(main, "load_catalog", lambda: CATALOG + [
        {**item("off-site", "chair", (0.5, 0.5, 0.8), 10), "photo": None, "url": "https://example.com/p/x"},
    ])
    fetched = []

    def from_page(url):
        fetched.append(url)
        return PNG

    monkeypatch.setattr(photo_match, "product_photo_from_page", from_page)
    return fetched


def test_catalog_photo_serves_a_stored_photo(client, shop):
    r = client.get("/api/catalog/white-armchair/photo")
    assert r.status_code == 200 and r.content == JPEG
    assert shop == []


def test_catalog_photo_fetches_from_ikea_once_then_caches(client, shop, data_dir):
    first = client.get("/api/catalog/no-photo-chair/photo")
    assert first.status_code == 200 and first.content == PNG
    assert first.headers["content-type"] == "image/png"
    assert (data_dir / "catalog" / "photo-cache" / "no-photo-chair.png").is_file()
    again = client.get("/api/catalog/no-photo-chair/photo")
    assert again.content == PNG
    assert shop == ["https://www.ikea.com/us/en/p/no-photo-chair/"]  # fetched once


def test_catalog_photo_only_from_ikea_and_404_otherwise(client, shop, monkeypatch):
    assert client.get("/api/catalog/off-site/photo").status_code == 404
    assert client.get("/api/catalog/nope/photo").status_code == 404
    assert shop == []

    def broken(url):
        raise photo_match.FetchError("down")

    monkeypatch.setattr(photo_match, "product_photo_from_page", broken)
    assert client.get("/api/catalog/no-photo-chair/photo").status_code == 404


def test_catalog_photo_refuses_a_non_image(client, shop, monkeypatch):
    monkeypatch.setattr(photo_match, "product_photo_from_page", lambda url: b"<html>not an image</html>")
    assert client.get("/api/catalog/no-photo-chair/photo").status_code == 404



def test_title_colour_score_marks_clashing_colours_down():
    s = photo_match.title_colour_score
    assert s(["black"], "LIDÅS Chair - black") == 1.0
    assert s(["grey", "black"], "LÄKTARE Conference chair - medium gray/black") == 1.0  # gray counts as grey
    assert s(["grey", "black"], "SKÅLSTA Chair - plastic red/tubular metal/black-gray") == 0.55  # red clashes
    assert s(["black"], "ODGER Chair - white") == 0.2
    assert s(["black"], "ADDE Chair") == 0.5  # no colour named


def test_note_steers_the_reading(post):
    api = FakeApi([features_turn(WHITE_ARMCHAIR)])
    post(api, note="black leather ones please")
    prompt = api.body(0)["messages"][0]["content"][1]["text"]
    assert '"black leather ones please"' in prompt and "wins over the photo" in prompt
    plain = FakeApi([features_turn(WHITE_ARMCHAIR)])
    post(plain)
    assert "person said" not in plain.body(0)["messages"][0]["content"][1]["text"]

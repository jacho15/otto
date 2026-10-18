import json
from types import SimpleNamespace

import httpx
import pytest

from conftest import ROOM
from otto_api import ikea, main
from test_agent import FakeApi, text

URL = f"/api/rooms/{ROOM}/objects/chair/alternatives/ikea"
BASE = "https://www.ikea.com/us/en/p"
HOST_IP = "93.184.216.40"


class Scripted(FakeApi):
    """FakeApi with a stop reason for each turn: stops[n] is used for request n."""

    def __init__(self, turns, stops=None, **kwargs):
        super().__init__(turns, **kwargs)
        self.stops = stops

    @property
    def stop_reason(self):
        return self.stops[len(self.requests) - 1] if self.stops else None

    @stop_reason.setter
    def stop_reason(self, value):
        pass


def search_turn(*urls):
    return [
        {"type": "server_tool_use", "id": "srvtoolu_1", "name": "web_search", "input": {"query": "ikea chair"}},
        {"type": "web_search_tool_result", "tool_use_id": "srvtoolu_1", "content": [
            {"type": "web_search_result", "url": u, "title": "t", "encrypted_content": "abc", "page_age": None}
            for u in urls
        ]},
    ]


def report(*urls, why="Same type, close size."):
    products = [{"url": u, "why": why} for u in urls]
    return {"type": "tool_use", "id": "toolu_report", "name": "report_products", "input": {"products": products}}


def page(title, price, dims, currency="USD", image="https://www.ikea.com/images/x.jpg"):
    """A product page: JSON-LD for the name, price and image, and a size line in cm."""
    ld = {"@type": "Product", "name": title, "image": image,
          "offers": {"@type": "Offer", "price": price, "priceCurrency": currency}}
    size = f"Width: {dims[0]} cm Depth: {dims[1]} cm Height: {dims[2]} cm" if dims else "No size here."
    return (f'<html><head><script type="application/ld+json">{json.dumps(ld)}</script></head>'
            f"<body><p>{size}</p></body></html>")


# The chair in the test room is 0.6 x 0.6 x 0.8 m and costs 50.50 USD.
PAGES = {
    "/us/en/p/good": page("GOOD chair", 40, (60, 60, 80)),
    "/us/en/p/cheaper": page("CHEAPER chair", 30, (55, 55, 80)),
    "/us/en/p/wide": page("WIDE chair", 20, (60, 360, 80)),
    "/us/en/p/table": page("FANCY table", 10, (60, 60, 80)),
    "/us/en/p/dear": page("DEAR chair", 80, (60, 60, 80)),
    "/us/en/p/same-price": page("SAME chair", 50.5, (60, 60, 80)),
    "/us/en/p/nosize": page("NOSIZE chair", 20, None),
    "/us/en/p/tiny": page("TINY chair", 5, (20, 20, 30)),
    "/us/en/p/euro": page("EURO chair", 20, (60, 60, 80), currency="EUR"),
    "/us/en/p/noprice": page("NOPRICE chair", "", (60, 60, 80)),
    "/us/en/p/mine": page("MINE chair", 10, (60, 60, 80)),
}


@pytest.fixture
def ikea_api(client, net, monkeypatch):
    """Run the IKEA route against a FakeApi and fake IKEA pages. Returns run(api)."""
    monkeypatch.setenv("ANTHROPIC_API_KEY", "test-key")
    net.hosts["www.ikea.com"] = HOST_IP
    net.hosts["shop.ikea.com"] = HOST_IP
    net.hosts["evil.example.net"] = "93.184.216.41"
    net.pages = dict(PAGES)

    def serve(request):
        body = net.pages.get(request.url.path)
        if body is None:
            return httpx.Response(404)
        return httpx.Response(200, text=body, headers={"content-type": "text/html"})

    net.handler = serve

    def run(api, name="chair"):
        monkeypatch.setattr(main, "make_client", lambda key: api.client())
        return client.post(f"/api/rooms/{ROOM}/objects/{name}/alternatives/ikea")

    return run


def edit_chair(data_dir, **changes):
    path = data_dir / "rooms" / ROOM / "scene.json"
    scene = json.loads(path.read_text("utf-8"))
    chair = next(o for o in scene["objects"] if o["name"] == "chair")
    for key, value in changes.items():
        if value is None:
            chair.pop(key, None)
        else:
            chair[key] = value
    path.write_text(json.dumps(scene), "utf-8")


def one_turn(*names):
    return Scripted([search_turn(*[f"{BASE}/{n}" for n in names]) + [report(*[f"{BASE}/{n}" for n in names])]])


def ids(response):
    return [a["title"] for a in response.json()["alternatives"]]


def test_filters(ikea_api, data_dir, net):
    edit_chair(data_dir, product={"title": "chair", "price": 50.5, "currency": "USD", "url": f"{BASE}/mine/"})
    wanted = ["good", "table", "dear", "same-price", "nosize", "tiny", "euro", "noprice", "mine"]
    api = Scripted([search_turn() + [report(
        *[f"{BASE}/{n}" for n in wanted],
        "https://evil.example.net/us/en/p/good",
        "https://ikea.com.evil.example.net/us/en/p/good",
        "ftp://www.ikea.com/us/en/p/good",
        "javascript:alert(1)",
    )]])
    r = ikea_api(api)
    assert r.status_code == 200
    assert ids(r) == ["GOOD chair"]
    fetched = {c.url.path for c in net.calls}
    assert "/us/en/p/mine" not in fetched  # the piece's own page is never fetched
    assert {c.headers["host"] for c in net.calls} == {"www.ikea.com"}  # off-host addresses are never fetched


def test_fields_and_savings(ikea_api):
    r = ikea_api(one_turn("good"))
    body = r.json()
    assert body["object"] == "chair" and body["price"] == 50.5 and body["currency"] == "USD"
    assert body["message"] == "Found 1 cheaper similar piece on IKEA."
    alt = body["alternatives"][0]
    assert alt["source"] == "ikea" and alt["catalog_id"] is None
    assert alt["url"] == f"{BASE}/good" and alt["image_url"] == "https://www.ikea.com/images/x.jpg"
    assert alt["title"] == "GOOD chair" and alt["label"] == "chair"
    assert alt["price"] == 40 and alt["currency"] == "USD" and alt["size"] == [0.6, 0.6, 0.8]
    assert alt["savings"] == 10.5 and alt["savings_pct"] == 21
    assert alt["similarity"] == 1.0 and alt["why"] == "Same type, close size."
    assert alt["fits"] is True and alt["problems"] == []
    assert alt["model"] is None and alt["photo"] is None and alt["id"].startswith("ikea-")
    assert set(alt) >= {"id", "title", "label", "url", "price", "currency", "size", "rgba", "model", "photo"}


def test_sort_fits_first_then_savings_then_similarity(ikea_api):
    r = ikea_api(one_turn("good", "wide", "cheaper"))
    assert ids(r) == ["CHEAPER chair", "GOOD chair", "WIDE chair"]
    wide = r.json()["alternatives"][2]
    assert wide["fits"] is False and wide["problems"]
    assert [a["savings"] for a in r.json()["alternatives"][:2]] == [20.5, 10.5]


def test_similarity_breaks_a_savings_tie(ikea_api, net):
    net.pages["/us/en/p/a"] = page("A chair", 40, (60, 60, 80))
    net.pages["/us/en/p/b"] = page("B chair", 40, (50, 50, 80))
    r = ikea_api(one_turn("b", "a"))
    assert ids(r) == ["A chair", "B chair"]


def test_at_most_five(ikea_api, net):
    names = [f"c{i}" for i in range(8)]
    for i, n in enumerate(names):
        net.pages[f"/us/en/p/{n}"] = page(f"C{i} chair", 40 - i, (60, 60, 80))
    r = ikea_api(one_turn(*names))
    assert len(r.json()["alternatives"]) == 5
    assert r.json()["alternatives"][0]["title"] == "C7 chair"


def test_failed_pages_are_skipped(ikea_api):
    r = ikea_api(one_turn("good", "missing"))  # the second one answers 404
    assert r.status_code == 200 and ids(r) == ["GOOD chair"]


def test_no_price_shows_similar_pieces_without_savings(ikea_api, data_dir):
    edit_chair(data_dir, product=None)
    r = ikea_api(one_turn("dear", "good", "noprice", "euro", "tiny"))
    body = r.json()
    assert body["price"] is None and body["currency"] == "USD"
    assert sorted(ids(r)) == ["DEAR chair", "EURO chair", "GOOD chair", "NOPRICE chair"]
    assert all(a["savings"] is None and a["savings_pct"] is None for a in body["alternatives"])
    assert body["message"] == "Found 4 similar pieces on IKEA."
    assert next(a for a in body["alternatives"] if a["title"] == "NOPRICE chair")["price"] is None
    assert "cheaper" not in body["message"]


def test_empty_message(ikea_api):
    r = ikea_api(one_turn("dear", "table"))
    assert r.json()["alternatives"] == []
    assert r.json()["message"] == "No cheaper similar pieces found on IKEA right now."


def test_label_comes_from_the_address_when_the_title_has_no_type(ikea_api, net, data_dir):
    edit_chair(data_dir, label="couch")
    net.pages["/us/en/p/kivik-3-seat-sofa-tibbleby-beige-s69440456"] = page("KIVIK", 20, (60, 60, 80))
    r = ikea_api(one_turn("kivik-3-seat-sofa-tibbleby-beige-s69440456", "good"))
    assert ids(r) == ["Kivik 3 Seat Sofa Tibbleby Beige"]  # a couch matches a sofa; a chair does not
    assert r.json()["alternatives"][0]["label"] == "sofa"


def test_request_shape(ikea_api, data_dir):
    edit_chair(data_dir, rgba=[1.0, 0.0, 0.0, 1.0])
    api = one_turn("good")
    ikea_api(api)
    request, body = api.requests[0], api.body(0)
    assert body["model"] == "claude-opus-5-5"
    assert body["thinking"] == {"type": "adaptive"} and body["output_config"] == {"effort": "low"}
    assert body["fallbacks"] == "default"
    assert "server-side-fallback-2026-07-01" in request.headers["anthropic-beta"]
    for key in ("temperature", "tool_choice"):
        assert key not in body
    search, report_tool = body["tools"]
    assert search == {"type": "web_search_20260209", "name": "web_search", "allowed_domains": ["ikea.com"], "max_uses": 3}
    assert report_tool["name"] == "report_products" and report_tool["strict"] is True
    assert report_tool["input_schema"]["additionalProperties"] is False
    prompt = body["messages"][0]["content"]
    for part in ('"type": "chair"', "[60, 60, 80]", "50.5", "USD", "#ff0000"):
        assert part in prompt


def test_needs_an_api_key(client, net, monkeypatch):
    r = client.post(URL)
    assert r.status_code == 503 and r.json()["detail"] == "Add ANTHROPIC_API_KEY to .env"


def test_missing_and_hidden_pieces_are_404(ikea_api, client, data_dir):
    api = one_turn("good")
    assert ikea_api(api, "nope").status_code == 404
    edit_chair(data_dir, hidden=True)
    assert ikea_api(api).status_code == 404
    assert client.post(f"/api/rooms/nope/objects/chair/alternatives/ikea").status_code == 404
    assert api.requests == []


def test_fixed_piece_is_not_searched(ikea_api):
    api = one_turn("good")
    r = ikea_api(api, "shelf")
    assert r.status_code == 200 and r.json()["alternatives"] == [] and r.json()["message"]
    assert api.requests == []


def test_pause_turn_is_continued(ikea_api):
    paused = search_turn(f"{BASE}/good")
    api = Scripted([paused, search_turn(f"{BASE}/good") + [report(f"{BASE}/good")]], stops=["pause_turn", "tool_use"])
    r = ikea_api(api)
    assert r.status_code == 200 and ids(r) == ["GOOD chair"]
    assert len(api.requests) == 2
    messages = api.body(1)["messages"]
    assert [m["role"] for m in messages] == ["user", "assistant"]  # no extra user message
    assert messages[1]["content"][0]["type"] == "server_tool_use"


def test_pause_turn_gives_up(ikea_api):
    api = Scripted([search_turn()], stops=["pause_turn"] * 10)
    r = ikea_api(api)
    assert r.status_code == 502 and "too long" in r.json()["detail"]
    assert len(api.requests) == ikea.MAX_RESUMES + 1


def test_refusal(ikea_api):
    r = ikea_api(Scripted([[text("no")]], stops=["refusal"]))
    assert r.status_code == 502 and "declined" in r.json()["detail"]


def test_max_tokens(ikea_api):
    r = ikea_api(Scripted([[report(f"{BASE}/good")]], stops=["max_tokens"]))
    assert r.status_code == 502 and "cut off" in r.json()["detail"]


def test_no_report_is_asked_for_once(ikea_api):
    api = Scripted([[text("I looked around.")], [report(f"{BASE}/good")]])
    r = ikea_api(api)
    assert ids(r) == ["GOOD chair"] and len(api.requests) == 2
    last = api.body(1)["messages"][-1]
    assert last["role"] == "user" and "report_products" in last["content"]


def test_no_report_twice_gives_nothing(ikea_api):
    api = Scripted([[text("Nothing.")]])
    r = ikea_api(api)
    assert r.status_code == 200 and r.json()["alternatives"] == [] and len(api.requests) == 2


def test_search_error_is_readable(ikea_api):
    error = [
        {"type": "server_tool_use", "id": "srvtoolu_1", "name": "web_search", "input": {"query": "x"}},
        {"type": "web_search_tool_result", "tool_use_id": "srvtoolu_1",
         "content": {"type": "web_search_tool_result_error", "error_code": "unavailable"}},
    ]
    r = ikea_api(Scripted([error]))
    assert r.status_code == 502 and "unavailable" in r.json()["detail"]


def test_api_error_is_readable(ikea_api):
    r = ikea_api(Scripted([[]], status=500))
    assert r.status_code == 502 and "Anthropic API error (500)" in r.json()["detail"]


def test_room_is_not_changed(ikea_api, data_dir):
    path = data_dir / "rooms" / ROOM / "scene.json"
    before = path.read_text("utf-8")
    ikea_api(one_turn("good", "wide"))
    assert path.read_text("utf-8") == before
    assert not (data_dir / "rooms" / ROOM / "history.json").exists()


def test_why_is_cut_to_twelve_words(ikea_api):
    long = " ".join(f"w{i}" for i in range(30))
    api = Scripted([[report(f"{BASE}/good", why=long)]])
    assert len(ikea_api(api).json()["alternatives"][0]["why"].split()) == 12


def test_similarity_bounds():
    assert ikea.similarity("chair", [0.6, 0.6, 0.8], "chair", [0.6, 0.6, 0.8]) == 1.0
    assert ikea.similarity("chair", [0.3, 0.6, 0.8], "chair", [0.6, 0.6, 0.8]) == 0.83
    assert ikea.similarity("chair", [6, 3, 3], "chair", [0.05, 0.05, 0.05]) == 0.01
    assert ikea.similarity("sofa", [0.6, 0.6, 0.8], "chair", [0.6, 0.6, 0.8]) == 0.0
    assert ikea.similarity("couch", [0.6, 0.6, 0.8], "loveseat", [0.6, 0.6, 0.8]) == 1.0
    for a, b in (([1, 1, 1], [2, 5, 0.1]), ([0, 0, 0], [0, 0, 0]), ([0.2, 1, 0.5], [0.2, 1, 0.5])):
        assert 0.0 <= ikea.similarity("desk", a, "desk", b) <= 1.0


def test_ikea_host():
    for url in ("https://www.ikea.com/us/en/p/x/", "https://ikea.com/x", "https://SHOP.IKEA.com/x"):
        assert ikea.ikea_host(url)
    for url in ("https://ikea.com.evil.net/x", "https://notikea.com/x", "ftp://ikea.com/x", "ikea.com/x",
                "https://evil.net/ikea.com", "https://[bad/x", "http://ikea.com/x", "http://www.ikea.com/us/en/p/x"):
        assert not ikea.ikea_host(url)


def test_search_results_are_used_when_the_report_is_empty(ikea_api):
    api = Scripted([search_turn(f"{BASE}/good", f"{BASE}/cheaper") + [report()]])
    r = ikea_api(api)
    assert sorted(ids(r)) == ["CHEAPER chair", "GOOD chair"]
    assert {a["why"] for a in r.json()["alternatives"]} == {"From IKEA search results"}


def test_search_results_are_used_when_the_report_never_comes(ikea_api):
    api = Scripted([search_turn(f"{BASE}/good") + [text("Done.")], [text("Still no report.")]])
    r = ikea_api(api)
    assert ids(r) == ["GOOD chair"] and len(api.requests) == 2


def test_report_and_search_results_are_merged(ikea_api):
    api = Scripted([
        search_turn(f"{BASE}/good", f"{BASE}/cheaper/") + [text("x")],
        search_turn(f"{BASE}/cheaper?x=1", f"{BASE}/dear") + [report(f"{BASE}/cheaper")],
    ], stops=["pause_turn", "tool_use"])
    products = ikea.find_products(api.client(), "find")
    assert [p["url"] for p in products] == [f"{BASE}/cheaper", f"{BASE}/good", f"{BASE}/dear"]
    assert products[0]["why"] == "Same type, close size."
    assert products[1]["why"] == "From IKEA search results"


def test_category_and_other_search_results_are_skipped(ikea_api, net):
    api = Scripted([search_turn(
        "https://www.ikea.com/us/en/cat/chairs-fu002/",
        "https://www.ikea.com/us/en/",
        "http://www.ikea.com/us/en/p/good",
        "https://evil.example.net/us/en/p/good",
        f"{BASE}/cheaper",
    ) + [report()]])
    r = ikea_api(api)
    assert ids(r) == ["CHEAPER chair"]
    assert {c.url.path for c in net.calls} == {"/us/en/p/cheaper"}


def test_only_web_search_results_are_used(ikea_api):
    code = {"type": "code_execution_tool_result", "tool_use_id": "srvtoolu_2", "content": {
        "type": "code_execution_result", "stdout": f"{BASE}/good", "stderr": "", "return_code": 0, "content": [],
    }}
    r = ikea_api(Scripted([[code, report()]]))
    assert r.status_code == 200 and r.json()["alternatives"] == []


def fake_clock(monkeypatch):
    now = [1000.0]
    monkeypatch.setattr(ikea, "time", SimpleNamespace(monotonic=lambda: now[0]))
    return now


def test_one_deadline_for_all_calls_keeps_what_was_found(ikea_api, monkeypatch):
    now = fake_clock(monkeypatch)
    api = Scripted([search_turn(f"{BASE}/good")] * 3, stops=["pause_turn"] * 3, before=lambda n: now.__setitem__(0, now[0] + 40))
    r = ikea_api(api)
    assert ids(r) == ["GOOD chair"]
    assert len(api.requests) == 2  # the third ask would start after 80 s


def test_deadline_without_results_is_an_error(ikea_api, monkeypatch):
    now = fake_clock(monkeypatch)
    api = Scripted([search_turn()] * 3, stops=["pause_turn"] * 3, before=lambda n: now.__setitem__(0, now[0] + 70))
    r = ikea_api(api)
    assert r.status_code == 502 and "too long" in r.json()["detail"]
    assert len(api.requests) == 1


def test_each_call_gets_the_time_that_is_left(monkeypatch):
    now = fake_clock(monkeypatch)
    seen = []

    def ask(client, messages, timeout):
        seen.append(timeout)
        now[0] += 25
        return SimpleNamespace(stop_reason="pause_turn", content=[])

    monkeypatch.setattr(ikea, "ask", ask)
    with pytest.raises(ikea.AgentError):
        ikea.find_products(None, "find")
    assert seen == [60, 35, 10]


def test_redirect_off_ikea_is_refused_before_the_next_request(ikea_api, net):
    def serve(request):
        if request.url.path == "/us/en/p/good":
            return httpx.Response(302, headers={"location": "https://evil.example.net/us/en/p/good"})
        return httpx.Response(200, text=PAGES["/us/en/p/good"], headers={"content-type": "text/html"})

    net.handler = serve
    r = ikea_api(one_turn("good"))
    assert r.status_code == 200 and r.json()["alternatives"] == []
    assert len(net.calls) == 1 and net.calls[0].headers["host"] == "www.ikea.com"


def test_redirect_to_another_ikea_page_is_followed(ikea_api, net):
    def serve(request):
        if request.url.path == "/us/en/p/old":
            return httpx.Response(301, headers={"location": "https://shop.ikea.com/us/en/p/good"})
        return httpx.Response(200, text=PAGES["/us/en/p/good"], headers={"content-type": "text/html"})

    net.handler = serve
    assert ids(ikea_api(one_turn("old"))) == ["GOOD chair"]

import json
import time

import httpx
import pytest

from otto_api.importer import SIZE_NOTE, guess_label, parse_product, read_size

URL = "https://shop.test/p/hemnes"
LINK = "/api/import/link"


def page(head="", body=""):
    return f"<html><head><title>Shop page</title>{head}</head><body>{body}</body></html>"


def ld(data):
    return f'<script type="application/ld+json">{json.dumps(data)}</script>'


def parse(head="", body=""):
    return parse_product(page(head, body), URL)


def test_json_ld_product():
    draft = parse(ld({
        "@context": "https://schema.org",
        "@type": "Product",
        "name": "KIVIK Sofa &amp; Chaise",
        "image": "https://cdn.test/a.jpg",
        "offers": {"@type": "Offer", "price": 799, "priceCurrency": "usd"},
    }))
    assert draft["title"] == "KIVIK Sofa & Chaise"
    assert draft["price"] == 799 and draft["currency"] == "USD"
    assert draft["image_url"] == "https://cdn.test/a.jpg"
    assert draft["url"] == URL and draft["label"] == "sofa"


def test_json_ld_in_graph_with_offer_list():
    draft = parse(ld({"@graph": [
        {"@type": "WebSite", "name": "Shop"},
        {
            "@type": ["Thing", "Product"],
            "name": "Oak Desk",
            "image": [{"@type": "ImageObject", "url": "/img/desk.jpg"}],
            "offers": [{"@type": "Offer"}, {"@type": "Offer", "price": "1,299.50", "priceCurrency": "CAD"}],
        },
    ]}))
    assert draft["title"] == "Oak Desk"
    assert draft["price"] == 1299.5 and draft["currency"] == "CAD"
    assert draft["image_url"] == "https://shop.test/img/desk.jpg"
    assert draft["label"] == "desk"


def test_json_ld_list_and_aggregate_offer():
    draft = parse(ld([
        {"@type": "BreadcrumbList"},
        {"@type": "Product", "name": "Floor Lamp",
         "offers": {"@type": "AggregateOffer", "lowPrice": "39.99", "highPrice": "59", "priceCurrency": "EUR"}},
    ]))
    assert draft["price"] == 39.99 and draft["currency"] == "EUR"


def test_deeply_nested_json_ld_is_skipped():
    nested = "[" * 100_000 + "]" * 100_000  # json.loads raises RecursionError
    head = f'<script type="application/ld+json">{nested}</script><meta property="og:title" content="Wing Chair">'
    assert parse(head)["title"] == "Wing Chair"


def test_json_ld_nesting_has_a_depth_limit():
    def graph(depth):
        node = {"@type": "Product", "name": "Oak Desk"}
        for _ in range(depth):
            node = {"@graph": [node]}
        return node

    head = '<meta property="og:title" content="Wing Chair">'
    assert parse(ld(graph(10)) + head)["title"] == "Oak Desk"
    assert parse(ld(graph(200)) + head)["title"] == "Wing Chair"


def test_bad_json_ld_is_skipped_and_og_is_used():
    head = (
        '<script type="application/ld+json">{not json</script>'
        '<meta property="og:title" content="Wing Chair">'
        '<meta property="og:image" content="//cdn.test/c.png">'
        '<meta property="product:price:amount" content="149.00">'
        '<meta property="product:price:currency" content="eur">'
    )
    draft = parse(head)
    assert draft["title"] == "Wing Chair" and draft["label"] == "armchair"
    assert draft["price"] == 149.0 and draft["currency"] == "EUR"
    assert draft["image_url"] == "https://cdn.test/c.png"


def test_og_fills_what_json_ld_lacks():
    head = ld({"@type": "Product", "name": "Coffee Table"}) + (
        '<meta property="og:image" content="https://cdn.test/t.jpg">'
        '<meta property="product:price:amount" content="89">'
    )
    draft = parse(head)
    assert draft["price"] == 89.0 and draft["currency"] is None
    assert draft["image_url"] == "https://cdn.test/t.jpg" and draft["label"] == "coffee table"


def test_page_title_is_the_last_resort():
    draft = parse(body="<p>Width: 80 cm Depth: 40 cm Height: 75 cm</p>")
    assert draft["title"] == "Shop page" and draft["size"] == pytest.approx([0.8, 0.4, 0.75])


def test_nothing_useful_is_an_error():
    with pytest.raises(ValueError):
        parse(body="<p>Hello there</p>")


def test_image_must_be_http():
    draft = parse(ld({"@type": "Product", "name": "Lamp", "image": "data:image/png;base64,AAA"}))
    assert draft["image_url"] is None


def sized(body, head=""):
    return parse(ld({"@type": "Product", "name": "Thing"}) + head, body)["size"]


def test_labeled_inches_with_fractions():
    size = sized('<ul><li>Width: 57 7/8"</li><li>Depth: 31 1/8"</li><li>Height: 30 3/8"</li></ul>')
    assert size == pytest.approx([1.470, 0.791, 0.772], abs=1e-3)


def test_labeled_on_separate_lines_and_in_unit():
    size = sized("<table><tr><td>Width</td><td>20 in</td></tr><tr><td>Depth</td><td>10 1/2 in</td></tr>"
                 "<tr><td>Height</td><td>30.5 inches</td></tr></table>")
    assert size == pytest.approx([0.508, 0.267, 0.775], abs=1e-3)


def test_labeled_cm():
    assert sized("<p>Width: 147 cm</p><p>Depth: 90 cm</p><p>Height: 85 cm</p>") == pytest.approx([1.47, 0.9, 0.85])


def test_length_counts_as_width():
    assert sized('<p>Length: 70"</p><p>Depth: 20"</p><p>Height: 30"</p>') == pytest.approx([1.778, 0.508, 0.762], abs=1e-3)


def test_width_beats_length():
    size = sized('<p>Length: 70"</p><p>Width: 60"</p><p>Depth: 20"</p><p>Height: 30"</p>')
    assert size[0] == pytest.approx(1.524, abs=1e-3)


def test_diameter_sets_width_and_depth():
    size = sized('<p>Diameter: 29 1/2"</p><p>Height: 16"</p>')
    assert size == pytest.approx([0.749, 0.749, 0.406], abs=1e-3)


def test_part_sizes_are_skipped():
    # The order and wording of a real IKEA loveseat page: part sizes come before the overall ones.
    text = (
        '<p>Armrest height 18 1/2 " Armrest width 4 3/4 " Depth 31 1/8 " Seat height 16 7/8 "'
        ' Seat width 46 1/2 " Width 57 7/8 " Height including back cushions 30 3/8 "'
        ' Seat depth 20 1/2 " Backrest height 26 " Height under furniture 5 1/2 "</p>'
    )
    assert sized(text) == pytest.approx([1.470, 0.791, 0.772], abs=1e-3)


def test_combined_inches():
    assert sized('<p>Size: 31 1/2x11x79 1/2"</p>') == pytest.approx([0.800, 0.279, 2.019], abs=1e-3)


def test_combined_cm_and_spaces():
    assert sized("<p>80x28x202 cm</p>") == pytest.approx([0.8, 0.28, 2.02])
    assert sized("<p>80 cm x 28 cm × 202 cm</p>") == pytest.approx([0.8, 0.28, 2.02])


def test_scripts_and_styles_are_not_text():
    head = "<style>.a:before{content:'Width: 10 cm Depth: 10 cm Height: 10 cm'}</style><script>var s='80x28x202 cm'</script>"
    assert sized("", head) is None


HOSTILE = {
    "digits": lambda: "1" * 1_000_000,
    "spaces after a number": lambda: "8" + " " * 1_000_000,
    "digits after a label": lambda: "width: " + "9" * 1_000_000,
    "digits and spaces between sizes": lambda: "5 x " + "7" * 500_000 + " x " + " " * 500_000,
    "slashes": lambda: "1/" * 500_000,
    "numbers and spaces": lambda: "1 " * 500_000,
}


@pytest.mark.parametrize("case", HOSTILE)
def test_size_patterns_stay_fast_on_hostile_text(case):
    text = HOSTILE[case]()
    started = time.perf_counter()
    assert read_size(text) is None
    assert time.perf_counter() - started < 1
    started = time.perf_counter()
    assert sized(f"<p>{text}</p>") is None
    assert time.perf_counter() - started < 1


def test_size_search_is_capped_and_text_is_collapsed():
    assert sized("<p>Width:\n\n  80\n cm</p><p>Depth: 40 cm</p><p>Height: 75 cm</p>") == pytest.approx([0.8, 0.4, 0.75])
    late = "<p>" + "a " * 150_000 + "80x28x202 cm</p>"  # past the first 200,000 characters
    assert sized(late) is None


@pytest.mark.parametrize("body", [
    '<p>Width: 57 7/8"</p>',
    '<p>Width: 57 7/8"</p><p>Depth: 31"</p>',
    "<p>Height: 80 cm</p>",
    "<p>no numbers at all</p>",
    "<p>Width: 57 pieces</p>",
])
def test_partial_size_is_null_with_a_note(body):
    draft = parse(ld({"@type": "Product", "name": "Thing"}), body)
    assert draft["size"] is None and draft["notes"] == [SIZE_NOTE]


def test_full_size_has_no_note():
    draft = parse(ld({"@type": "Product", "name": "T"}), "<p>80x28x202 cm</p>")
    assert draft["size"] and draft["notes"] == []


@pytest.mark.parametrize("title,label", [
    ("Linen Sofa", "sofa"), ("Two seat loveseat", "sofa"), ("Leather Couch", "sofa"),
    ("Wing chair in grey", "armchair"), ("Reclining recliner", "armchair"), ("Armchair", "armchair"),
    ("Mesh office chair", "chair"), ("Swivel stool", "chair"), ("Dining Chair", "chair"),
    ("Standing desk", "desk"), ("Round Coffee Table", "coffee table"),
    ("Marble side table", "side table"), ("Oak nightstand", "side table"), ("Tray Table", "side table"),
    ("Dining table", "table"), ("Tall bookcase", "bookcase"), ("Wall shelf", "bookcase"),
    ("Arc floor lamp", "lamp"), ("Queen bed frame", "bed"), ("6-drawer dresser", "dresser"),
    ("Mystery object", "furniture"), ("Embedded system", "furniture"),
])
def test_label_guess(title, label):
    assert guess_label(title) == label


def serve(net, html, status=200):
    net.handler = lambda request: httpx.Response(status, content=html.encode(), headers={"content-type": "text/html"})


def test_link_endpoint(client, net):
    serve(net, page(ld({"@type": "Product", "name": "Oak Desk", "offers": {"price": 250, "priceCurrency": "USD"}}),
                    "<p>Width: 120 cm Depth: 60 cm Height: 75 cm</p>"))
    r = client.post(LINK, json={"url": URL})
    assert r.status_code == 200
    assert r.json() == {
        "title": "Oak Desk", "price": 250, "currency": "USD", "url": URL, "image_url": None,
        "size": pytest.approx([1.2, 0.6, 0.75]), "label": "desk", "notes": [],
    }


def test_link_endpoint_saves_nothing(client, net, data_dir):
    serve(net, page(ld({"@type": "Product", "name": "Oak Desk"})))
    assert client.post(LINK, json={"url": URL}).status_code == 200
    assert not (data_dir / "custom").exists()


@pytest.mark.parametrize("url", ["http://127.0.0.1/x", "http://169.254.169.254/", "http://[::1]/", "ftp://shop.test/x", "nonsense"])
def test_link_endpoint_bad_addresses_are_400(client, net, url):
    r = client.post(LINK, json={"url": url})
    assert r.status_code == 400 and r.json()["detail"]
    assert net.calls == []


def test_link_endpoint_blocked_message(client, net):
    assert client.post(LINK, json={"url": "http://10.0.0.1/"}).json()["detail"] == "That address isn't allowed."


def test_link_endpoint_redirect_to_private_is_400(client, net):
    net.handler = lambda r: httpx.Response(302, headers={"location": "http://192.168.0.1/"})
    r = client.post(LINK, json={"url": URL})
    assert r.status_code == 400 and r.json()["detail"] == "That address isn't allowed."


def test_link_endpoint_fetch_failures_are_502(client, net):
    serve(net, "nope", status=500)
    r = client.post(LINK, json={"url": URL})
    assert r.status_code == 502 and r.json()["detail"] == "Couldn't read that page."


def test_link_endpoint_nothing_found_is_422(client, net):
    serve(net, page(body="<p>Just words</p>"))
    assert client.post(LINK, json={"url": URL}).status_code == 422


def test_link_endpoint_deeply_nested_json_ld_is_422(client, net):
    nested = "[" * 100_000 + "]" * 100_000
    serve(net, page(f'<script type="application/ld+json">{nested}</script>', "<p>Just words</p>"))
    assert client.post(LINK, json={"url": URL}).status_code == 422


def test_link_endpoint_recursion_error_is_422(client, net, monkeypatch):
    def too_deep(*args):
        raise RecursionError

    monkeypatch.setattr("otto_api.custom.parse_product", too_deep)
    serve(net, page(ld({"@type": "Product", "name": "Oak Desk"})))
    assert client.post(LINK, json={"url": URL}).status_code == 422


def test_link_endpoint_validation(client):
    assert client.post(LINK, json={"url": "http://example.com/" + "a" * 2000}).status_code == 422
    assert client.post(LINK, json={"url": ""}).status_code == 422
    assert client.post(LINK, json={}).status_code == 422

import json

import pytest

from otto_api import custom, fetch

PAGE = "/api/import/page"
URL = "https://shop.test/p/kivik"
EXT = "chrome-extension://" + "a" * 32


def html(data):
    return f'<html><head><script type="application/ld+json">{json.dumps(data)}</script></head><body></body></html>'


def test_page_import_reads_json_ld(client):
    page = html({
        "@type": "Product",
        "name": "KIVIK Sofa",
        "image": "/img/sofa.jpg",
        "offers": {"@type": "Offer", "price": 799, "priceCurrency": "USD"},
    })
    res = client.post(PAGE, json={"url": URL, "html": page})
    assert res.status_code == 200
    draft = res.json()
    assert draft["title"] == "KIVIK Sofa"
    assert draft["price"] == 799 and draft["currency"] == "USD"
    assert draft["image_url"] == "https://shop.test/img/sofa.jpg"
    assert draft["url"] == URL and draft["label"] == "sofa"


def test_page_import_never_fetches(client, net, monkeypatch):
    def boom(*args, **kwargs):
        raise AssertionError("fetch was called")

    monkeypatch.setattr(fetch, "fetch", boom)
    monkeypatch.setattr(custom, "fetch", boom)
    res = client.post(PAGE, json={"url": URL, "html": html({"@type": "Product", "name": "Oak Desk"})})
    assert res.status_code == 200
    assert net.calls == []


def test_page_import_nothing_found(client):
    res = client.post(PAGE, json={"url": URL, "html": "<html><body><p>Hello</p></body></html>"})
    assert res.status_code == 422
    assert "Couldn't find a product" in res.json()["detail"]


def test_page_import_size_limit(client):
    ok = client.post(PAGE, json={"url": URL, "html": html({"@type": "Product", "name": "Lamp"}) + " " * 100})
    assert ok.status_code == 200
    big = client.post(PAGE, json={"url": URL, "html": "x" * 3_000_001})
    assert big.status_code == 422


@pytest.mark.parametrize("url", ["ftp://shop.test/x", "javascript:alert(1)", "", "https://shop.test/" + "a" * 2000])
def test_page_import_bad_url(client, url):
    res = client.post(PAGE, json={"url": url, "html": "<html></html>"})
    assert res.status_code == 422


def preflight(client, origin):
    return client.options(
        PAGE,
        headers={
            "Origin": origin,
            "Access-Control-Request-Method": "POST",
            "Access-Control-Request-Headers": "content-type",
        },
    )


def test_cors_allows_extension_origin(client):
    res = preflight(client, EXT)
    assert res.status_code == 200
    assert res.headers["access-control-allow-origin"] == EXT
    assert "access-control-allow-credentials" not in res.headers


def test_cors_blocks_other_origins(client):
    for origin in ("https://evil.example", "chrome-extension://" + "a" * 31, "chrome-extension://" + "q" * 32):
        res = preflight(client, origin)
        assert res.status_code == 400
        assert "access-control-allow-origin" not in res.headers

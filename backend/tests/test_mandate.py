import json

import pytest

BODY = {"max_item_price": 500, "max_total": 1000, "shops": ["ikea.com"], "expires": "2099-12-31"}


def test_no_mandate_is_null(client):
    r = client.get("/api/mandate")
    assert r.status_code == 200
    assert r.json() is None


def test_put_then_get(client, data_dir):
    r = client.put("/api/mandate", json=BODY)
    assert r.status_code == 200
    m = r.json()
    assert {k: m[k] for k in BODY} == BODY
    assert len(m["token_last4"]) == 4 and m["token_last4"].isdigit()
    assert m["token_id"] and m["created_at"]
    assert client.get("/api/mandate").json() == m
    assert json.loads((data_dir / "mandate.json").read_text("utf-8")) == m


def test_put_issues_a_new_token(client):
    first = client.put("/api/mandate", json=BODY).json()
    second = client.put("/api/mandate", json=BODY).json()
    assert first["token_id"] != second["token_id"]


def test_nulls_and_empty_shops(client):
    body = {"max_item_price": None, "max_total": None, "shops": [], "expires": None}
    m = client.put("/api/mandate", json=body).json()
    assert {k: m[k] for k in body} == body


def test_delete_revokes(client, data_dir):
    client.put("/api/mandate", json=BODY)
    r = client.delete("/api/mandate")
    assert r.status_code == 200 and r.json() is None
    assert client.get("/api/mandate").json() is None
    assert not (data_dir / "mandate.json").exists()
    assert client.delete("/api/mandate").status_code == 200


@pytest.mark.parametrize("change", [
    {"max_item_price": -1},
    {"max_total": -0.01},
    {"max_item_price": "abc"},
    {"shops": ["x"] * 11},
    {"shops": ["x" * 101]},
    {"shops": [""]},
    {"shops": "ikea.com"},
    {"expires": "2026-13-40"},
    {"expires": "tomorrow"},
    {"expires": "20261231"},
    {"expires": 5},
])
def test_put_validation(client, change):
    r = client.put("/api/mandate", json={**BODY, **change})
    assert r.status_code == 422
    assert client.get("/api/mandate").json() is None


def test_put_rejects_nan_and_infinity(client):
    for raw in ("NaN", "Infinity"):
        text = '{"max_item_price": %s, "max_total": null, "shops": [], "expires": null}' % raw
        r = client.put("/api/mandate", content=text, headers={"content-type": "application/json"})
        assert r.status_code == 422


def test_put_accepts_limits(client):
    body = {**BODY, "shops": ["x" * 100] * 10}
    assert client.put("/api/mandate", json=body).status_code == 200

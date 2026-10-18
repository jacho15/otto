import json

from conftest import ROOM

MANDATE = {"max_item_price": None, "max_total": None, "shops": [], "expires": None}
PRICES = {"sofa": 449.0, "chair": 50.5}
ORDERS = f"/api/rooms/{ROOM}/orders"


def write_order(data_dir, oid="o1", names=("sofa",), status="proposed", created_at="2026-01-01T00:00:00+00:00"):
    items = [
        {"object_name": n, "title": n, "url": "", "price": PRICES[n], "currency": "USD", "reason": "needed"}
        for n in names
    ]
    order = {
        "id": oid, "room_id": ROOM, "status": status, "items": items,
        "total": round(sum(PRICES[n] for n in names), 2), "currency": "USD",
        "violations": [], "created_at": created_at, "created_by": "agent",
        "agent_message": "", "payment": None,
    }
    path = data_dir / "rooms" / ROOM / "orders"
    path.mkdir(exist_ok=True)
    (path / f"{oid}.json").write_text(json.dumps(order), "utf-8")
    return order


def approve(client, oid="o1"):
    return client.post(f"{ORDERS}/{oid}/approve")


def test_list_is_newest_first(client, data_dir):
    assert client.get(ORDERS).json() == []
    write_order(data_dir, "old", created_at="2026-01-01T00:00:00+00:00")
    write_order(data_dir, "new", created_at="2026-02-01T00:00:00+00:00")
    write_order(data_dir, "mid", created_at="2026-01-15T00:00:00+00:00")
    assert [o["id"] for o in client.get(ORDERS).json()] == ["new", "mid", "old"]


def test_unknown_room_or_order(client, data_dir):
    assert client.get("/api/rooms/nope/orders").status_code == 404
    assert client.post(f"{ORDERS}/missing/approve").status_code == 404
    assert client.post(f"{ORDERS}/missing/cancel").status_code == 404
    assert client.post(f"{ORDERS}/..%2Fscene/approve").status_code == 404


def test_approve(client, data_dir):
    client.put("/api/mandate", json=MANDATE)
    write_order(data_dir, names=("sofa", "chair"))
    r = approve(client)
    assert r.status_code == 200
    order = r.json()
    assert order["status"] == "approved"
    pay = order["payment"]
    assert pay["provider"] == "mock-visa"
    assert pay["demo"] is True
    assert pay["amount"] == 499.5 and pay["currency"] == "USD"
    assert pay["token_last4"] == client.get("/api/mandate").json()["token_last4"]
    assert pay["note"] == "Demo authorization. No real payment was made."
    assert client.get(ORDERS).json()[0]["status"] == "approved"


def test_double_approve_is_409(client, data_dir):
    client.put("/api/mandate", json=MANDATE)
    write_order(data_dir)
    assert approve(client).status_code == 200
    r = approve(client)
    assert r.status_code == 409
    assert r.json()["detail"]["violations"]


def test_same_item_in_two_orders_is_bought_once(client, data_dir):
    client.put("/api/mandate", json=MANDATE)
    write_order(data_dir, "a")
    write_order(data_dir, "b")
    assert approve(client, "a").status_code == 200
    assert approve(client, "b").status_code == 409


def test_approve_without_mandate(client, data_dir):
    write_order(data_dir)
    r = approve(client)
    assert r.status_code == 409
    assert r.json()["detail"]["violations"]


def test_approve_refused_after_mandate_changes(client, data_dir):
    client.put("/api/mandate", json=MANDATE)
    write_order(data_dir)
    client.put("/api/mandate", json={**MANDATE, "max_item_price": 100})
    r = approve(client)
    assert r.status_code == 409
    assert "per-item" in r.json()["detail"]["violations"][0]
    client.put("/api/mandate", json={**MANDATE, "shops": ["ikea.com"]})
    assert approve(client).status_code == 409
    client.put("/api/mandate", json={**MANDATE, "expires": "2000-01-01"})
    assert "expired" in approve(client).json()["detail"]["violations"][0]
    client.delete("/api/mandate")
    assert approve(client).status_code == 409


def test_approve_refused_after_price_change(client, data_dir):
    client.put("/api/mandate", json=MANDATE)
    write_order(data_dir)
    path = data_dir / "rooms" / ROOM / "scene.json"
    scene = json.loads(path.read_text("utf-8"))
    scene["objects"][0]["product"]["price"] = 400.0
    path.write_text(json.dumps(scene), "utf-8")
    r = approve(client)
    assert r.status_code == 409
    assert "price" in r.json()["detail"]["violations"][0]


def test_approve_refused_after_item_hidden_or_removed(client, data_dir):
    client.put("/api/mandate", json=MANDATE)
    write_order(data_dir)
    path = data_dir / "rooms" / ROOM / "scene.json"
    scene = json.loads(path.read_text("utf-8"))
    scene["objects"][0]["hidden"] = True
    path.write_text(json.dumps(scene), "utf-8")
    assert approve(client).status_code == 409
    scene["objects"].pop(0)
    path.write_text(json.dumps(scene), "utf-8")
    assert approve(client).status_code == 409
    assert client.get(ORDERS).json()[0]["status"] == "proposed"


def test_cancel(client, data_dir):
    write_order(data_dir)
    r = client.post(f"{ORDERS}/o1/cancel")
    assert r.status_code == 200 and r.json()["status"] == "cancelled"
    assert client.post(f"{ORDERS}/o1/cancel").status_code == 409
    assert approve(client).status_code == 409


def test_cannot_cancel_approved(client, data_dir):
    client.put("/api/mandate", json=MANDATE)
    write_order(data_dir)
    approve(client)
    assert client.post(f"{ORDERS}/o1/cancel").status_code == 409
    assert client.get(ORDERS).json()[0]["status"] == "approved"


def test_order_totals_per_currency(client, data_dir):
    order = write_order(data_dir, names=("sofa", "chair"))
    path = data_dir / "rooms" / ROOM / "orders" / "o1.json"
    order["items"][1]["currency"] = "EUR"
    path.write_text(json.dumps(order), "utf-8")
    (listed,) = client.get(ORDERS).json()
    assert listed["totals"] == [{"currency": "EUR", "amount": 50.5}, {"currency": "USD", "amount": 449.0}]


def test_order_totals_single_currency(client, data_dir):
    write_order(data_dir, names=("sofa", "chair"))
    (listed,) = client.get(ORDERS).json()
    assert listed["totals"] == [{"currency": "USD", "amount": 499.5}]
    assert listed["total"] == 499.5 and listed["currency"] == "USD"


def test_approve_blocks_other_currency_items(client, data_dir):
    client.put("/api/mandate", json={**MANDATE, "max_total": 1000})
    order = write_order(data_dir, names=("sofa",))
    order["items"][0]["currency"] = "EUR"
    (data_dir / "rooms" / ROOM / "orders" / "o1.json").write_text(json.dumps(order), "utf-8")
    r = approve(client)
    assert r.status_code == 409
    assert any("Price is in EUR; your limits are in USD." in v for v in r.json()["detail"]["violations"])

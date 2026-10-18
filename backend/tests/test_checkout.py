from datetime import date

import pytest

from otto_api.checkout import (
    MockVisaProvider,
    approval_violations,
    eligible_items,
    mandate_violations,
    shop_host,
)

TODAY = date(2026, 6, 15)


def item(price=100.0, url="https://www.ikea.com/chair", title="Chair"):
    return {"title": title, "url": url, "price": price, "currency": "USD"}


def mandate(**kw):
    return {"max_item_price": None, "max_total": None, "shops": [], "expires": None, **kw}


def test_no_mandate():
    assert len(mandate_violations([item()], None, TODAY)) == 1


def test_empty_mandate_allows_anything():
    assert mandate_violations([item(1e6, url="")], mandate(), TODAY) == []


def test_item_cap():
    m = mandate(max_item_price=100)
    assert mandate_violations([item(100.0)], m, TODAY) == []
    problems = mandate_violations([item(100.01)], m, TODAY)
    assert len(problems) == 1 and "per-item" in problems[0]


def test_total_cap():
    m = mandate(max_total=150)
    assert mandate_violations([item(100.0), item(50.0)], m, TODAY) == []
    problems = mandate_violations([item(100.0), item(50.01)], m, TODAY)
    assert len(problems) == 1 and "total" in problems[0]


def test_expiry_is_valid_through_the_date():
    m = mandate(expires="2026-06-15")
    assert mandate_violations([item()], m, date(2026, 6, 15)) == []
    assert mandate_violations([item()], m, date(2026, 6, 14)) == []
    problems = mandate_violations([item()], m, date(2026, 6, 16))
    assert len(problems) == 1 and "expired" in problems[0]


@pytest.mark.parametrize("url", [
    "https://ikea.com/chair",
    "https://www.ikea.com/chair",
    "http://shop.ikea.com/chair",
    "https://WWW.IKEA.COM./chair",
])
def test_allowed_hosts(url):
    assert mandate_violations([item(url=url)], mandate(shops=["ikea.com"]), TODAY) == []


@pytest.mark.parametrize("url", [
    "https://ikea.com.evil.com/chair",
    "https://notikea.com/chair",
    "https://evil.com/ikea.com",
    r"https://evil.com\@ikea.com/x",
    "https://ikea.com@evil.com/x",
    "https://evil.com@ikea.com/x",
    "https://user:pw@ikea.com/x",
    "https://ikea.com:8443/x",
    "ftp://ikea.com/x",
    "javascript:alert(1)//ikea.com",
    "//ikea.com/x",
    "ikea.com/x",
    "",
    None,
])
def test_refused_hosts(url):
    problems = mandate_violations([item(url=url)], mandate(shops=["ikea.com", "www.example.org"]), TODAY)
    assert len(problems) == 1 and "allowed shop" in problems[0]


def test_shop_entry_with_www_matches():
    assert mandate_violations([item(url="https://ikea.com/x")], mandate(shops=["www.ikea.com"]), TODAY) == []


def test_shop_host_backslash():
    assert shop_host(r"https://evil.com\@ikea.com/x") == "evil.com"


def test_eligible_items():
    objects = [
        {"name": "a", "product": {"price": 1.0}},
        {"name": "hidden", "hidden": True, "product": {"price": 1.0}},
        {"name": "free", "product": {"price": None}},
        {"name": "no_product"},
        {"name": "bought", "product": {"price": 1.0}},
        {"name": "pending", "product": {"price": 1.0}},
    ]
    orders = [
        {"status": "approved", "items": [{"object_name": "bought"}]},
        {"status": "proposed", "items": [{"object_name": "pending"}]},
        {"status": "cancelled", "items": [{"object_name": "a"}]},
    ]
    assert [o["name"] for o in eligible_items(objects, orders)] == ["a", "pending"]


def test_approval_violations_re_checks_items():
    objects = [{"name": "a", "product": {"title": "A", "url": "https://x.com/a", "price": 10.0}}]
    order = {"status": "proposed", "items": [{**item(10.0, "https://x.com/a", "A"), "object_name": "a"}]}
    assert approval_violations(order, objects, [order], mandate(), TODAY) == []
    assert approval_violations({**order, "status": "approved"}, objects, [], mandate(), TODAY)
    assert approval_violations(order, objects, [order], None, TODAY)
    assert approval_violations(order, [], [order], mandate(), TODAY)
    objects[0]["product"]["price"] = 11.0
    assert approval_violations(order, objects, [order], mandate(), TODAY)


def test_mock_provider_is_a_demo():
    order = {"total": 12.5, "currency": "USD"}
    payment = MockVisaProvider().authorize(order, {"token_last4": "0042"})
    assert payment["provider"] == "mock-visa"
    assert payment["demo"] is True
    assert payment["amount"] == 12.5 and payment["token_last4"] == "0042"
    assert "No real payment" in payment["note"]
    assert payment["auth_id"]

"""Spend mandate rules and the mock payment provider. No file access.

Nothing here contacts a bank or card network. The provider is a demo stand-in.
"""
import re
import secrets
from datetime import date
from typing import Protocol
from urllib.parse import urlsplit

HOST = re.compile(r"^[a-z0-9.-]+$")


def shop_host(url):
    """Host of a plain http(s) link without www., or None for anything else.

    Backslashes count as slashes, so https://evil.com\\@ikea.com/x is evil.com.
    Links with a login, a port or another scheme give None.
    """
    try:
        parts = urlsplit(str(url or "").strip().replace("\\", "/"))
        netloc = parts.netloc
        host = (parts.hostname or "").rstrip(".")
    except ValueError:
        return None
    if parts.scheme not in ("http", "https") or "@" in netloc or ":" in netloc:
        return None
    host = host.removeprefix("www.")
    return host if HOST.match(host) else None


def allowed_shop(url, shops):
    """True if the URL host is one of the shops or a subdomain of one."""
    host = shop_host(url)
    if host is None:
        return False
    for shop in shops:
        shop = (shop_host(shop) if "://" in shop else shop.strip().lower().removeprefix("www.")) or ""
        if shop and (host == shop or host.endswith("." + shop)):
            return True
    return False


def money(amount, currency):
    return f"{amount:.2f} {currency}"


def currency_totals(items):
    """Sums per currency, sorted by currency: [{"currency", "amount"}]. items: dicts with price, currency."""
    sums = {}
    for item in items:
        currency = item.get("currency") or "USD"
        sums[currency] = sums.get(currency, 0) + item["price"]
    return [{"currency": c, "amount": round(sums[c], 2)} for c in sorted(sums)]


def single_total(totals):
    """One total for the old `total` field. Several currencies give an amount of None and MIXED."""
    if len(totals) > 1:
        return {"amount": None, "currency": "MIXED"}
    return dict(totals[0]) if totals else {"amount": 0.0, "currency": "USD"}


def mandate_violations(items, mandate, today):
    """Reasons the items break the mandate. An empty list means they fit.

    items: dicts with title, url, price, currency. today: a local date.
    The caps are in the mandate's currency (USD if it names none).
    """
    if not mandate:
        return ["No spend mandate is set."]
    problems = []
    if mandate.get("expires") and today > date.fromisoformat(mandate["expires"]):
        problems.append(f"The mandate expired on {mandate['expires']}.")
    currency = mandate.get("currency") or "USD"
    counted = []
    for item in items:
        if (item.get("currency") or "USD") == currency:
            counted.append(item)
        else:
            problems.append(
                f"{item['title']}: Price is in {item.get('currency') or 'USD'}; your limits are in {currency}."
            )
    cap = mandate.get("max_item_price")
    if cap is not None:
        for item in counted:
            if item["price"] > cap:
                problems.append(
                    f"{item['title']} costs {money(item['price'], currency)}, "
                    f"over the per-item limit of {cap:.2f}."
                )
    cap = mandate.get("max_total")
    total = round(sum(item["price"] for item in counted), 2)
    if cap is not None and total > cap:
        problems.append(f"The total {money(total, currency)} is over the limit of {cap:.2f}.")
    shops = mandate.get("shops") or []
    if shops:
        for item in items:
            if not allowed_shop(item.get("url"), shops):
                problems.append(f"{item['title']} is not from an allowed shop.")
    return problems


def eligible_items(objects, orders):
    """Visible objects with a price that are not in an approved order."""
    bought = {
        item["object_name"]
        for order in orders
        if order["status"] == "approved"
        for item in order["items"]
    }
    return [
        o for o in objects
        if not o.get("hidden")
        and (o.get("product") or {}).get("price") is not None
        and o["name"] not in bought
    ]


def approval_violations(order, objects, orders, mandate, today):
    """Everything that must hold before an order is approved, checked again now."""
    if order["status"] != "proposed":
        return [f"The order is {order['status']}, not proposed."]
    available = {o["name"]: o["product"] for o in eligible_items(objects, orders)}
    problems = []
    for item in order["items"]:
        product = available.get(item["object_name"])
        if product is None:
            problems.append(f"{item['title']} is gone, hidden or already bought.")
        elif product["price"] != item["price"]:
            problems.append(f"The price of {item['title']} changed since the order was proposed.")
        elif (product.get("currency") or "USD") != (item.get("currency") or "USD"):
            problems.append(f"The currency of {item['title']} changed since the order was proposed.")
        elif (product.get("url") or "") != item["url"]:
            problems.append(f"The link for {item['title']} changed since the order was proposed.")
    return problems + mandate_violations(order["items"], mandate, today)


class PaymentProvider(Protocol):
    def authorize(self, order: dict, mandate: dict) -> dict:
        """Authorize the order under the mandate token. Return the payment record."""


class MockVisaProvider:
    """Demo provider. Makes up an authorization id and moves no money."""

    def authorize(self, order, mandate):
        return {
            "provider": "mock-visa",
            "auth_id": "mock_auth_" + secrets.token_hex(6),
            "token_last4": mandate["token_last4"],
            "amount": order["total"],
            "currency": order["currency"],
            "demo": True,
            "note": "Demo authorization. No real payment was made.",
        }

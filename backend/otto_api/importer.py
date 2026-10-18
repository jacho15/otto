"""Read a product page: title, price, image and size. Pure functions, no network."""
import json
import re
from html import unescape
from html.parser import HTMLParser
from urllib.parse import urljoin

MAX_TITLE = 120
INCH = 0.0254
SIZE_NOTE = "Couldn't read the full size; please enter it."
MAX_TEXT = 200_000  # characters of page text that are searched for a size
MAX_DEPTH = 50  # deepest JSON-LD nesting that is walked

# Guess a label from the title. The first line with a match wins.
LABELS = (
    ("sofa", ("sofa", "loveseat", "couch")),
    ("armchair", ("armchair", "wing chair", "recliner")),
    ("chair", ("office chair", "swivel", "chair")),
    ("desk", ("desk",)),
    ("coffee table", ("coffee table",)),
    ("side table", ("side table", "nightstand", "tray table")),
    ("table", ("table",)),
    ("bookcase", ("bookcase", "shelf", "shelves")),
    ("lamp", ("lamp",)),
    ("bed", ("bed",)),
    ("dresser", ("dresser",)),
)

# Every part is bounded, so a page of digits or spaces cannot make a pattern slow.
NUM = r"(?<!\d)(?:\d{1,4}(?:\.\d{1,3})?(?:[ \t]{1,3}\d{1,2}/\d{1,2})?|\d{1,2}/\d{1,2})"
UNIT = r"""(?:"|”|″|''|in(?:ch(?:es)?)?\b\.?|cm\b)"""
# "Height including back cushions 30 3/8"" still counts as the overall height.
INCLUDING = r"(?:[ \t]{1,3}(?:including|incl\.?|with)(?:[ \t]{1,3}[a-z]{1,15}){1,3})?"
LABELED = {
    key: re.compile(rf"\b{key}\b{INCLUDING}[ \t:]{{0,4}}({NUM})[ \t]{{0,3}}({UNIT})", re.I)
    for key in ("width", "depth", "height", "length", "diameter")
}
# A part's size ("Seat height", "Armrest width"), not the whole piece's.
PART = re.compile(
    r"\b(?:seat|armrest|arm|backrest|back|leg|shelf|drawer|inner|interior|opening|cushion|frame|mattress|package|box)[ \t]{1,3}$",
    re.I,
)
SEP = r"[ \t]{0,3}"
COMBINED = re.compile(
    rf"({NUM}){SEP}(?:{UNIT})?{SEP}[x×]{SEP}({NUM}){SEP}(?:{UNIT})?{SEP}[x×]{SEP}({NUM}){SEP}({UNIT})", re.I
)


class Page(HTMLParser):
    """Collects JSON-LD blocks, meta tags, the title and the visible text."""

    def __init__(self):
        super().__init__()
        self.json_ld = []
        self.meta = {}
        self.title = ""
        self.text = []
        self._in = None  # "ld", "title", or a tag whose text is skipped

    def handle_starttag(self, tag, attrs):
        attrs = dict(attrs)
        if tag == "meta":
            key = attrs.get("property") or attrs.get("name")
            if key and attrs.get("content") is not None:
                self.meta.setdefault(key.lower(), attrs["content"])
        elif tag == "script" and "ld+json" in (attrs.get("type") or "").lower():
            self._in = "ld"
            self.json_ld.append("")
        elif tag in ("script", "style", "title"):
            self._in = tag
        self.text.append("\n")

    def handle_endtag(self, tag):
        self._in = None
        self.text.append("\n")

    def handle_data(self, data):
        if self._in == "ld":
            self.json_ld[-1] += data
        elif self._in == "title":
            self.title += data
        elif self._in is None:
            self.text.append(data)


def clean(text) -> str:
    return re.sub(r"\s+", " ", text).strip() if isinstance(text, str) else ""


def products_in(node, depth=0):
    """Every schema.org Product in a parsed JSON-LD value, also inside @graph and lists."""
    if depth > MAX_DEPTH:
        return
    if isinstance(node, list):
        for n in node:
            yield from products_in(n, depth + 1)
    elif isinstance(node, dict):
        kinds = node.get("@type")
        kinds = kinds if isinstance(kinds, list) else [kinds]
        if "Product" in kinds or "ProductGroup" in kinds:
            yield node
        yield from products_in(node.get("@graph"), depth + 1)


def to_price(value):
    """A price number from 12, "12.50" or "$1,299.00". None if it is not one."""
    if isinstance(value, bool):
        return None
    if isinstance(value, str):
        match = re.search(r"\d[\d,]*(?:\.\d+)?", value)
        value = match.group().replace(",", "") if match else None
    try:
        price = float(value)
    except (TypeError, ValueError):
        return None
    return price if 0 <= price < 1e9 else None


def offer_price(offers, depth=0):
    """(price, currency) from an offer, an AggregateOffer or a list of offers."""
    if depth > MAX_DEPTH:
        return None, None
    if isinstance(offers, list):
        for offer in offers:
            price, currency = offer_price(offer, depth + 1)
            if price is not None:
                return price, currency
        return None, None
    if not isinstance(offers, dict):
        return None, None
    price = to_price(offers.get("price"))
    if price is None:
        price = to_price(offers.get("lowPrice"))
    currency = clean(offers.get("priceCurrency")).upper()
    return price, currency if re.fullmatch(r"[A-Z]{3}", currency) else None


def image_of(value, depth=0):
    if depth > MAX_DEPTH:
        return None
    if isinstance(value, list):
        return next((u for u in (image_of(v, depth + 1) for v in value) if u), None)
    if isinstance(value, dict):
        return image_of(value.get("url") or value.get("contentUrl"), depth + 1)
    return clean(value) or None


def from_json_ld(page: Page) -> dict:
    for block in page.json_ld:
        try:
            data = json.loads(block)
            for product in products_in(data):
                offers = product.get("offers")
                if not offers and isinstance(product.get("hasVariant"), list):
                    offers = [v.get("offers") for v in product["hasVariant"] if isinstance(v, dict)]
                price, currency = offer_price(offers)
                found = {
                    "title": clean(unescape(product["name"])) if isinstance(product.get("name"), str) else "",
                    "price": price,
                    "currency": currency,
                    "image_url": image_of(product.get("image")),
                }
                if any(found.values()):
                    return found
        except (ValueError, RecursionError):  # not JSON, or nested too deeply
            continue
    return {}


def to_metres(value: str, unit: str) -> float:
    parts = value.split()
    number = 0.0
    for part in parts:
        if "/" in part:
            top, bottom = part.split("/")
            number += int(top) / int(bottom) if int(bottom) else 0.0
        else:
            number += float(part)
    return round(number * (0.01 if unit.lower() == "cm" else INCH), 3)


def read_size(text: str):
    """(w, d, h) in metres from page text, or None. Labeled values come first, then W x D x H."""
    text = clean(text)[:MAX_TEXT]
    found = {}
    for key, pattern in LABELED.items():
        for match in pattern.finditer(text):
            if not PART.search(text[max(0, match.start() - 20):match.start()]):
                found[key] = to_metres(*match.groups())
                break
    width = found.get("width", found.get("length", found.get("diameter")))
    depth = found.get("depth", found.get("diameter"))
    height = found.get("height")
    if None not in (width, depth, height):
        return [width, depth, height]
    match = COMBINED.search(text)
    if match:
        *values, unit = match.groups()
        return [to_metres(v, unit) for v in values]
    return None


def guess_label(title: str) -> str:
    title = title.lower()
    for label, words in LABELS:
        if any(re.search(rf"\b{re.escape(w)}s?\b", title) for w in words):
            return label
    return "furniture"


def parse_product(html: str, url: str) -> dict:
    """A draft item from a product page. Raise ValueError if nothing useful is in it."""
    page = Page()
    page.feed(html)
    page.close()
    found = from_json_ld(page)
    meta = page.meta
    title = found.get("title") or clean(meta.get("og:title"))
    price = found.get("price")
    if price is None:
        price = to_price(meta.get("product:price:amount") or meta.get("og:price:amount"))
    currency = found.get("currency")
    if not currency:
        currency = clean(meta.get("product:price:currency") or meta.get("og:price:currency")).upper()
        currency = currency if re.fullmatch(r"[A-Z]{3}", currency) else None
    image = found.get("image_url") or clean(meta.get("og:image")) or None
    if image:
        image = urljoin(url, image)
        if not image.lower().startswith(("http://", "https://")):
            image = None
    size = read_size("".join(page.text))
    if not (title or price is not None or image or size):
        raise ValueError("nothing useful")
    title = (title or clean(page.title))[:MAX_TITLE].strip()
    return {
        "title": title,
        "price": price,
        "currency": currency,
        "url": url,
        "image_url": image,
        "size": size,
        "label": guess_label(title),
        "notes": [] if size else [SIZE_NOTE],
    }

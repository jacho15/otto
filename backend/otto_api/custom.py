"""Add any furniture: import a product link, upload a photo or .glb, and keep custom items."""
import re
import secrets
from datetime import datetime, timezone
from typing import Annotated, Literal
from urllib.parse import urlsplit

from fastapi import APIRouter, HTTPException, UploadFile
from fastapi.responses import FileResponse
from pydantic import BaseModel, Field, StringConstraints, field_validator

from .fetch import MAX_IMAGE, MAX_PAGE, FetchError, BadUrl, IMAGE_ACCEPT, fetch
from .importer import parse_product

router = APIRouter()

MAX_MODEL = 25 * 1024 * 1024
FILE_NAME = re.compile(r"^[0-9a-f]{12}\.(jpg|png|webp|glb)$")
FILE_URL = re.compile(r"^/api/custom/files/([0-9a-f]{12}\.(jpg|png|webp|glb))$")
ITEM_ID = re.compile(r"^custom-[0-9a-f]{8}$")
IMAGE_EXTS = ("jpg", "png", "webp")
MEDIA_TYPES = {"jpg": "image/jpeg", "png": "image/png", "webp": "image/webp", "glb": "model/gltf-binary"}
FILE_HEADERS = {"X-Content-Type-Options": "nosniff", "Content-Security-Policy": "default-src 'none'"}

Number = Annotated[float, Field(allow_inf_nan=False)]
Money = Annotated[float, Field(allow_inf_nan=False, ge=0)]


def web_url(value: str | None) -> str | None:
    """Check an http(s) address. A blank one means none."""
    if value is None or not value.strip():
        return None
    value = value.strip()
    parts = urlsplit(value)
    if len(value) > 2000 or parts.scheme not in ("http", "https") or not parts.netloc:
        raise ValueError("Use an http or https address.")
    return value


class LinkBody(BaseModel):
    url: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=2000)]


class CustomItemBody(BaseModel):
    title: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=120)]
    url: str | None = None
    price: Money | None = None
    currency: Annotated[str, StringConstraints(pattern=r"^[A-Za-z]{3}$")] = "USD"
    size: Annotated[list[Number], Field(min_length=3, max_length=3)]
    label: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=40)]
    photo: str | None = None
    model: str | None = None
    image_url: str | None = None
    price_source: Literal["page", "listing"] = "page"  # "listing": the price is from a shop search result, not the product page

    @field_validator("url", "image_url")
    @classmethod
    def http_only(cls, value):
        return web_url(value)

    @field_validator("size")
    @classmethod
    def size_limits(cls, size):
        w, d, h = size
        if not (0.05 <= w <= 6 and 0.05 <= d <= 6 and 0.05 <= h <= 3.5):
            raise ValueError("Width and depth must be 0.05 to 6 m, height 0.05 to 3.5 m.")
        return size

    @field_validator("photo", "model")
    @classmethod
    def file_url(cls, value, info):
        if value is None:
            return None
        match = FILE_URL.match(value)
        wanted = IMAGE_EXTS if info.field_name == "photo" else ("glb",)
        if not match or match.group(2) not in wanted:
            raise ValueError("Use the url that the upload returned.")
        return value


def file_kind(data: bytes) -> tuple[str, str, int] | None:
    """(extension, kind, size limit) from the first bytes of a file, or None."""
    if data.startswith(b"\xff\xd8\xff"):
        return "jpg", "image", MAX_IMAGE
    if data.startswith(b"\x89PNG\r\n\x1a\n"):
        return "png", "image", MAX_IMAGE
    if data[:4] == b"RIFF" and data[8:12] == b"WEBP":
        return "webp", "image", MAX_IMAGE
    if data.startswith(b"glTF"):
        return "glb", "model", MAX_MODEL
    return None


def store_file(data: bytes, ext: str) -> str:
    """Save bytes under custom/files and return their /api url."""
    from . import main
    name = f"{secrets.token_hex(6)}.{ext}"
    folder = main.custom_dir() / "files"
    folder.mkdir(parents=True, exist_ok=True)
    (folder / name).write_bytes(data)
    return f"/api/custom/files/{name}"


def file_exists(url: str) -> bool:
    from . import main
    return (main.custom_dir() / "files" / FILE_URL.match(url).group(1)).is_file()


@router.post("/api/import/link")
def import_link(body: LinkBody):
    """A draft item from a product page. Nothing is saved."""
    try:
        page, _, _ = fetch(body.url, MAX_PAGE)
    except BadUrl as e:
        raise HTTPException(400, str(e))
    except FetchError:
        raise HTTPException(502, "Couldn't read that page.")
    try:
        return parse_product(page.decode("utf-8", errors="replace"), body.url)
    except (ValueError, RecursionError):
        raise HTTPException(422, "Couldn't find a product on that page. Enter it by hand.")


@router.post("/api/uploads")
def upload(file: UploadFile):
    data = file.file.read(MAX_MODEL + 1)
    kind = file_kind(data)
    if kind is None:
        raise HTTPException(415, "Upload a JPEG, PNG or WebP photo, or a .glb model.")
    ext, name, limit = kind
    if len(data) > limit:
        raise HTTPException(413, f"That file is too big. The limit is {limit // (1024 * 1024)} MB.")
    return {"url": store_file(data, ext), "kind": name}


@router.get("/api/custom/files/{name}")
def get_custom_file(name: str):
    from . import main
    if not FILE_NAME.fullmatch(name):
        raise HTTPException(404, "File not found")
    path = main.custom_dir() / "files" / name
    if not path.is_file():
        raise HTTPException(404, "File not found")
    return FileResponse(path, media_type=MEDIA_TYPES[name.rsplit(".", 1)[1]], headers=FILE_HEADERS)


@router.get("/api/custom-items")
def list_custom_items():
    from . import main
    with main.lock:
        return list(reversed(main.load_list(main.custom_dir() / "items.json")))


@router.post("/api/custom-items")
def add_custom_item(body: CustomItemBody):
    from . import main
    for url, what in ((body.photo, "photo"), (body.model, "model")):
        if url and not file_exists(url):
            raise HTTPException(422, f"That {what} file was not found. Upload it again.")
    photo, notes = body.photo, []
    if body.image_url and not photo:
        try:
            data, _, _ = fetch(body.image_url, MAX_IMAGE, IMAGE_ACCEPT)
            kind = file_kind(data)
            if kind is None or kind[1] != "image" or len(data) > MAX_IMAGE:
                raise FetchError("Not a supported image.")
            photo = store_file(data, kind[0])
        except FetchError:
            notes.append("Couldn't download the product image.")
    item = {
        "id": f"custom-{secrets.token_hex(4)}",
        "title": body.title,
        "url": body.url,
        "price": body.price,
        "currency": body.currency.upper(),
        "size": body.size,
        "label": body.label,
        "rgba": [0.7, 0.7, 0.7, 1],
        "model": body.model,
        "photo": photo,
        "price_source": body.price_source,
        "custom": True,
        "created_at": datetime.now(timezone.utc).isoformat(),
    }
    path = main.custom_dir() / "items.json"
    with main.lock:
        main.write_json(path, main.load_list(path) + [item])
    return {**item, "notes": notes} if notes else item


@router.delete("/api/custom-items/{item_id}")
def delete_custom_item(item_id: str):
    from . import main
    path = main.custom_dir() / "items.json"
    with main.lock:
        items = main.load_list(path)
        if not ITEM_ID.match(item_id) or not any(i["id"] == item_id for i in items):
            raise HTTPException(404, "Custom item not found")
        items = [i for i in items if i["id"] != item_id]
        main.write_json(path, items)
        return list(reversed(items))

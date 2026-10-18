import json
import os
import re
import secrets
import tempfile
import threading
import time
from datetime import date, datetime, timezone
from pathlib import Path
from typing import Annotated

from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse
from filelock import FileLock
from pydantic import BaseModel, Field, StringConstraints, field_validator

from .agent import AgentError, make_client, run_checkout
from .checkout import MockVisaProvider, approval_violations, currency_totals, single_total
from .fit import find_warnings
from .alternatives import router as alternatives_router
from .chat import router as chat_router
from .custom import router as custom_router
from .data import router as data_router
from .photo_match import router as photo_match_router
from .render import router as render_router
from .extension_api import router as extension_router
from .place import add_at, add_item
from .places import router as places_router
from .suggest import router as suggest_router

REPO_ROOT = Path(__file__).resolve().parent.parent.parent
load_dotenv(REPO_ROOT / ".env")

app = FastAPI(title="Otto API")
app.include_router(places_router)
app.include_router(suggest_router)
app.include_router(alternatives_router)
app.include_router(custom_router)
app.include_router(extension_router)
app.include_router(chat_router)
app.include_router(data_router)
app.include_router(photo_match_router)
app.include_router(render_router)
app.add_middleware(
    CORSMiddleware,
    allow_origin_regex=r"^chrome-extension://[a-p]{32}$",
    allow_methods=["GET", "POST"],
    allow_headers=["Content-Type"],
    allow_credentials=False,
)


@app.exception_handler(RequestValidationError)
def validation_error(request, exc):
    # Leave out the raw input: it may hold NaN/Infinity, which JSON cannot encode.
    errors = [{"loc": e["loc"], "msg": e["msg"], "type": e["type"]} for e in exc.errors()]
    return JSONResponse({"detail": errors}, status_code=422)

ROOM_ID = re.compile(r"^[a-z0-9][a-z0-9-]*$")
DEFAULT_DATA = REPO_ROOT / "data"


class DataLock:
    """One lock for every read-modify-write of the data files. The thread lock covers this
    process; a lock file in the data dir covers other server processes."""

    def __init__(self):
        self._thread = threading.Lock()
        self._file = None

    def __enter__(self):
        self._thread.acquire()
        try:
            folder = data_dir()
            folder.mkdir(parents=True, exist_ok=True)
            self._file = FileLock(folder / ".otto.lock")
            self._file.acquire()
        except BaseException:
            self._file = None
            self._thread.release()
            raise
        return self

    def __exit__(self, *exc):
        file, self._file = self._file, None
        try:
            file.release()
        finally:
            self._thread.release()


lock = DataLock()
HISTORY_LIMIT = 30
LAYOUT_LIMIT = 10
PATCH_MERGE_SECONDS = 2
last_patch: dict[Path, tuple[str, float]] = {}  # per room: object name and time of the newest patch in history
LAYOUT_ID = re.compile(r"^[0-9a-f]{8}$")
DEFAULT_DOOR = {"width": 0.81, "height": 2.03}  # a standard 32 x 80 inch door

Number = Annotated[float, Field(allow_inf_nan=False)]
Money = Annotated[float, Field(allow_inf_nan=False, ge=0)]
Shop = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=100)]


class ObjectPatch(BaseModel):
    pos: Annotated[list[Number], Field(min_length=2, max_length=2)] | None = None
    yaw: Number | None = None


class RoomSize(BaseModel):
    """Measured size of a room. Same limits as a new blueprint place."""
    width: Annotated[float, Field(allow_inf_nan=False, ge=1.5, le=15)]
    depth: Annotated[float, Field(allow_inf_nan=False, ge=1.5, le=15)]
    height: Annotated[float, Field(allow_inf_nan=False, ge=2, le=4)]


class DoorSize(BaseModel):
    width: Annotated[float, Field(allow_inf_nan=False, ge=0.5, le=2.0)]
    height: Annotated[float, Field(allow_inf_nan=False, ge=1.5, le=3.0)]


class LayoutName(BaseModel):
    name: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=40)]


class ObjectAdd(BaseModel):
    catalog_id: str
    replace: str | None = None
    pos: Annotated[list[Number], Field(min_length=2, max_length=2)] | None = None
    yaw: Number | None = None


class MandateBody(BaseModel):
    max_item_price: Money | None
    max_total: Money | None
    currency: Annotated[str, StringConstraints(pattern=r"^[A-Za-z]{3}$")] = "USD"
    shops: Annotated[list[Shop], Field(max_length=10)]
    expires: Annotated[str, Field(pattern=r"^\d{4}-\d{2}-\d{2}$")] | None

    @field_validator("currency")
    @classmethod
    def upper_currency(cls, value):
        return value.upper()

    @field_validator("expires")
    @classmethod
    def real_date(cls, value):
        if value is not None:
            date.fromisoformat(value)
        return value


class CheckoutBody(BaseModel):
    instruction: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=1000)]


def data_dir() -> Path:
    return Path(os.environ.get("OTTO_DATA") or DEFAULT_DATA)


def rooms_dir() -> Path:
    return data_dir() / "rooms"


def catalog_dir() -> Path:
    return data_dir() / "catalog"


def load_catalog() -> list:
    path = catalog_dir() / "catalog.json"
    if not path.is_file():
        return []
    with open(path, encoding="utf-8") as f:
        return json.load(f)


def custom_dir() -> Path:
    return data_dir() / "custom"


def find_item(item_id: str) -> dict | None:
    """A catalog item by id, else a custom item."""
    items = load_catalog() + load_list(custom_dir() / "items.json")
    return next((i for i in items if i["id"] == item_id), None)


def room_dir(room_id: str) -> Path:
    if not ROOM_ID.match(room_id) or not (rooms_dir() / room_id / "scene.json").is_file():
        raise HTTPException(404, "Room not found")
    return rooms_dir() / room_id


def room_name(room_id: str, kind: str = "scan") -> str:
    if kind == "blueprint":
        room_id = re.sub(r"-[0-9a-f]{6}$", "", room_id)
    return room_id.replace("-", " ").title()


def load_scene(room_id: str) -> dict:
    path = room_dir(room_id) / "scene.json"
    with open(path, encoding="utf-8") as f:
        return json.load(f)


def load_list(path: Path) -> list:
    if not path.is_file():
        return []
    with open(path, encoding="utf-8") as f:
        return json.load(f)


def clock() -> float:
    return time.monotonic()


def save_scene(room_id: str, scene: dict, patched: str | None = None) -> None:
    """Save the scene. The scene it replaces goes into history.json first (newest last).
    A patch of the same object within PATCH_MERGE_SECONDS of the last one adds no entry,
    so one undo reverts the whole burst. Call with the lock held."""
    path = room_dir(room_id) / "scene.json"
    with open(path, encoding="utf-8") as f:
        old = json.load(f)
    if old != scene:
        history_path = path.parent / "history.json"
        history = load_list(history_path)
        now = clock()
        last = last_patch.get(path.parent)
        if patched and history and last and last[0] == patched and now - last[1] < PATCH_MERGE_SECONDS:
            last_patch[path.parent] = (patched, now)
        else:
            write_json(history_path, (history + [old])[-HISTORY_LIMIT:])
            if patched:
                last_patch[path.parent] = (patched, now)
            else:
                last_patch.pop(path.parent, None)
    fd, tmp = tempfile.mkstemp(dir=path.parent, suffix=".tmp")
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as f:
            json.dump(scene, f, indent=2)
        os.replace(tmp, path)
    except BaseException:
        if os.path.exists(tmp):
            os.remove(tmp)
        raise


def totals_of(objects: list) -> list:
    """Sum of the visible priced objects, one entry per currency."""
    products = [o["product"] for o in objects if o.get("product") and not o.get("hidden")]
    return currency_totals([p for p in products if p.get("price") is not None])


def total_of(objects: list) -> dict:
    return single_total(totals_of(objects))


def room_response(room_id: str, scene: dict) -> dict:
    objects = scene["objects"]
    return {
        "id": room_id,
        "name": room_name(room_id, scene["room"].get("kind", "scan")),
        "room": scene["room"],
        "objects": objects,
        "warnings": find_warnings(scene["room"], objects),
        "total": total_of(objects),
        "totals": totals_of(objects),
        "door": scene.get("door") or DEFAULT_DOOR,
        "can_undo": bool(load_list(room_dir(room_id) / "history.json")),
    }


def find_object(scene: dict, name: str) -> dict:
    for obj in scene["objects"]:
        if obj["name"] == name:
            return obj
    raise HTTPException(404, "Object not found")


def write_json(path: Path, data) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, tmp = tempfile.mkstemp(dir=path.parent, suffix=".tmp")
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as f:
            json.dump(data, f, indent=2)
        os.replace(tmp, path)
    except BaseException:
        if os.path.exists(tmp):
            os.remove(tmp)
        raise


def load_mandate() -> dict | None:
    path = data_dir() / "mandate.json"
    if not path.is_file():
        return None
    with open(path, encoding="utf-8") as f:
        return json.load(f)


def with_totals(order: dict) -> dict:
    return {**order, "totals": currency_totals(order["items"])}


def load_orders(room_id: str) -> list:
    base = room_dir(room_id) / "orders"
    orders = []
    if base.is_dir():
        for path in base.glob("*.json"):
            with open(path, encoding="utf-8") as f:
                orders.append(with_totals(json.load(f)))
    return sorted(orders, key=lambda o: o["created_at"], reverse=True)


def load_order(room_id: str, order_id: str) -> dict:
    path = room_dir(room_id) / "orders" / f"{order_id}.json"
    if not ROOM_ID.match(order_id) or not path.is_file():
        raise HTTPException(404, "Order not found")
    with open(path, encoding="utf-8") as f:
        return with_totals(json.load(f))


def save_order(room_id: str, order: dict) -> None:
    write_json(room_dir(room_id) / "orders" / f"{order['id']}.json", order)


@app.get("/api/rooms")
def list_rooms():
    result = []
    base = rooms_dir()
    if base.is_dir():
        for d in sorted(base.iterdir()):
            if ROOM_ID.match(d.name) and (d / "scene.json").is_file():
                with lock:
                    scene = load_scene(d.name)
                kind = scene["room"].get("kind", "scan")
                result.append({
                    "id": d.name,
                    "name": room_name(d.name, kind),
                    "kind": kind,
                    "size_xy": scene["room"]["size_xy"],
                    "object_count": len([o for o in scene["objects"] if not o.get("hidden")]),
                })
    return result


@app.get("/api/rooms/{room_id}")
def get_room(room_id: str):
    with lock:
        return room_response(room_id, load_scene(room_id))


@app.patch("/api/rooms/{room_id}")
def set_room_size(room_id: str, body: RoomSize):
    """Resize the room around its centre. Furniture stays where it is; pieces now outside
    the walls come back as wall warnings."""
    with lock:
        scene = load_scene(room_id)
        scene["room"]["size_xy"] = [body.width, body.depth]
        scene["room"]["ceiling_height"] = body.height
        save_scene(room_id, scene)
        return room_response(room_id, scene)


@app.patch("/api/rooms/{room_id}/door")
def set_door(room_id: str, body: DoorSize):
    with lock:
        scene = load_scene(room_id)
        scene["door"] = {"width": body.width, "height": body.height}
        save_scene(room_id, scene)
        return room_response(room_id, scene)


@app.post("/api/rooms/{room_id}/undo")
def undo(room_id: str):
    with lock:
        history_path = room_dir(room_id) / "history.json"
        history = load_list(history_path)
        if not history:
            raise HTTPException(409, "Nothing to undo.")
        scene = history.pop()
        last_patch.pop(room_dir(room_id), None)
        write_json(room_dir(room_id) / "scene.json", scene)
        write_json(history_path, history)
        return room_response(room_id, scene)


def layouts_summary(layouts: list) -> list:
    return [
        {
            "id": l["id"],
            "name": l["name"],
            "saved_at": l["saved_at"],
            "count": len([o for o in l["objects"] if not o.get("hidden")]),
            "total": total_of(l["objects"]),
            "totals": totals_of(l["objects"]),
        }
        for l in layouts
    ]


def find_layout(layouts: list, layout_id: str) -> dict:
    if LAYOUT_ID.match(layout_id):
        for layout in layouts:
            if layout["id"] == layout_id:
                return layout
    raise HTTPException(404, "Layout not found")


@app.get("/api/rooms/{room_id}/layouts")
def list_layouts(room_id: str):
    with lock:
        return layouts_summary(load_list(room_dir(room_id) / "layouts.json"))


@app.post("/api/rooms/{room_id}/layouts")
def save_layout(room_id: str, body: LayoutName):
    with lock:
        scene = load_scene(room_id)
        path = room_dir(room_id) / "layouts.json"
        layouts = load_list(path)
        if len(layouts) >= LAYOUT_LIMIT:
            raise HTTPException(409, f"You can keep {LAYOUT_LIMIT} layouts. Delete one first.")
        layouts.append({
            "id": secrets.token_hex(4),
            "name": body.name,
            "objects": scene["objects"],
            "saved_at": datetime.now(timezone.utc).isoformat(),
        })
        write_json(path, layouts)
        return layouts_summary(layouts)


@app.post("/api/rooms/{room_id}/layouts/{layout_id}/restore")
def restore_layout(room_id: str, layout_id: str):
    with lock:
        scene = load_scene(room_id)
        layout = find_layout(load_list(room_dir(room_id) / "layouts.json"), layout_id)
        scene["objects"] = layout["objects"]
        save_scene(room_id, scene)
        return room_response(room_id, scene)


@app.delete("/api/rooms/{room_id}/layouts/{layout_id}")
def delete_layout(room_id: str, layout_id: str):
    with lock:
        path = room_dir(room_id) / "layouts.json"
        layouts = load_list(path)
        layouts.remove(find_layout(layouts, layout_id))
        write_json(path, layouts)
        return layouts_summary(layouts)


@app.patch("/api/rooms/{room_id}/objects/{name}")
def patch_object(room_id: str, name: str, body: ObjectPatch):
    with lock:
        scene = load_scene(room_id)
        obj = find_object(scene, name)
        if obj.get("hidden"):
            raise HTTPException(409, "Object is hidden")
        if not obj.get("movable", True):
            raise HTTPException(409, "Object is not movable")
        if body.pos is not None:
            obj["pos"] = [body.pos[0], body.pos[1], 0.0]
        if body.yaw is not None:
            obj["yaw"] = body.yaw
        save_scene(room_id, scene, patched=name)
        return room_response(room_id, scene)


@app.post("/api/rooms/{room_id}/objects")
def add_object(room_id: str, body: ObjectAdd):
    with lock:
        scene = load_scene(room_id)
        item = find_item(body.catalog_id)
        if item is None:
            raise HTTPException(404, "Catalog item not found")
        if body.replace is not None:
            if body.pos is not None:
                raise HTTPException(422, "Give either replace or pos, not both")
            target = find_object(scene, body.replace)
            if target.get("hidden"):
                raise HTTPException(409, "Object is hidden")
            if not target.get("movable", True):
                raise HTTPException(409, "Object is not movable")
        if body.pos is not None:
            added = add_at(scene["room"], scene["objects"], item, body.pos, body.yaw or 0.0)
            if added is None:
                raise HTTPException(409, "That spot is no longer free.")
            scene["objects"], name = added
        else:
            scene["objects"], name = add_item(scene["room"], scene["objects"], item, body.replace)
        save_scene(room_id, scene)
        return {**room_response(room_id, scene), "added": name}


@app.delete("/api/rooms/{room_id}/objects/{name}")
def delete_object(room_id: str, name: str):
    with lock:
        scene = load_scene(room_id)
        obj = find_object(scene, name)
        if not obj.get("movable", True):
            raise HTTPException(409, "Object is not movable")
        scene["objects"].remove(obj)
        for other in scene["objects"]:
            if obj.get("replaces") and other["name"] == obj["replaces"]:
                other.pop("hidden", None)
            if other.get("replaces") == name:
                del other["replaces"]
        save_scene(room_id, scene)
        return room_response(room_id, scene)


@app.get("/api/mandate")
def get_mandate():
    with lock:
        return load_mandate()


@app.put("/api/mandate")
def put_mandate(body: MandateBody):
    # A new mock agent token each time the mandate is saved.
    mandate = {
        **body.model_dump(),
        "token_last4": f"{secrets.randbelow(10000):04d}",
        "token_id": "tok_" + secrets.token_hex(8),
        "created_at": datetime.now(timezone.utc).isoformat(),
    }
    with lock:
        write_json(data_dir() / "mandate.json", mandate)
    return mandate


@app.delete("/api/mandate")
def delete_mandate():
    with lock:
        (data_dir() / "mandate.json").unlink(missing_ok=True)
    return None


@app.get("/api/rooms/{room_id}/orders")
def list_orders(room_id: str):
    with lock:
        return load_orders(room_id)


@app.post("/api/rooms/{room_id}/orders/{order_id}/approve")
def approve_order(room_id: str, order_id: str):
    with lock:
        order = load_order(room_id, order_id)
        mandate = load_mandate()
        problems = approval_violations(
            order, load_scene(room_id)["objects"], load_orders(room_id), mandate, date.today()
        )
        if problems:
            raise HTTPException(409, {"violations": problems})
        order = {**order, "status": "approved", "payment": MockVisaProvider().authorize(order, mandate)}
        save_order(room_id, order)
        return order


@app.post("/api/rooms/{room_id}/orders/{order_id}/cancel")
def cancel_order(room_id: str, order_id: str):
    with lock:
        order = load_order(room_id, order_id)
        if order["status"] != "proposed":
            raise HTTPException(409, "Only a proposed order can be cancelled")
        order = {**order, "status": "cancelled"}
        save_order(room_id, order)
        return order


def checkout_state(room_id: str) -> dict:
    with lock:
        return {
            "scene": load_scene(room_id),
            "orders": load_orders(room_id),
            "mandate": load_mandate(),
            "catalog": load_catalog(),
        }


def save_order_locked(room_id: str, order: dict) -> None:
    with lock:
        save_order(room_id, order)


@app.post("/api/rooms/{room_id}/agent/checkout")
def agent_checkout(room_id: str, body: CheckoutBody):
    room_dir(room_id)
    api_key = os.environ.get("ANTHROPIC_API_KEY")
    if not api_key:
        raise HTTPException(503, "Add ANTHROPIC_API_KEY to .env")
    with lock:
        if load_mandate() is None:
            raise HTTPException(409, "Set a spend mandate first")
    try:
        return run_checkout(
            make_client(api_key),
            room_id,
            body.instruction,
            lambda: checkout_state(room_id),
            lambda order: save_order_locked(room_id, order),
        )
    except AgentError as e:
        raise HTTPException(502, str(e))


MEDIA_TYPES = {
    ".glb": "model/gltf-binary",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".png": "image/png",
    ".webp": "image/webp",
    ".json": "application/json",
}
FILE_HEADERS = {"X-Content-Type-Options": "nosniff", "Content-Security-Policy": "default-src 'none'"}


def serve_file(base: Path, path: str):
    base = base.resolve()
    target = (base / path).resolve()
    if not target.is_relative_to(base) or not target.is_file():
        raise HTTPException(404, "File not found")
    # A fixed type per extension, never a guess, so the browser can't be talked into running a file.
    media_type = MEDIA_TYPES.get(target.suffix.lower(), "application/octet-stream")
    return FileResponse(target, media_type=media_type, headers=FILE_HEADERS)


@app.get("/api/catalog")
def get_catalog():
    return load_catalog()


@app.get("/api/catalog/files/{path:path}")
def get_catalog_file(path: str):
    return serve_file(catalog_dir(), path)


@app.get("/files/{room_id}/{path:path}")
def get_file(room_id: str, path: str):
    return serve_file(room_dir(room_id), path)

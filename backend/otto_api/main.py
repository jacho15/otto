import json
import os
import re
import secrets
import shutil
import tempfile
import threading
from datetime import date, datetime, timezone
from pathlib import Path
from typing import Annotated

from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException
from fastapi.exceptions import RequestValidationError
from fastapi.responses import FileResponse, JSONResponse
from pydantic import BaseModel, Field, StringConstraints, field_validator

from .agent import AgentError, make_client, run_checkout
from .checkout import MockVisaProvider, approval_violations
from .fit import find_warnings
from .place import add_item
from .places import router as places_router

REPO_ROOT = Path(__file__).resolve().parent.parent.parent
load_dotenv(REPO_ROOT / ".env")

app = FastAPI(title="Otto API")
app.include_router(places_router)


@app.exception_handler(RequestValidationError)
def validation_error(request, exc):
    # Leave out the raw input: it may hold NaN/Infinity, which JSON cannot encode.
    errors = [{"loc": e["loc"], "msg": e["msg"], "type": e["type"]} for e in exc.errors()]
    return JSONResponse({"detail": errors}, status_code=422)

ROOM_ID = re.compile(r"^[a-z0-9][a-z0-9-]*$")
DEFAULT_DATA = REPO_ROOT / "data"
lock = threading.Lock()

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


class ObjectAdd(BaseModel):
    catalog_id: str
    replace: str | None = None


class MandateBody(BaseModel):
    max_item_price: Money | None
    max_total: Money | None
    shops: Annotated[list[Shop], Field(max_length=10)]
    expires: Annotated[str, Field(pattern=r"^\d{4}-\d{2}-\d{2}$")] | None

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


def save_scene(room_id: str, scene: dict) -> None:
    path = room_dir(room_id) / "scene.json"
    fd, tmp = tempfile.mkstemp(dir=path.parent, suffix=".tmp")
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as f:
            json.dump(scene, f, indent=2)
        os.replace(tmp, path)
    except BaseException:
        if os.path.exists(tmp):
            os.remove(tmp)
        raise


def room_response(room_id: str, scene: dict) -> dict:
    objects = scene["objects"]
    products = [o["product"] for o in objects if o.get("product") and not o.get("hidden")]
    prices = [p["price"] for p in products if p.get("price") is not None]
    currency = next((p["currency"] for p in products if p.get("currency")), "USD")
    return {
        "id": room_id,
        "name": room_name(room_id, scene["room"].get("kind", "scan")),
        "room": scene["room"],
        "objects": objects,
        "warnings": find_warnings(scene["room"], objects),
        "total": {"amount": round(sum(prices), 2), "currency": currency},
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


def load_orders(room_id: str) -> list:
    base = room_dir(room_id) / "orders"
    orders = []
    if base.is_dir():
        for path in base.glob("*.json"):
            with open(path, encoding="utf-8") as f:
                orders.append(json.load(f))
    return sorted(orders, key=lambda o: o["created_at"], reverse=True)


def load_order(room_id: str, order_id: str) -> dict:
    path = room_dir(room_id) / "orders" / f"{order_id}.json"
    if not ROOM_ID.match(order_id) or not path.is_file():
        raise HTTPException(404, "Order not found")
    with open(path, encoding="utf-8") as f:
        return json.load(f)


def save_order(room_id: str, order: dict) -> None:
    write_json(room_dir(room_id) / "orders" / f"{order['id']}.json", order)


def copy_mesh(room_id: str, item: dict) -> None:
    """Copy the catalog model file into the room's meshes. Raises FileNotFoundError."""
    source = catalog_dir() / item["model"]
    if not source.is_file():
        raise FileNotFoundError(item["model"])
    mesh = room_dir(room_id) / "meshes" / f"{item['id']}.glb"
    if not mesh.exists():
        mesh.parent.mkdir(exist_ok=True)
        tmp = mesh.with_suffix(".tmp")
        shutil.copyfile(source, tmp)
        os.replace(tmp, mesh)


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
        save_scene(room_id, scene)
        return room_response(room_id, scene)


@app.post("/api/rooms/{room_id}/objects")
def add_object(room_id: str, body: ObjectAdd):
    with lock:
        scene = load_scene(room_id)
        item = next((i for i in load_catalog() if i["id"] == body.catalog_id), None)
        if item is None:
            raise HTTPException(404, "Catalog item not found")
        if body.replace is not None:
            target = find_object(scene, body.replace)
            if target.get("hidden"):
                raise HTTPException(409, "Object is hidden")
            if not target.get("movable", True):
                raise HTTPException(409, "Object is not movable")
        try:
            copy_mesh(room_id, item)
        except FileNotFoundError:
            raise HTTPException(404, "Model file not found")
        scene["objects"], name = add_item(scene["room"], scene["objects"], item, body.replace)
        save_scene(room_id, scene)
        return {**room_response(room_id, scene), "added": name}


@app.delete("/api/rooms/{room_id}/objects/{name}")
def delete_object(room_id: str, name: str):
    with lock:
        scene = load_scene(room_id)
        obj = find_object(scene, name)
        scene["objects"].remove(obj)
        if obj.get("replaces"):
            for other in scene["objects"]:
                if other["name"] == obj["replaces"]:
                    other.pop("hidden", None)
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


def serve_file(base: Path, path: str):
    base = base.resolve()
    target = (base / path).resolve()
    if not target.is_relative_to(base) or not target.is_file():
        raise HTTPException(404, "File not found")
    return FileResponse(target)


@app.get("/api/catalog")
def get_catalog():
    return load_catalog()


@app.get("/api/catalog/files/{path:path}")
def get_catalog_file(path: str):
    return serve_file(catalog_dir(), path)


@app.get("/files/{room_id}/{path:path}")
def get_file(room_id: str, path: str):
    return serve_file(room_dir(room_id), path)

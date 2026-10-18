import json
import os
import re
import shutil
import tempfile
import threading
from pathlib import Path
from typing import Annotated

from fastapi import FastAPI, HTTPException
from fastapi.exceptions import RequestValidationError
from fastapi.responses import FileResponse, JSONResponse
from pydantic import BaseModel, Field

from .fit import find_warnings
from .place import add_item

app = FastAPI(title="Otto API")


@app.exception_handler(RequestValidationError)
def validation_error(request, exc):
    # Leave out the raw input: it may hold NaN/Infinity, which JSON cannot encode.
    errors = [{"loc": e["loc"], "msg": e["msg"], "type": e["type"]} for e in exc.errors()]
    return JSONResponse({"detail": errors}, status_code=422)

ROOM_ID = re.compile(r"^[a-z0-9][a-z0-9-]*$")
DEFAULT_DATA = Path(__file__).resolve().parent.parent.parent / "data"
lock = threading.Lock()

Number = Annotated[float, Field(allow_inf_nan=False)]


class ObjectPatch(BaseModel):
    pos: Annotated[list[Number], Field(min_length=2, max_length=2)] | None = None
    yaw: Number | None = None


class ObjectAdd(BaseModel):
    catalog_id: str
    replace: str | None = None


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


def room_name(room_id: str) -> str:
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
        "name": room_name(room_id),
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


@app.get("/api/rooms")
def list_rooms():
    result = []
    base = rooms_dir()
    if base.is_dir():
        for d in sorted(base.iterdir()):
            if ROOM_ID.match(d.name) and (d / "scene.json").is_file():
                with lock:
                    scene = load_scene(d.name)
                result.append({
                    "id": d.name,
                    "name": room_name(d.name),
                    "size_xy": scene["room"]["size_xy"],
                    "object_count": len([o for o in scene["objects"] if not o.get("hidden")]),
                })
    return result


@app.get("/api/rooms/{room_id}")
def get_room(room_id: str):
    with lock:
        return room_response(room_id, load_scene(room_id))


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
        source = catalog_dir() / item["model"]
        if not source.is_file():
            raise HTTPException(404, "Model file not found")
        mesh = room_dir(room_id) / "meshes" / f"{item['id']}.glb"
        if not mesh.exists():
            mesh.parent.mkdir(exist_ok=True)
            tmp = mesh.with_suffix(".tmp")
            shutil.copyfile(source, tmp)
            os.replace(tmp, mesh)
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

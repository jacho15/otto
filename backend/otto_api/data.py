"""What Otto keeps on this computer: a summary and a way to delete each kind of data.

Deleting touches only files inside the data folder. Never scene.json, meshes or the catalog.
"""
import json
from pathlib import Path

from fastapi import APIRouter, HTTPException

router = APIRouter()

NOTE = (
    "Everything stays in Otto's data folder on this computer. "
    "Product pages you import are fetched once to read the product. "
    "Chat messages are sent to Anthropic's API to generate replies."
)
LABELS = {
    "mandate": "Spend mandate",
    "orders": "Orders",
    "chats": "Chats",
    "prefs": "Assistant preferences",
    "history": "Undo history",
    "layouts": "Saved layouts",
    "saved": "Liked items",
    "custom": "Custom items",
}


def read(path: Path, default):
    try:
        return json.loads(path.read_text("utf-8"))
    except (OSError, ValueError):
        return default


def room_dirs() -> list:
    from . import main
    base = main.rooms_dir()
    if not base.is_dir():
        return []
    return sorted(d for d in base.iterdir() if main.ROOM_ID.match(d.name) and d.is_dir())


def room_files(name: str) -> list:
    return [d / name for d in room_dirs()]


def kind_files(kind: str) -> list:
    """The files that hold this kind of data."""
    from . import main
    data = main.data_dir()
    if kind == "mandate":
        paths = [data / "mandate.json"]
    elif kind == "orders":
        paths = [p for d in room_dirs() for p in (d / "orders").glob("*.json")]
    elif kind in ("chats", "prefs"):
        paths = room_files("chat.json")
    elif kind == "history":
        paths = room_files("history.json")
    elif kind == "layouts":
        paths = room_files("layouts.json")
    elif kind == "saved":
        paths = [data / "saved.json"]
    else:
        paths = [main.custom_dir() / "items.json"]
        files = main.custom_dir() / "files"
        paths += list(files.iterdir()) if files.is_dir() else []
    root = data.resolve()
    return [p for p in paths if p.is_file() and p.resolve().is_relative_to(root)]


def clear_chat(path: Path, key: str) -> None:
    """Empty one list of a chat.json (messages or prefs) and keep the other. Delete the file if both are empty."""
    from . import main
    chat = read(path, {})
    chat[key] = []
    if chat.get("messages") or chat.get("prefs"):
        main.write_json(path, chat)
    else:
        path.unlink(missing_ok=True)


def summary() -> dict:
    """Call with the lock held."""
    from . import main
    mandate = main.load_mandate()
    orders = kind_files("orders")
    chats = [len(read(p, {}).get("messages", [])) for p in kind_files("chats")]
    chats = [n for n in chats if n]
    prefs = sum(len(read(p, {}).get("prefs", [])) for p in kind_files("prefs"))
    history = [p for p in kind_files("history") if read(p, []) or read(p.with_name("redo.json"), [])]
    layouts = sum(len(read(p, [])) for p in kind_files("layouts"))
    saved = len(read(main.data_dir() / "saved.json", []))
    custom = len(read(main.custom_dir() / "items.json", []))
    uploads = len([p for p in kind_files("custom") if p.name != "items.json"])
    counts = {
        "mandate": (1 if mandate else 0, f"Token ending {mandate['token_last4']}" if mandate else "Not set"),
        "orders": (len(orders), f"Rooms: {len({p.parent.parent for p in orders})}"),
        "chats": (len(chats), f"{sum(chats)} messages"),
        "prefs": (prefs, f"{prefs} preferences"),
        "history": (len(history), f"Rooms: {len(history)}"),
        "layouts": (layouts, f"{layouts} layouts"),
        "saved": (saved, f"{saved} liked items"),
        "custom": (custom, f"{custom} items, {uploads} uploaded files"),
    }
    return {
        "items": [{"kind": k, "label": LABELS[k], "count": c, "detail": d} for k, (c, d) in counts.items()],
        "note": NOTE,
    }


@router.get("/api/data")
def get_data():
    from . import main
    with main.lock:
        return summary()


@router.delete("/api/data/{kind}")
def delete_data(kind: str):
    from . import main
    if kind not in LABELS:
        raise HTTPException(404, "Unknown kind of data")
    with main.lock:
        for path in kind_files(kind):
            if kind in ("chats", "prefs"):
                clear_chat(path, "messages" if kind == "chats" else "prefs")
            else:
                path.unlink(missing_ok=True)
                if kind == "history":
                    path.with_name("redo.json").unlink(missing_ok=True)
        return summary()

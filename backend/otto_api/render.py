"""A picture of a room, made on the server, for replies that can't show the live 3D view (texts, chats).

It opens the room page in headless Chromium in capture mode (only the 3D view), waits until every
model has loaded, and screenshots it. The website must be running at OTTO_FRONTEND_URL.
"""
import os
from urllib.parse import quote, urlencode

from fastapi import APIRouter, HTTPException, Response

router = APIRouter()

WIDTH, HEIGHT = 1200, 900
TIMEOUT_MS = 45_000


class RenderError(Exception):
    """The picture couldn't be made. The message says why, in plain words."""


def frontend_url() -> str:
    return os.environ.get("OTTO_FRONTEND_URL", "http://localhost:5173").rstrip("/")


def capture_url(room_id: str, select: str | None) -> str:
    query = {"capture": "1", **({"select": select} if select else {})}
    return f"{frontend_url()}/rooms/{quote(room_id, safe='')}?{urlencode(query)}"


def render_room_png(room_id: str, select: str | None = None) -> bytes:
    """PNG bytes of the room's 3D view, with `select` highlighted. Raises RenderError."""
    try:
        from playwright.sync_api import Error as PlaywrightError, TimeoutError as PlaywrightTimeout, sync_playwright
    except ImportError:
        raise RenderError("Room pictures need Playwright. Run: uv run playwright install chromium")
    try:
        with sync_playwright() as p:
            # SwiftShader gives headless Chromium a software WebGL, so this works without a GPU.
            browser = p.chromium.launch(args=["--use-angle=swiftshader", "--enable-unsafe-swiftshader"])
            try:
                page = browser.new_page(viewport={"width": WIDTH, "height": HEIGHT})
                page.goto(capture_url(room_id, select), wait_until="domcontentloaded", timeout=TIMEOUT_MS)
                page.wait_for_selector("html[data-scene-ready='1']", state="attached", timeout=TIMEOUT_MS)
                return page.locator(".viewport").first.screenshot(type="png")
            finally:
                browser.close()
    except PlaywrightTimeout:
        raise RenderError("The room took too long to draw. Is the website running?")
    except PlaywrightError as e:
        if "Executable doesn't exist" in str(e):
            raise RenderError("Room pictures need Chromium. Run: uv run playwright install chromium")
        if "ERR_CONNECTION_REFUSED" in str(e):
            raise RenderError(f"The website isn't running at {frontend_url()}.")
        raise RenderError("Couldn't draw the room.")


@router.get("/api/rooms/{room_id}/render.png")
def room_picture(room_id: str, select: str | None = None):
    """A PNG of the room as the 3D view shows it. `select` highlights one visible piece."""
    from . import main
    with main.lock:
        scene = main.load_scene(room_id)  # 404 for an unknown room
    if select is not None:
        obj = main.find_object(scene, select)  # 404 for an unknown piece
        if obj.get("hidden"):
            raise HTTPException(404, "Object not found")
    try:
        png = render_room_png(room_id, select)
    except RenderError as e:
        raise HTTPException(503, str(e))
    return Response(png, media_type="image/png", headers={"Cache-Control": "no-store"})

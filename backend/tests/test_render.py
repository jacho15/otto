import pytest

from conftest import ROOM
from otto_api import render

PNG = b"\x89PNG\r\n\x1a\n" + bytes(16)


@pytest.fixture
def drawn(monkeypatch):
    calls = []

    def fake(room_id, select=None):
        calls.append((room_id, select))
        return PNG

    monkeypatch.setattr(render, "render_room_png", fake)
    return calls


def test_render_returns_a_png(client, drawn):
    r = client.get(f"/api/rooms/{ROOM}/render.png")
    assert r.status_code == 200
    assert r.headers["content-type"] == "image/png"
    assert r.content == PNG
    assert drawn == [(ROOM, None)]


def test_render_highlights_a_piece(client, drawn):
    assert client.get(f"/api/rooms/{ROOM}/render.png", params={"select": "sofa"}).status_code == 200
    assert drawn == [(ROOM, "sofa")]


def test_render_unknown_room_or_piece_is_404_without_drawing(client, drawn):
    assert client.get("/api/rooms/nope/render.png").status_code == 404
    assert client.get(f"/api/rooms/{ROOM}/render.png", params={"select": "nope"}).status_code == 404
    assert drawn == []


def test_render_failure_is_503_with_the_reason(client, monkeypatch):
    def broken(room_id, select=None):
        raise render.RenderError("The website isn't running at http://localhost:5173.")

    monkeypatch.setattr(render, "render_room_png", broken)
    r = client.get(f"/api/rooms/{ROOM}/render.png")
    assert r.status_code == 503
    assert "isn't running" in r.json()["detail"]


def test_capture_url_escapes_and_asks_for_capture_mode(monkeypatch):
    monkeypatch.setenv("OTTO_FRONTEND_URL", "http://example.test:5173/")
    url = render.capture_url("demo room", "sofa & chair")
    assert url == "http://example.test:5173/rooms/demo%20room?capture=1&select=sofa+%26+chair"
    assert render.capture_url(ROOM, None).endswith("?capture=1")


MP4 = b"\x00\x00\x00\x18ftypmp42" + bytes(16)


@pytest.fixture
def filmed(monkeypatch):
    calls = []

    def fake(room_id, focus):
        calls.append((room_id, focus))
        return MP4

    monkeypatch.setattr(render, "render_room_tour_mp4", fake)
    return calls


def test_tour_returns_an_mp4_of_the_piece(client, filmed):
    r = client.get(f"/api/rooms/{ROOM}/tour.mp4", params={"focus": "sofa"})
    assert r.status_code == 200
    assert r.headers["content-type"] == "video/mp4"
    assert r.content == MP4
    assert filmed == [(ROOM, "sofa")]


def test_tour_needs_a_known_piece_and_room(client, filmed):
    assert client.get(f"/api/rooms/{ROOM}/tour.mp4").status_code == 422  # focus is required
    assert client.get(f"/api/rooms/{ROOM}/tour.mp4", params={"focus": "nope"}).status_code == 404
    assert client.get("/api/rooms/nope/tour.mp4", params={"focus": "sofa"}).status_code == 404
    assert filmed == []


def test_tour_failure_is_503(client, monkeypatch):
    def broken(room_id, focus):
        raise render.RenderError("Room videos need ffmpeg.")

    monkeypatch.setattr(render, "render_room_tour_mp4", broken)
    r = client.get(f"/api/rooms/{ROOM}/tour.mp4", params={"focus": "sofa"})
    assert r.status_code == 503 and "ffmpeg" in r.json()["detail"]


def test_capture_url_for_a_tour():
    assert render.capture_url(ROOM, None, tour="sofa").endswith(f"/rooms/{ROOM}?capture=1&tour=sofa")

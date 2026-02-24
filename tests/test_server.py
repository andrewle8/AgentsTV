"""Tests for agentstv.server — API endpoints."""

import pytest


pytestmark = pytest.mark.asyncio


@pytest.fixture(autouse=True)
def _clear_rate_limits():
    """Clear the in-memory rate limiter between tests."""
    from agentstv.server import _rate_limits
    _rate_limits.clear()
    yield
    _rate_limits.clear()


async def test_index_returns_html(app_client):
    """GET / returns 200 with HTML content."""
    resp = await app_client.get("/")
    assert resp.status_code == 200
    assert "html" in resp.headers.get("content-type", "").lower()


async def test_list_sessions(app_client):
    """GET /api/sessions returns 200 and a JSON list."""
    resp = await app_client.get("/api/sessions")
    assert resp.status_code == 200
    data = resp.json()
    assert isinstance(data, list)


async def test_get_settings(app_client):
    """GET /api/settings returns 200 and includes 'provider' key."""
    resp = await app_client.get("/api/settings")
    assert resp.status_code == 200
    data = resp.json()
    assert "provider" in data


async def test_put_settings_invalid_url(app_client):
    """PUT /api/settings with an invalid URL returns 400."""
    resp = await app_client.put(
        "/api/settings",
        json={"ollama_url": "not-a-url"},
    )
    assert resp.status_code == 400


async def test_chat_empty_message(app_client):
    """POST /api/chat with an empty message returns an error response."""
    resp = await app_client.post("/api/chat", json={"message": ""})
    data = resp.json()
    assert "error" in data


async def test_chat_too_long(app_client):
    """POST /api/chat with a message over 2000 chars returns 400."""
    long_msg = "x" * 3000
    resp = await app_client.post("/api/chat", json={"message": long_msg})
    assert resp.status_code == 400
    data = resp.json()
    assert "error" in data


async def test_path_traversal_blocked(app_client):
    """GET /api/session/../../etc/passwd must not leak file contents."""
    resp = await app_client.get("/api/session/../../etc/passwd")
    # Should either 404, return error JSON, or simply not return file contents
    if resp.status_code == 200:
        data = resp.json()
        assert "error" in data or "events" not in data or data.get("events") == []
    else:
        # Any non-200 is acceptable (404, 422, etc.)
        assert resp.status_code >= 400


async def test_rate_limiting(app_client):
    """Hitting /api/chat 35 times rapidly should trigger 429 on later requests."""
    statuses = []
    for _ in range(35):
        resp = await app_client.post(
            "/api/chat", json={"message": "test"}
        )
        statuses.append(resp.status_code)
    assert 429 in statuses


async def test_viewer_react_empty(app_client):
    """POST /api/viewer-react with an empty message returns empty reactions."""
    resp = await app_client.post("/api/viewer-react", json={"message": ""})
    assert resp.status_code == 200
    data = resp.json()
    assert data.get("reactions") == []

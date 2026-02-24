"""Shared fixtures for agentstv tests."""

import json
import shutil
import tempfile
from pathlib import Path

import httpx
import pytest
import pytest_asyncio


@pytest.fixture()
def tmp_dir():
    """Create a temporary directory, yield it, and clean up afterward."""
    d = Path(tempfile.mkdtemp(prefix="agentstv_test_"))
    yield d
    shutil.rmtree(d, ignore_errors=True)


@pytest.fixture()
def sample_claude_jsonl(tmp_dir):
    """Write a minimal valid Claude Code JSONL file and return its Path."""
    records = [
        {
            "type": "user",
            "sessionId": "test-session-123",
            "timestamp": "2024-01-01T00:00:00Z",
            "message": {"content": "Hello"},
        },
        {
            "type": "assistant",
            "sessionId": "test-session-123",
            "timestamp": "2024-01-01T00:00:01Z",
            "message": {
                "content": [{"type": "text", "text": "Hi there"}],
                "usage": {
                    "input_tokens": 100,
                    "output_tokens": 50,
                    "cache_read_input_tokens": 10,
                },
            },
        },
        {
            "type": "assistant",
            "sessionId": "test-session-123",
            "timestamp": "2024-01-01T00:00:02Z",
            "message": {
                "content": [
                    {"type": "tool_use", "name": "Bash", "input": {"command": "ls"}}
                ],
                "usage": {
                    "input_tokens": 50,
                    "output_tokens": 25,
                    "cache_read_input_tokens": 5,
                },
            },
        },
    ]
    p = tmp_dir / "test-session-123.jsonl"
    with open(p, "w", encoding="utf-8") as f:
        for rec in records:
            f.write(json.dumps(rec) + "\n")
    return p


@pytest.fixture()
def sample_codex_jsonl(tmp_dir):
    """Write a minimal valid Codex CLI JSONL file and return its Path."""
    records = [
        {
            "type": "session_meta",
            "timestamp": "2024-01-01T00:00:00Z",
            "model": "o4-mini",
            "session_id": "codex-session-1",
        },
        {
            "type": "response_item",
            "timestamp": "2024-01-01T00:00:01Z",
            "item": {
                "type": "message",
                "role": "user",
                "content": [{"type": "text", "text": "Fix the bug"}],
            },
        },
        {
            "type": "response_item",
            "timestamp": "2024-01-01T00:00:02Z",
            "item": {
                "type": "message",
                "role": "assistant",
                "content": [{"type": "text", "text": "Sure, fixing now."}],
            },
        },
    ]
    p = tmp_dir / "rollout-codex-test.jsonl"
    with open(p, "w", encoding="utf-8") as f:
        for rec in records:
            f.write(json.dumps(rec) + "\n")
    return p


@pytest.fixture()
def sample_gemini_json(tmp_dir):
    """Write a minimal valid Gemini CLI JSON file and return its Path."""
    data = {
        "messages": [
            {
                "role": "user",
                "parts": [{"text": "What is 2 + 2?"}],
                "timestamp": "2024-01-01T00:00:00Z",
            },
            {
                "role": "model",
                "parts": [{"text": "The answer is 4."}],
                "timestamp": "2024-01-01T00:00:01Z",
            },
        ]
    }
    p = tmp_dir / "gemini-session.json"
    with open(p, "w", encoding="utf-8") as f:
        json.dump(data, f)
    return p


@pytest.fixture()
def malformed_jsonl(tmp_dir):
    """Write a file with a mix of valid JSON lines and garbage."""
    lines = [
        '{"type":"user","sessionId":"bad","timestamp":"2024-01-01T00:00:00Z","message":{"content":"ok"}}',
        "THIS IS NOT JSON {{{",
        "",
        '{"type":"assistant","sessionId":"bad","timestamp":"2024-01-01T00:00:01Z","message":{"content":[]}}',
        "another garbage line %%%",
    ]
    p = tmp_dir / "malformed.jsonl"
    with open(p, "w", encoding="utf-8") as f:
        for line in lines:
            f.write(line + "\n")
    return p


@pytest.fixture()
def large_jsonl(tmp_dir):
    """Write a JSONL file with 60,000 lines to test truncation handling."""
    p = tmp_dir / "large-session.jsonl"
    line = json.dumps(
        {
            "type": "assistant",
            "sessionId": "large-test",
            "timestamp": "2024-01-01T00:00:00Z",
            "message": {"content": []},
        }
    )
    with open(p, "w", encoding="utf-8") as f:
        for _ in range(60_000):
            f.write(line + "\n")
    return p


@pytest_asyncio.fixture()
async def app_client():
    """Return an httpx.AsyncClient wrapping the FastAPI test app."""
    from agentstv.server import app

    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
        yield client

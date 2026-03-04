"""FastAPI web server for agentstv."""

from __future__ import annotations

import argparse
import asyncio
import hashlib
import logging
import os
import random
import re
import sys
import time
import webbrowser
from contextlib import asynccontextmanager
from pathlib import Path
from urllib.parse import urlparse

import httpx
from fastapi import FastAPI, Request, WebSocket, WebSocketDisconnect
from fastapi.responses import FileResponse, HTMLResponse, JSONResponse
from fastapi.staticfiles import StaticFiles

from . import __version__, llm
from .parser import parse
from .scanner import scan_sessions, _DEFAULT_SOURCES

logger = logging.getLogger(__name__)

WEB_DIR = Path(__file__).parent / "web"

# Allow overriding the session log directory via env var
_data_dir_env = os.environ.get("AGENTSTV_DATA_DIR")
DATA_DIR: Path | None = Path(_data_dir_env) if _data_dir_env else None


@asynccontextmanager
async def _lifespan(app: FastAPI):
    yield
    await llm.shutdown_clients()


app = FastAPI(title="agentstv", lifespan=_lifespan)

# Public mode — redacts sensitive content before sending to clients
PUBLIC_MODE = False

# Map hashed file paths back to real paths (for public mode routing)
_path_map: dict[str, str] = {}

# Maximum length for user chat messages
MAX_MESSAGE_LENGTH = 2000

# Simple in-memory rate limiter
_rate_limits: dict[str, list[float]] = {}
_RATE_LIMIT_WINDOW = 60  # seconds
_RATE_LIMIT_MAX = 30  # requests per window


_rate_limit_cleanup_counter = 0


def _check_rate_limit(client_ip: str) -> bool:
    """Return True if the request is within rate limits."""
    global _rate_limit_cleanup_counter
    now = time.time()
    timestamps = _rate_limits.get(client_ip, [])
    # Prune old entries
    timestamps = [t for t in timestamps if now - t < _RATE_LIMIT_WINDOW]
    if len(timestamps) >= _RATE_LIMIT_MAX:
        _rate_limits[client_ip] = timestamps
        return False
    timestamps.append(now)
    _rate_limits[client_ip] = timestamps
    # Periodic global cleanup every 100 requests
    _rate_limit_cleanup_counter += 1
    if _rate_limit_cleanup_counter >= 100:
        _rate_limit_cleanup_counter = 0
        stale = [k for k, v in _rate_limits.items() if not v or all(now - t >= _RATE_LIMIT_WINDOW for t in v)]
        for k in stale:
            del _rate_limits[k]
    return True

# Patterns that look like secrets
_SECRET_PATTERNS = re.compile(
    r'(?i)'
    r'(?:'
    r'(?:api[_-]?key|apikey|secret[_-]?key|access[_-]?token|auth[_-]?token'
    r'|password|passwd|pwd|bearer|authorization|private[_-]?key'
    r'|client[_-]?secret|refresh[_-]?token|session[_-]?token'
    r'|database[_-]?url|connection[_-]?string|dsn'
    r'|aws[_-]?secret|stripe[_-]?sk|sk[_-]live|sk[_-]test'
    r')\s*[=:]\s*\S+'
    r'|(?:ghp_|gho_|github_pat_|xox[bpsar]-|slack_|AKIA)[A-Za-z0-9_-]{10,}'
    r'|[A-Za-z0-9+/]{40,}'  # long base64-ish strings
    r'|eyJ[A-Za-z0-9_-]{20,}'  # JWT tokens
    r')'
)

# Full paths patterns (Windows and Unix)
_PATH_PATTERN = re.compile(
    r'(?:[A-Z]:\\|/(?:home|Users|mnt|var|etc|opt|tmp)/)\S+'
)


def _redact_text(text: str) -> str:
    """Redact secrets and full paths from text."""
    if not text:
        return text
    # Redact secret-like patterns
    text = _SECRET_PATTERNS.sub('[REDACTED]', text)
    # Redact full file paths, keep just the filename
    def _path_to_name(m: re.Match) -> str:
        p = m.group(0).rstrip('",\'`;:)]}>').rstrip()
        name = Path(p).name
        return f'…/{name}'
    text = _PATH_PATTERN.sub(_path_to_name, text)
    return text


def _redact_event(evt: dict) -> dict:
    """Redact sensitive fields from an event dict."""
    if not PUBLIC_MODE:
        return evt
    evt = dict(evt)  # shallow copy
    evt['content'] = _redact_text(evt.get('content', ''))
    evt['summary'] = _redact_text(evt.get('summary', ''))
    # Only show filename, not full path
    if evt.get('file_path'):
        evt['file_path'] = Path(evt['file_path']).name
        evt['short_path'] = evt['file_path']
    return evt


def _redact_session(data: dict) -> dict:
    """Redact a full session dict."""
    if not PUBLIC_MODE:
        return data
    data = dict(data)
    data['events'] = [_redact_event(e) for e in data.get('events', [])]
    return data


def _redact_summary(s: dict) -> dict:
    """Redact a session summary dict."""
    if not PUBLIC_MODE:
        return s
    s = dict(s)
    # Replace file path with hash, store mapping for lookups
    if s.get('file_path'):
        hashed = hashlib.md5(s['file_path'].encode()).hexdigest()[:12]
        _path_map[hashed] = s['file_path']
        s['file_path'] = hashed
    return s


async def _resolve_session_path(session_id: str) -> Path | None:
    """Resolve a session_id to a validated file path.

    Returns the Path if it exists and is under DATA_DIR (when set),
    or None if the session cannot be found or fails validation.
    """
    # Check public-mode hash map first
    real_path = _path_map.get(session_id, session_id)
    file_path = Path(real_path)

    if not file_path.exists():
        # Try finding by session ID in known locations
        summaries = await asyncio.to_thread(scan_sessions, DATA_DIR)
        for s in summaries:
            if s.id == session_id or s.file_path == session_id:
                file_path = Path(s.file_path)
                break

    if not file_path.exists():
        return None

    # Path traversal guard: resolved path must be under allowed directories
    try:
        resolved = file_path.resolve()
        if DATA_DIR is not None:
            allowed_roots = [DATA_DIR.resolve()]
        else:
            allowed_roots = [src[0].resolve() for src in _DEFAULT_SOURCES if src[0].is_dir()]
        if not any(resolved.is_relative_to(root) for root in allowed_roots):
            logger.warning("Path traversal blocked: %s is not under any allowed directory", resolved)
            return None
    except (OSError, ValueError) as exc:
        logger.warning("Path validation failed for %s: %s", file_path, exc)
        return None

    return file_path


app.mount("/static", StaticFiles(directory=str(WEB_DIR)), name="static")


@app.get("/api/ollama-models")
async def get_ollama_models():
    """Return list of locally available Ollama model names."""
    try:
        url = f"{llm.OLLAMA_URL}/api/tags"
        async with httpx.AsyncClient(timeout=5.0) as client:
            resp = await client.get(url)
            resp.raise_for_status()
            data = resp.json()
        models = [m["name"] for m in data.get("models", [])]
        return {"models": models}
    except Exception:
        return {"models": [], "error": "Could not reach Ollama"}


@app.post("/api/chat")
async def post_chat(request: Request):
    """Interactive chat — user asks a question about agent activity."""
    client_ip = request.client.host if request.client else "unknown"
    if not _check_rate_limit(client_ip):
        return JSONResponse({"error": "Rate limit exceeded"}, status_code=429)

    if llm.LLM_PROVIDER == "off":
        return {"error": "LLM is disabled"}

    try:
        body = await request.json()
    except Exception:
        return JSONResponse({"error": "Invalid JSON body"}, status_code=400)
    user_message = body.get("message", "").strip()
    session_id = body.get("session_id", "")
    reply_to_index = body.get("reply_to_event_index")

    if not user_message:
        return {"error": "Empty message"}

    # Input validation
    if len(user_message) > MAX_MESSAGE_LENGTH:
        return JSONResponse(
            {"error": f"Message too long (max {MAX_MESSAGE_LENGTH} characters)"},
            status_code=400,
        )

    if reply_to_index is not None:
        if not isinstance(reply_to_index, int):
            return JSONResponse(
                {"error": "reply_to_event_index must be an integer"},
                status_code=400,
            )

    # Load session for context
    event_content = ""
    event_type = ""
    context = ""
    if session_id:
        try:
            file_path = await _resolve_session_path(session_id)
            if file_path:
                session = await asyncio.to_thread(parse, file_path)
                session_data = _redact_session(session.to_dict())
                context = _build_context(session_data, n=8)
                # Extract specific event if replying to one
                events = session_data.get("events", [])
                if reply_to_index is not None and 0 <= reply_to_index < len(events):
                    target = events[reply_to_index]
                    event_content = target.get("content", "")
                    event_type = target.get("type", "")
        except Exception:
            logger.exception("Failed to load session %s for chat context", session_id)

    reply = await llm.generate_interactive_reply(
        user_message, event_content, event_type, context
    )
    if reply:
        return {"reply": reply}
    return {"error": "Failed to generate reply"}


@app.get("/", response_class=HTMLResponse)
async def index():
    return FileResponse(WEB_DIR / "index.html")


@app.get("/api/settings")
async def get_settings():
    return llm.get_settings()


@app.put("/api/settings")
async def put_settings(request: Request):
    try:
        body = await request.json()
    except Exception:
        return JSONResponse({"error": "Invalid JSON body"}, status_code=400)

    # Validate Ollama URL format and restrict to loopback
    ollama_url = body.get("ollama_url")
    if ollama_url is not None:
        if not isinstance(ollama_url, str) or not ollama_url.startswith(("http://", "https://")):
            return JSONResponse({"error": "Invalid Ollama URL — must start with http:// or https://"}, status_code=400)
        parsed_url = urlparse(ollama_url)
        if parsed_url.hostname not in ("localhost", "127.0.0.1", "::1"):
            return JSONResponse({"error": "Ollama URL must point to localhost"}, status_code=400)

    # Validate API key lengths
    for key_name in ("openai_key", "anthropic_key"):
        val = body.get(key_name)
        if val is not None and isinstance(val, str) and val and len(val) < 10:
            return JSONResponse({"error": f"Invalid {key_name} — too short"}, status_code=400)

    llm.configure(
        provider=body.get("provider"),
        ollama_url=ollama_url,
        ollama_model=body.get("ollama_model"),
        openai_key=body.get("openai_key"),
        openai_model=body.get("openai_model"),
        anthropic_key=body.get("anthropic_key"),
        anthropic_model=body.get("anthropic_model"),
        low_power=body.get("low_power"),
    )
    _chat_buffers.clear()
    _narrator_buffers.clear()
    return llm.get_settings()


@app.get("/api/sessions")
async def list_sessions():
    summaries = await asyncio.to_thread(scan_sessions, DATA_DIR)
    return [_redact_summary(s.to_dict()) for s in summaries]


@app.get("/api/session-preview/{session_id:path}")
async def get_session_preview(session_id: str):
    """Return only the most recent substantial event content for thumbnails."""
    file_path = await _resolve_session_path(session_id)
    if not file_path:
        return {"content": "", "type": ""}
    try:
        session = await asyncio.to_thread(parse, file_path)
        for evt in reversed(session.events):
            d = _redact_event(evt.to_dict())
            if d.get("content") and len(d["content"]) > 10:
                return {"content": d["content"], "type": d.get("type", "")}
    except Exception:
        logger.exception("Failed to parse session preview %s", session_id)
    return {"content": "", "type": ""}


@app.get("/api/session/{session_id:path}")
async def get_session(session_id: str):
    """Parse and return a full session by file path (base64 or direct)."""
    file_path = await _resolve_session_path(session_id)
    if not file_path:
        return JSONResponse({"error": "Session not found"}, status_code=404)
    session = await asyncio.to_thread(parse, file_path)
    return _redact_session(session.to_dict())


# Buffer of pre-generated viewer chat messages per session
_chat_buffers: dict[str, list[dict]] = {}
_chat_lock = asyncio.Lock()
_MAX_BUFFER_SESSIONS = 50

# Buffer of pre-generated narrator messages per session
_narrator_buffers: dict[str, list[str]] = {}
_narrator_lock = asyncio.Lock()

VIEWER_NAMES = [
    'viewer_42', 'code_fan99', 'pixel_dev', 'stream_lurker', 'bug_hunter',
    'git_pusher', 'regex_queen', 'null_ptr', 'sudo_user', 'mr_merge',
    'debug_diva', 'pr_approved', 'stack_overflow', 'tab_hoarder', 'vim_exit',
    'semicolon_sam', 'async_anna', 'monorepo_mike', 'lint_error', 'deploy_dan',
]


def _build_context(session_data: dict, n: int = 5) -> str:
    """Build a context string from the last N events of a session.

    Includes file paths, tool names, and richer content so the LLM can
    generate code-specific viewer chat (referencing actual files, languages,
    commands, and patterns).
    """
    events = session_data.get("events", [])[-n:]
    lines = []
    for evt in events:
        kind = evt.get("type", "unknown")
        tool = evt.get("tool_name", "")
        fpath = evt.get("short_path", "") or evt.get("file_path", "")
        content_preview = (evt.get("content", "") or "")[:400]
        summary = evt.get("summary", "")

        # Build a rich single-line description
        parts = [f"[{kind}]"]
        project = evt.get("project", "")
        if project:
            parts.append(f"project={project}")
        if tool:
            parts.append(f"tool={tool}")
        if fpath:
            parts.append(f"file={fpath}")
        if summary:
            parts.append(summary)
        elif content_preview:
            parts.append(content_preview)
        lines.append(" ".join(parts))
    if lines:
        return "\n".join(lines)
    names = ["The coder", "Our code monkey", "The engineer", "Master coder", "The dev"]
    return f"{random.choice(names)} is working on a project."


async def _is_session_active(session_id: str) -> bool:
    """Check if a session is currently active (recently modified)."""
    if session_id == "__master__":
        return True
    file_path = await _resolve_session_path(session_id)
    if not file_path:
        return False
    try:
        mtime = file_path.stat().st_mtime
        return (time.time() - mtime) < 60
    except OSError:
        return False


@app.get("/api/viewer-chat/{session_id:path}")
async def viewer_chat(session_id: str):
    """Return a generated viewer chat message for the session."""

    # Skip LLM for inactive sessions — return empty so client uses fallback
    if not await _is_session_active(session_id):
        return {"name": "", "message": ""}

    # Phase 1: Check buffer under lock
    async with _chat_lock:
        buf = _chat_buffers.get(session_id, [])
        if buf:
            item = buf.pop(0)
            _chat_buffers[session_id] = buf
            return item

    # Phase 2: Generate new messages outside the lock (LLM call is slow)
    llm_error = ""
    buf = []
    count = 5 if llm.LOW_POWER else 10
    try:
        context = None
        if session_id == "__master__":
            master_data = await get_master()
            context = _build_context(master_data, n=10)
        else:
            file_path = await _resolve_session_path(session_id)
            if file_path:
                session = await asyncio.to_thread(parse, file_path)
                context = _build_context(
                    _redact_session(session.to_dict())
                )

        if context:
            messages, llm_error = await llm.generate_viewer_messages(
                context, count=count
            )
            if messages:
                buf = [
                    {
                        "name": random.choice(VIEWER_NAMES),
                        "message": msg,
                    }
                    for msg in messages
                ]
    except Exception:
        logger.exception("Failed to generate viewer chat for session %s", session_id)

    # Phase 3: Store results and pop one item under lock
    if buf:
        async with _chat_lock:
            if len(_chat_buffers) >= _MAX_BUFFER_SESSIONS:
                oldest = next(iter(_chat_buffers))
                del _chat_buffers[oldest]
            _chat_buffers[session_id] = buf
            item = buf.pop(0)
            _chat_buffers[session_id] = buf
            return item

    # Fallback — empty means client should use hardcoded messages
    resp: dict = {"name": "", "message": ""}
    if llm_error:
        resp["llm_error"] = llm_error
    return resp


@app.post("/api/viewer-react")
async def viewer_react(request: Request):
    """Generate 1-2 viewer reactions to a user's chat message."""
    client_ip = request.client.host if request.client else "unknown"
    if not _check_rate_limit(client_ip):
        return JSONResponse({"error": "Rate limit exceeded"}, status_code=429)

    try:
        body = await request.json()
    except Exception:
        return JSONResponse({"error": "Invalid JSON body"}, status_code=400)
    user_message = body.get("message", "").strip()
    if not user_message:
        return {"reactions": []}

    if len(user_message) > MAX_MESSAGE_LENGTH:
        return JSONResponse(
            {"error": f"Message too long (max {MAX_MESSAGE_LENGTH} characters)"},
            status_code=400,
        )

    messages = await llm.generate_viewer_reaction(user_message)
    reactions = [
        {"name": random.choice(VIEWER_NAMES), "message": msg}
        for msg in messages
    ]
    return {"reactions": reactions}


@app.get("/api/narrator/{session_id:path}")
async def narrator_chat(session_id: str):
    """Return a generated narrator commentary message for the session."""
    # Skip LLM for inactive sessions
    if not await _is_session_active(session_id):
        return {"message": ""}

    # Phase 1: Check buffer under lock
    async with _narrator_lock:
        buf = _narrator_buffers.get(session_id, [])
        if buf:
            item = buf.pop(0)
            _narrator_buffers[session_id] = buf
            return {"message": item}

    # Phase 2: Generate new messages outside the lock (LLM call is slow)
    buf = []
    try:
        file_path = await _resolve_session_path(session_id)
        if file_path:
            session = await asyncio.to_thread(parse, file_path)
            context = _build_context(
                _redact_session(session.to_dict()), n=10
            )
            messages = await llm.generate_narrator_messages(context, count=3)
            if messages:
                buf = list(messages)
    except Exception:
        logger.exception("Failed to generate narrator message for session %s", session_id)

    # Phase 3: Store results and pop one item under lock
    if buf:
        async with _narrator_lock:
            if len(_narrator_buffers) >= _MAX_BUFFER_SESSIONS:
                oldest = next(iter(_narrator_buffers))
                del _narrator_buffers[oldest]
            _narrator_buffers[session_id] = buf
            item = buf.pop(0)
            _narrator_buffers[session_id] = buf
            return {"message": item}

    return {"message": ""}


_WS_HEARTBEAT_INTERVAL = 30  # seconds


@app.websocket("/ws/session/{session_id:path}")
async def ws_session(websocket: WebSocket, session_id: str):
    """Live updates for a single session — polls file every 2s, sends deltas."""
    await websocket.accept()

    file_path = await _resolve_session_path(session_id)
    if not file_path:
        await websocket.send_json({"error": "Session not found"})
        await websocket.close()
        return

    # Send initial full state
    session = await asyncio.to_thread(parse, file_path)
    data = _redact_session(session.to_dict())
    await websocket.send_json({"type": "full", "data": data})
    last_count = len(session.events)
    last_hash = _file_hash(file_path)
    last_ping = time.time()

    try:
        while True:
            await asyncio.sleep(2)
            # Heartbeat
            now = time.time()
            if now - last_ping >= _WS_HEARTBEAT_INTERVAL:
                await websocket.send_json({"type": "ping"})
                last_ping = now
            current_hash = _file_hash(file_path)
            if current_hash != last_hash:
                last_hash = current_hash
                session = await asyncio.to_thread(parse, file_path)
                if len(session.events) > last_count:
                    new_events = [_redact_event(e.to_dict()) for e in session.events[last_count:]]
                    agents = {k: v.to_dict() for k, v in session.agents.items()}
                    await websocket.send_json({
                        "type": "delta",
                        "events": new_events,
                        "agents": agents,
                        "total_events": len(session.events),
                    })
                    last_count = len(session.events)
    except WebSocketDisconnect:
        pass
    except Exception:
        logger.exception("WebSocket error for session %s", session_id)


@app.get("/api/master")
async def get_master():
    """Return merged events from all recent sessions for the master channel."""
    summaries = await asyncio.to_thread(scan_sessions, DATA_DIR)
    # Take the most recent session per project (top 20)
    seen_projects: set[str] = set()
    selected: list[dict] = []
    for s in summaries:
        if s.project_name in seen_projects:
            continue
        seen_projects.add(s.project_name)
        selected.append(s.to_dict())
        if len(selected) >= 20:
            break

    # Parse each and merge events with project tags
    all_events = []
    all_agents = {}
    # Need original file_paths before redaction for parsing
    original_paths = {s["project_name"]: s["file_path"] for s in selected}
    selected = [_redact_summary(s) for s in selected]

    for proj, fpath in original_paths.items():
        try:
            session = await asyncio.to_thread(parse, Path(fpath))
            for evt in session.events:
                d = _redact_event(evt.to_dict())
                d["project"] = proj
                all_events.append(d)
            for aid, agent in session.agents.items():
                key = f"{proj}:{aid}"
                ad = agent.to_dict()
                ad["project"] = proj
                ad["id"] = key
                ad["name"] = f"{proj}/{agent.name}"
                all_agents[key] = ad
        except Exception:
            logger.exception("Failed to parse session for project %s", proj)
            continue

    # Sort by timestamp, keep last 2000
    all_events.sort(key=lambda e: e["timestamp"])
    all_events = all_events[-2000:]

    return {
        "events": all_events,
        "agents": all_agents,
        "session_count": len(selected),
        "sessions": selected,
    }


@app.websocket("/ws/master")
async def ws_master(websocket: WebSocket):
    """Live updates for master channel — polls all active sessions every 3s."""
    await websocket.accept()
    last_event_counts: dict[str, int] = {}
    last_ping = time.time()

    try:
        while True:
            now = time.time()
            if now - last_ping >= _WS_HEARTBEAT_INTERVAL:
                await websocket.send_json({"type": "ping"})
                last_ping = now

            summaries = await asyncio.to_thread(scan_sessions, DATA_DIR)
            active = [s for s in summaries if s.is_active]
            new_events = []
            all_agents = {}

            for s in active:
                try:
                    session = await asyncio.to_thread(parse, Path(s.file_path))
                    proj = s.project_name
                    prev_count = last_event_counts.get(s.file_path, 0)

                    if prev_count == 0:
                        start = max(0, len(session.events) - 20)
                    else:
                        start = prev_count

                    for evt in session.events[start:]:
                        d = _redact_event(evt.to_dict())
                        d["project"] = proj
                        new_events.append(d)

                    last_event_counts[s.file_path] = len(session.events)

                    for aid, agent in session.agents.items():
                        key = f"{proj}:{aid}"
                        ad = agent.to_dict()
                        ad["project"] = proj
                        ad["id"] = key
                        ad["name"] = f"{proj}/{agent.name}"
                        all_agents[key] = ad
                except Exception:
                    logger.exception("Failed to parse active session %s", s.file_path)
                    continue

            if new_events:
                new_events.sort(key=lambda e: e["timestamp"])
                await websocket.send_json({
                    "type": "delta",
                    "events": new_events,
                    "agents": all_agents,
                    "active_count": len(active),
                })

            await asyncio.sleep(3)
    except WebSocketDisconnect:
        pass
    except Exception:
        logger.exception("WebSocket error in master channel")


@app.websocket("/ws/dashboard")
async def ws_dashboard(websocket: WebSocket):
    """Live updates for the dashboard — polls session list every 10s."""
    await websocket.accept()
    last_ping = time.time()
    try:
        while True:
            now = time.time()
            if now - last_ping >= _WS_HEARTBEAT_INTERVAL:
                await websocket.send_json({"type": "ping"})
                last_ping = now
            summaries = await asyncio.to_thread(scan_sessions, DATA_DIR)
            await websocket.send_json({
                "type": "sessions",
                "data": [_redact_summary(s.to_dict()) for s in summaries],
            })
            await asyncio.sleep(10)
    except WebSocketDisconnect:
        pass
    except Exception:
        logger.exception("WebSocket error in dashboard")


def _file_hash(path: Path) -> str:
    """Quick hash of file size + mtime for change detection."""
    try:
        stat = path.stat()
        return f"{stat.st_size}:{stat.st_mtime}"
    except OSError:
        return ""


def _build_arg_parser() -> argparse.ArgumentParser:
    """Build the CLI argument parser."""
    parser = argparse.ArgumentParser(
        prog="agentstv",
        description="Launch the agentstv web dashboard.",
    )
    parser.add_argument("--port", type=int, default=8420, help="Port to listen on (default: 8420)")
    parser.add_argument("--host", default="127.0.0.1", help="Host to bind to (default: 127.0.0.1, use 0.0.0.0 for LAN access)")
    parser.add_argument("--no-browser", action="store_true", help="Don't auto-open browser")
    parser.add_argument("--public", action="store_true", help="Redact secrets, API keys, and full paths")
    parser.add_argument("--llm", dest="llm_provider", help="LLM for viewer chat: ollama or openai (env: AGENTSTV_LLM)")
    parser.add_argument("--ollama-url", help="Ollama server URL (default: http://localhost:11434)")
    parser.add_argument("--ollama-model", help="Ollama model name (no default — choose in UI)")
    parser.add_argument("--openai-key", help="OpenAI API key (env: AGENTSTV_OPENAI_KEY)")
    parser.add_argument("--openai-model", help="OpenAI model name (default: gpt-4o-mini)")
    parser.add_argument("--anthropic-key", help="Anthropic API key (env: AGENTSTV_ANTHROPIC_KEY)")
    parser.add_argument("--anthropic-model", help="Anthropic model name (default: claude-haiku-4-5-20241022)")
    parser.add_argument("--low-power", action="store_true", help="Low-power mode: smaller batches, longer intervals")
    return parser


def main(args: list[str] | None = None) -> None:
    """CLI entry point — launch uvicorn and open browser."""
    import uvicorn

    if args is None:
        args = sys.argv[1:]

    global PUBLIC_MODE

    parsed = _build_arg_parser().parse_args(args)

    port = parsed.port
    host = parsed.host
    PUBLIC_MODE = parsed.public

    llm.configure(
        provider=parsed.llm_provider,
        ollama_url=parsed.ollama_url,
        ollama_model=parsed.ollama_model,
        openai_key=parsed.openai_key,
        openai_model=parsed.openai_model,
        anthropic_key=parsed.anthropic_key,
        anthropic_model=parsed.anthropic_model,
        low_power=parsed.low_power or None,
    )

    # Check if port is already in use before starting
    import socket
    sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    try:
        sock.bind((host, port))
    except OSError:
        print(f"agentstv: port {port} is already in use. Kill the existing process or use --port <PORT>.")
        sys.exit(1)
    finally:
        sock.close()

    url = f"http://{host}:{port}"
    browser_url = f"http://localhost:{port}" if host == "0.0.0.0" else url
    mode = " (PUBLIC MODE — secrets redacted)" if PUBLIC_MODE else ""
    print(f"agentstv v{__version__} — starting at {url}{mode}")

    # LLM health check
    if llm.LOW_POWER:
        print("  Low-power mode: ON (reduced batch sizes)")
    if llm.LLM_PROVIDER == "off":
        pass  # user chose off explicitly
    elif not llm.is_ready():
        print("  LLM: no model configured — choose one in the web UI settings")
    elif llm.LLM_PROVIDER == "anthropic":
        print(f"  LLM: {llm.ANTHROPIC_MODEL} via Anthropic (cloud)")
    elif llm.LLM_PROVIDER == "openai":
        print(f"  LLM: {llm.OPENAI_MODEL} via OpenAI (cloud)")
    else:
        try:
            import httpx as _hx
            r = _hx.get(f"{llm.OLLAMA_URL}/api/tags", timeout=3.0)
            models = [m["name"] for m in r.json().get("models", [])]
            if llm.OLLAMA_MODEL in models:
                print(f"  LLM: {llm.OLLAMA_MODEL} via Ollama (ready)")
            else:
                print(f"  LLM: Ollama reachable but model '{llm.OLLAMA_MODEL}' not found (available: {', '.join(models[:5])})")
        except Exception:
            print(f"  LLM: cannot reach Ollama at {llm.OLLAMA_URL} — viewer chat will use fallback messages")

    if not parsed.no_browser:
        # Open browser after a short delay to let server start
        import threading
        threading.Timer(1.0, lambda: webbrowser.open(browser_url)).start()

    uvicorn.run(app, host=host, port=port, log_level="warning")

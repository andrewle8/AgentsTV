"""FastAPI web server for agent-replay."""

from __future__ import annotations

import asyncio
import hashlib
import os
import re
import sys
import webbrowser
from pathlib import Path

import httpx
from fastapi import FastAPI, Request, WebSocket, WebSocketDisconnect
from fastapi.responses import FileResponse, HTMLResponse
from fastapi.staticfiles import StaticFiles

from . import __version__, llm
from .parser import parse
from .scanner import scan_sessions

WEB_DIR = Path(__file__).parent.parent / "web"

# Allow overriding the session log directory via env var
_data_dir_env = os.environ.get("AGENTSTV_DATA_DIR")
DATA_DIR: Path | None = Path(_data_dir_env) if _data_dir_env else None

app = FastAPI(title="agent-replay")

# Public mode — redacts sensitive content before sending to clients
PUBLIC_MODE = False

# Map hashed file paths back to real paths (for public mode routing)
_path_map: dict[str, str] = {}

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
    if llm.LLM_PROVIDER == "off":
        return {"error": "LLM is disabled"}

    body = await request.json()
    user_message = body.get("message", "").strip()
    session_id = body.get("session_id", "")
    reply_to_index = body.get("reply_to_event_index")

    if not user_message:
        return {"error": "Empty message"}

    # Load session for context
    event_content = ""
    event_type = ""
    context = ""
    if session_id:
        try:
            real_path = _path_map.get(session_id, session_id)
            file_path = Path(real_path)
            if not file_path.exists():
                summaries = scan_sessions(DATA_DIR)
                for s in summaries:
                    if s.id == session_id or s.file_path == session_id:
                        file_path = Path(s.file_path)
                        break
            if file_path.exists():
                session = parse(file_path)
                session_data = _redact_session(session.to_dict())
                context = _build_context(session_data, n=8)
                # Extract specific event if replying to one
                events = session_data.get("events", [])
                if reply_to_index is not None and 0 <= reply_to_index < len(events):
                    target = events[reply_to_index]
                    event_content = target.get("content", "")
                    event_type = target.get("type", "")
        except Exception:
            pass

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
    body = await request.json()
    llm.configure(
        provider=body.get("provider"),
        ollama_url=body.get("ollama_url"),
        ollama_model=body.get("ollama_model"),
        openai_key=body.get("openai_key"),
        openai_model=body.get("openai_model"),
    )
    _chat_buffers.clear()
    _narrator_buffers.clear()
    return llm.get_settings()


@app.get("/api/sessions")
async def list_sessions():
    summaries = scan_sessions(DATA_DIR)
    return [_redact_summary(s.to_dict()) for s in summaries]


@app.get("/api/session/{session_id:path}")
async def get_session(session_id: str):
    """Parse and return a full session by file path (base64 or direct)."""
    # Resolve hashed path in public mode
    real_path = _path_map.get(session_id, session_id)
    file_path = Path(real_path)
    if not file_path.exists():
        # Try finding by session ID in known locations
        summaries = scan_sessions(DATA_DIR)
        for s in summaries:
            if s.id == session_id or s.file_path == session_id:
                file_path = Path(s.file_path)
                break
    if not file_path.exists():
        return {"error": "Session not found"}
    session = parse(file_path)
    return _redact_session(session.to_dict())


# Buffer of pre-generated viewer chat messages per session
_chat_buffers: dict[str, list[dict]] = {}
_chat_lock = asyncio.Lock()

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
    import random
    names = ["The coder", "Our code monkey", "The engineer", "Master coder", "The dev"]
    return f"{random.choice(names)} is working on a project."


@app.get("/api/viewer-chat/{session_id:path}")
async def viewer_chat(session_id: str):
    """Return a generated viewer chat message for the session."""
    import random

    async with _chat_lock:
        buf = _chat_buffers.get(session_id, [])

        llm_error = ""

        if not buf:
            # Try to generate a batch from LLM
            try:
                real_path = _path_map.get(session_id, session_id)
                file_path = Path(real_path)
                if not file_path.exists():
                    summaries = scan_sessions(DATA_DIR)
                    for s in summaries:
                        if s.id == session_id or s.file_path == session_id:
                            file_path = Path(s.file_path)
                            break

                if file_path.exists():
                    session = parse(file_path)
                    context = _build_context(_redact_session(session.to_dict()))
                    messages, llm_error = await llm.generate_viewer_messages(
                        context, count=5
                    )
                    if messages:
                        buf = [
                            {
                                "name": random.choice(VIEWER_NAMES),
                                "message": msg,
                            }
                            for msg in messages
                        ]
                        _chat_buffers[session_id] = buf
            except Exception:
                pass

        if buf:
            item = buf.pop(0)
            _chat_buffers[session_id] = buf
            return item

    # Fallback — empty means client should use hardcoded messages
    resp = {"name": "", "message": ""}
    if llm_error:
        resp["llm_error"] = llm_error
    return resp


@app.post("/api/viewer-react")
async def viewer_react(request: Request):
    """Generate 1-2 viewer reactions to a user's chat message."""
    import random

    body = await request.json()
    user_message = body.get("message", "").strip()
    if not user_message:
        return {"reactions": []}

    messages = await llm.generate_viewer_reaction(user_message)
    reactions = [
        {"name": random.choice(VIEWER_NAMES), "message": msg}
        for msg in messages
    ]
    return {"reactions": reactions}


@app.get("/api/narrator/{session_id:path}")
async def narrator_chat(session_id: str):
    """Return a generated narrator commentary message for the session."""
    async with _narrator_lock:
        buf = _narrator_buffers.get(session_id, [])

        if not buf:
            try:
                real_path = _path_map.get(session_id, session_id)
                file_path = Path(real_path)
                if not file_path.exists():
                    summaries = scan_sessions(DATA_DIR)
                    for s in summaries:
                        if s.id == session_id or s.file_path == session_id:
                            file_path = Path(s.file_path)
                            break

                if file_path.exists():
                    session = parse(file_path)
                    context = _build_context(
                        _redact_session(session.to_dict()), n=10
                    )
                    messages = await llm.generate_narrator_messages(context, count=3)
                    if messages:
                        buf = list(messages)
                        _narrator_buffers[session_id] = buf
            except Exception:
                pass

        if buf:
            item = buf.pop(0)
            _narrator_buffers[session_id] = buf
            return {"message": item}

    return {"message": ""}


@app.websocket("/ws/session/{session_id:path}")
async def ws_session(websocket: WebSocket, session_id: str):
    """Live updates for a single session — polls file every 2s, sends deltas."""
    await websocket.accept()

    # Resolve file path (check public mode hash map)
    real_path = _path_map.get(session_id, session_id)
    file_path = Path(real_path)
    if not file_path.exists():
        summaries = scan_sessions(DATA_DIR)
        for s in summaries:
            if s.id == session_id or s.file_path == session_id:
                file_path = Path(s.file_path)
                break
    if not file_path.exists():
        await websocket.send_json({"error": "Session not found"})
        await websocket.close()
        return

    # Send initial full state
    session = parse(file_path)
    data = _redact_session(session.to_dict())
    await websocket.send_json({"type": "full", "data": data})
    last_count = len(session.events)
    last_hash = _file_hash(file_path)

    try:
        while True:
            await asyncio.sleep(2)
            current_hash = _file_hash(file_path)
            if current_hash != last_hash:
                last_hash = current_hash
                session = parse(file_path)
                if len(session.events) > last_count:
                    new_events = [_redact_event(e.to_dict()) for e in session.events[last_count:]]
                    # Also send updated agents (tokens may have changed)
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
        pass


@app.get("/api/master")
async def get_master():
    """Return merged events from all recent sessions for the master channel."""
    summaries = scan_sessions(DATA_DIR)
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
            session = parse(Path(fpath))
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

    try:
        while True:
            summaries = scan_sessions(DATA_DIR)
            active = [s for s in summaries if s.is_active]
            new_events = []
            all_agents = {}

            for s in active:
                try:
                    session = parse(Path(s.file_path))
                    proj = s.project_name
                    prev_count = last_event_counts.get(s.file_path, 0)

                    if prev_count == 0:
                        # First time: send last 20 events
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
        pass


@app.websocket("/ws/dashboard")
async def ws_dashboard(websocket: WebSocket):
    """Live updates for the dashboard — polls session list every 10s."""
    await websocket.accept()
    try:
        while True:
            summaries = scan_sessions(DATA_DIR)
            await websocket.send_json({
                "type": "sessions",
                "data": [_redact_summary(s.to_dict()) for s in summaries],
            })
            await asyncio.sleep(10)
    except WebSocketDisconnect:
        pass
    except Exception:
        pass


def _file_hash(path: Path) -> str:
    """Quick hash of file size + mtime for change detection."""
    try:
        stat = path.stat()
        return f"{stat.st_size}:{stat.st_mtime}"
    except OSError:
        return ""


def main(args: list[str] | None = None) -> None:
    """CLI entry point — launch uvicorn and open browser."""
    import uvicorn

    if args is None:
        args = sys.argv[1:]

    global PUBLIC_MODE

    port = 8420
    host = "0.0.0.0"
    no_browser = False
    llm_provider = None
    ollama_url = None
    ollama_model = None
    openai_key = None
    openai_model = None

    i = 0
    while i < len(args):
        if args[i] == "--port" and i + 1 < len(args):
            port = int(args[i + 1])
            i += 2
        elif args[i] == "--host" and i + 1 < len(args):
            host = args[i + 1]
            i += 2
        elif args[i] == "--no-browser":
            no_browser = True
            i += 1
        elif args[i] == "--public":
            PUBLIC_MODE = True
            i += 1
        elif args[i] == "--llm" and i + 1 < len(args):
            llm_provider = args[i + 1]
            i += 2
        elif args[i] == "--ollama-url" and i + 1 < len(args):
            ollama_url = args[i + 1]
            i += 2
        elif args[i] == "--ollama-model" and i + 1 < len(args):
            ollama_model = args[i + 1]
            i += 2
        elif args[i] == "--openai-key" and i + 1 < len(args):
            openai_key = args[i + 1]
            i += 2
        elif args[i] == "--openai-model" and i + 1 < len(args):
            openai_model = args[i + 1]
            i += 2
        elif args[i] in ("-h", "--help"):
            print("Usage: agent-replay [OPTIONS]")
            print("\nLaunch the agent-replay web dashboard.")
            print("\nOptions:")
            print(f"  --port PORT        Port to listen on (default: {port})")
            print(f"  --host HOST        Host to bind to (default: {host})")
            print("  --no-browser       Don't auto-open browser")
            print("  --public           Redact secrets, API keys, and full paths")
            print("  --llm PROVIDER     LLM for viewer chat: ollama or openai (env: AGENTSTV_LLM)")
            print("  --ollama-url URL   Ollama server URL (default: http://localhost:11434)")
            print("  --ollama-model M   Ollama model name (default: qwen3:14b)")
            print("  --openai-key KEY   OpenAI API key (env: AGENTSTV_OPENAI_KEY)")
            print("  --openai-model M   OpenAI model name (default: gpt-4o-mini)")
            sys.exit(0)
        else:
            i += 1

    llm.configure(
        provider=llm_provider,
        ollama_url=ollama_url,
        ollama_model=ollama_model,
        openai_key=openai_key,
        openai_model=openai_model,
    )

    # Check if port is already in use before starting
    import socket
    sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    try:
        sock.bind((host, port))
    except OSError:
        print(f"agent-replay: port {port} is already in use. Kill the existing process or use --port <PORT>.")
        sys.exit(1)
    finally:
        sock.close()

    url = f"http://{host}:{port}"
    browser_url = f"http://localhost:{port}" if host == "0.0.0.0" else url
    mode = " (PUBLIC MODE — secrets redacted)" if PUBLIC_MODE else ""
    print(f"agent-replay v{__version__} — starting at {url}{mode}")

    # LLM health check
    if llm.LLM_PROVIDER != "off":
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

    if not no_browser:
        # Open browser after a short delay to let server start
        import threading
        threading.Timer(1.0, lambda: webbrowser.open(browser_url)).start()

    uvicorn.run(app, host=host, port=port, log_level="warning")

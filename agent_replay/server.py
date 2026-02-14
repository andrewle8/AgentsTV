"""FastAPI web server for agent-replay."""

from __future__ import annotations

import asyncio
import hashlib
import re
import sys
import webbrowser
from pathlib import Path

from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.responses import FileResponse, HTMLResponse
from fastapi.staticfiles import StaticFiles

from .parser import parse
from .scanner import scan_sessions

WEB_DIR = Path(__file__).parent.parent / "web"

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


@app.get("/", response_class=HTMLResponse)
async def index():
    return FileResponse(WEB_DIR / "index.html")


@app.get("/api/sessions")
async def list_sessions():
    summaries = scan_sessions()
    return [_redact_summary(s.to_dict()) for s in summaries]


@app.get("/api/session/{session_id:path}")
async def get_session(session_id: str):
    """Parse and return a full session by file path (base64 or direct)."""
    # Resolve hashed path in public mode
    real_path = _path_map.get(session_id, session_id)
    file_path = Path(real_path)
    if not file_path.exists():
        # Try finding by session ID in known locations
        summaries = scan_sessions()
        for s in summaries:
            if s.id == session_id or s.file_path == session_id:
                file_path = Path(s.file_path)
                break
    if not file_path.exists():
        return {"error": "Session not found"}
    session = parse(file_path)
    return _redact_session(session.to_dict())


@app.websocket("/ws/session/{session_id:path}")
async def ws_session(websocket: WebSocket, session_id: str):
    """Live updates for a single session — polls file every 2s, sends deltas."""
    await websocket.accept()

    # Resolve file path (check public mode hash map)
    real_path = _path_map.get(session_id, session_id)
    file_path = Path(real_path)
    if not file_path.exists():
        summaries = scan_sessions()
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
    summaries = scan_sessions()
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
            summaries = scan_sessions()
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
            summaries = scan_sessions()
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
    host = "127.0.0.1"
    no_browser = False

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
        elif args[i] in ("-h", "--help"):
            print("Usage: agent-replay [OPTIONS]")
            print("\nLaunch the agent-replay web dashboard.")
            print("\nOptions:")
            print(f"  --port PORT      Port to listen on (default: {port})")
            print(f"  --host HOST      Host to bind to (default: {host})")
            print("  --no-browser     Don't auto-open browser")
            print("  --public         Redact secrets, API keys, and full paths")
            sys.exit(0)
        else:
            i += 1

    url = f"http://{host}:{port}"
    mode = " (PUBLIC MODE — secrets redacted)" if PUBLIC_MODE else ""
    print(f"agent-replay v0.2.0 — starting at {url}{mode}")

    if not no_browser:
        # Open browser after a short delay to let server start
        import threading
        threading.Timer(1.0, lambda: webbrowser.open(url)).start()

    uvicorn.run(app, host=host, port=port, log_level="warning")

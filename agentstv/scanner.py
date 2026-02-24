"""Session discovery — scans multiple agent tool directories for transcripts."""

from __future__ import annotations

import json
import time
from pathlib import Path
from typing import List, Tuple

from .models import SessionSummary

# File modified within this many seconds is considered active
ACTIVE_THRESHOLD = 60

# TTL cache for scan_sessions: (result, timestamp)
_scan_cache: dict[str, Tuple[List[SessionSummary], float]] = {}
_SCAN_TTL = 5.0  # seconds

# Default directories to scan for each agent tool.
# Each tuple is (directory_path, source_label, file_glob_patterns).
_DEFAULT_SOURCES: list[tuple[Path, str, list[str]]] = [
    (Path.home() / ".claude" / "projects", "claude", ["*.jsonl"]),
    (Path.home() / ".codex" / "sessions", "codex", ["*.jsonl"]),
    (Path.home() / ".gemini" / "tmp", "gemini", ["*.json", "*.jsonl"]),
]


def scan_sessions(base_dir: Path | None = None) -> list[SessionSummary]:
    """Find all transcripts and return lightweight summaries.

    When *base_dir* is provided (e.g. via ``AGENTSTV_DATA_DIR``), only that
    single directory is scanned and all sessions are labelled ``"claude"``
    (backwards-compatible behaviour).

    When *base_dir* is ``None`` the scanner checks each of the default agent
    tool directories (Claude Code, Codex CLI, Gemini CLI) if they exist.

    Results are cached with a 5-second TTL to avoid re-globbing on every
    API request and WebSocket poll.
    """
    if base_dir is not None:
        return _scan_single_dir(base_dir, source="claude")

    # Build a stable cache key from the set of default dirs
    cache_key = "__multi__"
    now = time.time()
    cached = _scan_cache.get(cache_key)
    if cached is not None:
        result, cached_at = cached
        if now - cached_at < _SCAN_TTL:
            return result

    summaries: list[SessionSummary] = []
    for dir_path, source, patterns in _DEFAULT_SOURCES:
        if dir_path.is_dir():
            summaries.extend(_scan_single_dir(dir_path, source=source, _skip_cache=True))

    # Sort by recency, active first
    summaries.sort(key=lambda s: (s.is_active, s.last_modified), reverse=True)
    _scan_cache[cache_key] = (summaries, time.time())
    return summaries


def _scan_single_dir(
    base_dir: Path,
    source: str = "claude",
    _skip_cache: bool = False,
) -> list[SessionSummary]:
    """Scan a single directory tree for session files."""
    if not base_dir.is_dir():
        return []

    cache_key = f"{source}:{base_dir}"
    if not _skip_cache:
        now = time.time()
        cached = _scan_cache.get(cache_key)
        if cached is not None:
            result, cached_at = cached
            if now - cached_at < _SCAN_TTL:
                return result

    # Determine which globs to use based on source
    if source == "gemini":
        # Gemini: look for logs.json and session-*.jsonl in hash subdirs
        candidates: list[Path] = []
        for child in base_dir.iterdir():
            if child.is_dir():
                logs_json = child / "logs.json"
                if logs_json.is_file():
                    candidates.append(logs_json)
                for f in child.glob("session-*.jsonl"):
                    candidates.append(f)
        # Also check for top-level JSONL files
        for f in base_dir.glob("*.jsonl"):
            candidates.append(f)
    else:
        candidates = [
            c
            for c in base_dir.rglob("*.jsonl")
            if "subagents" not in str(c)
        ]

    now = time.time()
    summaries: list[SessionSummary] = []

    for path in candidates:
        try:
            summary = _build_summary(path, source, now)
            if summary is not None:
                summaries.append(summary)
        except (OSError, PermissionError):
            continue

    # Sort by recency, active first
    summaries.sort(key=lambda s: (s.is_active, s.last_modified), reverse=True)
    if not _skip_cache:
        _scan_cache[cache_key] = (summaries, time.time())
    return summaries


def _build_summary(
    path: Path, source: str, now: float
) -> SessionSummary | None:
    """Build a SessionSummary from a single session file."""
    stat = path.stat()
    mtime = stat.st_mtime
    is_active = (now - mtime) < ACTIVE_THRESHOLD

    session_id = path.stem
    slug = ""
    branch = ""
    total_in = 0
    total_out = 0
    total_cache = 0
    line_count = 0

    if path.suffix == ".json":
        # Gemini JSON format -- count top-level messages
        try:
            with open(path, encoding="utf-8", errors="ignore") as f:
                data = json.load(f)
            if isinstance(data, dict):
                messages = data.get("messages", data.get("history", []))
                session_id = data.get("sessionId", session_id)
            elif isinstance(data, list):
                messages = data
            else:
                messages = []
            line_count = len(messages)
        except (json.JSONDecodeError, OSError):
            return None
    else:
        # JSONL format (Claude, Codex, Gemini JSONL)
        # Single pass: count lines and extract metadata from first 20 lines
        with open(path, encoding="utf-8", errors="ignore") as f:
            for i, line in enumerate(f):
                line_count += 1

                # Extract metadata from the first 20 lines only
                if i >= 20:
                    continue
                stripped = line.strip()
                if not stripped:
                    continue
                try:
                    rec = json.loads(stripped)
                except json.JSONDecodeError:
                    continue

                # Claude Code metadata
                if source == "claude":
                    if "sessionId" in rec:
                        session_id = rec["sessionId"]
                    if not slug and rec.get("slug"):
                        slug = rec["slug"]
                    if not branch and rec.get("gitBranch"):
                        branch = rec["gitBranch"]
                    if rec.get("type") == "assistant":
                        usage = rec.get("message", {}).get("usage", {})
                        total_in += usage.get("input_tokens", 0)
                        total_out += usage.get("output_tokens", 0)
                        total_cache += usage.get("cache_read_input_tokens", 0)

                # Codex metadata
                elif source == "codex":
                    if rec.get("type") == "session_meta":
                        session_id = rec.get("session_id", session_id)
                    if rec.get("type") == "event_msg":
                        payload = rec.get("payload", rec.get("msg", {}))
                        if isinstance(payload, dict) and payload.get("type") == "token_count":
                            info = payload.get("info", {})
                            usage = info.get("last_token_usage", {})
                            total_in += usage.get("input_tokens", 0)
                            total_out += usage.get("output_tokens", 0)

                # Gemini JSONL metadata
                elif source == "gemini":
                    if rec.get("type") == "session_metadata":
                        session_id = rec.get("sessionId", session_id)
                    if rec.get("type") == "message_update":
                        tokens = rec.get("tokens", {})
                        total_in += tokens.get("input", 0)
                        total_out += tokens.get("output", 0)

    # Check for subagent dirs (Claude only)
    agent_count = 1
    if source == "claude":
        for candidate_dir in [
            path.parent / path.stem / "subagents",
            path.parent / session_id / "subagents",
        ]:
            if candidate_dir.is_dir():
                agent_count += len(list(candidate_dir.glob("agent-*.jsonl")))
                break

    # Project name from directory structure
    project_name = path.parent.name
    if project_name in ("projects", "sessions", "tmp"):
        project_name = path.stem[:20]

    return SessionSummary(
        id=session_id,
        project_name=project_name,
        file_path=str(path),
        event_count=line_count,
        agent_count=agent_count,
        is_active=is_active,
        last_modified=mtime,
        total_input_tokens=total_in,
        total_output_tokens=total_out,
        total_cache_tokens=total_cache,
        slug=slug,
        branch=branch,
        source=source,
    )

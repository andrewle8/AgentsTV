"""Session discovery — scans ~/.claude/projects/ for all transcripts."""

from __future__ import annotations

import json
import time
from pathlib import Path
from typing import List, Optional, Tuple

from .models import SessionSummary

# File modified within this many seconds is considered active
ACTIVE_THRESHOLD = 60

# TTL cache for scan_sessions: (result, timestamp)
_scan_cache: dict[str, Tuple[List[SessionSummary], float]] = {}
_SCAN_TTL = 5.0  # seconds


def scan_sessions(base_dir: Path | None = None) -> list[SessionSummary]:
    """Find all JSONL transcripts and return lightweight summaries.

    Results are cached with a 5-second TTL to avoid re-globbing on every
    API request and WebSocket poll.
    """
    if base_dir is None:
        base_dir = Path.home() / ".claude" / "projects"
    if not base_dir.is_dir():
        return []

    cache_key = str(base_dir)
    now = time.time()
    cached = _scan_cache.get(cache_key)
    if cached is not None:
        result, cached_at = cached
        if now - cached_at < _SCAN_TTL:
            return result

    candidates = [c for c in base_dir.rglob("*.jsonl") if "subagents" not in str(c)]
    now = time.time()
    summaries: list[SessionSummary] = []

    for path in candidates:
        try:
            stat = path.stat()
            mtime = stat.st_mtime
            is_active = (now - mtime) < ACTIVE_THRESHOLD

            # Count lines for event estimate
            line_count = 0
            with open(path, encoding="utf-8", errors="ignore") as f:
                for _ in f:
                    line_count += 1

            # Read first ~20 lines for metadata
            session_id = path.stem
            slug = ""
            branch = ""
            total_in = 0
            total_out = 0
            total_cache = 0
            agent_ids: set[str] = set()

            with open(path, encoding="utf-8", errors="ignore") as f:
                for i, line in enumerate(f):
                    if i >= 20:
                        break
                    line = line.strip()
                    if not line:
                        continue
                    try:
                        rec = json.loads(line)
                    except json.JSONDecodeError:
                        continue
                    if "sessionId" in rec:
                        session_id = rec["sessionId"]
                    if not slug and rec.get("slug"):
                        slug = rec["slug"]
                    if not branch and rec.get("gitBranch"):
                        branch = rec["gitBranch"]
                    # Count tokens from assistant messages
                    if rec.get("type") == "assistant":
                        usage = rec.get("message", {}).get("usage", {})
                        total_in += usage.get("input_tokens", 0)
                        total_out += usage.get("output_tokens", 0)
                        total_cache += usage.get("cache_read_input_tokens", 0)

            # Check for subagent dirs
            agent_count = 1
            for candidate_dir in [
                path.parent / path.stem / "subagents",
                path.parent / session_id / "subagents",
            ]:
                if candidate_dir.is_dir():
                    agent_count += len(list(candidate_dir.glob("agent-*.jsonl")))
                    break

            # Project name from directory structure
            project_name = path.parent.name
            if project_name == "projects":
                project_name = path.stem[:20]

            summaries.append(
                SessionSummary(
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
                )
            )
        except (OSError, PermissionError):
            continue

    # Sort by recency, active first
    summaries.sort(key=lambda s: (s.is_active, s.last_modified), reverse=True)
    _scan_cache[cache_key] = (summaries, time.time())
    return summaries

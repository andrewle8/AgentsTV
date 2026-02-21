"""JSONL parsing for Claude Code, Codex CLI, and Gemini CLI transcripts."""

from __future__ import annotations

import json
from pathlib import Path
from typing import Dict, Tuple

from .models import Agent, Event, EventType, Session

# Parse cache: keyed on (resolved_path, mtime) -> Session
_parse_cache: Dict[Tuple[str, float], Session] = {}
_PARSE_CACHE_MAX = 64

# Agent colors assigned round-robin to sub-agents
AGENT_COLORS = ["magenta", "yellow", "green", "red", "blue", "white"]

# Map tool names to event types
TOOL_TYPE_MAP = {
    "Bash": EventType.BASH,
    "Read": EventType.FILE_READ,
    "Write": EventType.FILE_CREATE,
    "Edit": EventType.FILE_UPDATE,
    "Glob": EventType.TOOL_CALL,
    "Grep": EventType.TOOL_CALL,
    "WebSearch": EventType.WEB_SEARCH,
    "WebFetch": EventType.WEB_SEARCH,
    "Task": EventType.SPAWN,
}


def auto_detect(file_path: str | Path) -> str:
    """Detect transcript format.

    Returns 'claude_code', 'codex', or 'gemini'.
    """
    file_path = Path(file_path)

    # Gemini CLI stores sessions as JSON (not JSONL) in ~/.gemini/
    if file_path.suffix == ".json":
        try:
            with open(file_path, encoding="utf-8") as f:
                data = json.load(f)
            if isinstance(data, dict) and "messages" in data:
                return "gemini"
            if isinstance(data, list) and data and isinstance(data[0], dict):
                first = data[0]
                if first.get("role") in ("user", "model"):
                    return "gemini"
        except (json.JSONDecodeError, OSError):
            pass

    with open(file_path, encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            try:
                rec = json.loads(line)
            except json.JSONDecodeError:
                continue
            # Claude Code transcripts have these type fields
            if rec.get("type") in ("file-history-snapshot",):
                return "claude_code"
            if "sessionId" in rec and rec.get("type") in (
                "user",
                "assistant",
                "progress",
            ):
                return "claude_code"
            # Codex CLI rollout files have these record types
            if rec.get("type") in ("session_meta", "response_item", "event_msg"):
                return "codex"
            # Codex legacy: type=message with role field
            if rec.get("type") == "message" and "role" in rec:
                return "codex"
            # Gemini JSONL format
            if rec.get("type") in ("session_metadata",):
                return "gemini"
            if rec.get("type") in ("user", "gemini") and "content" in rec:
                # Gemini uses type="user"/"gemini"; Claude uses type="user" with sessionId
                if "sessionId" not in rec:
                    return "gemini"
            # Codex turn_context events
            if rec.get("type") == "turn_context":
                return "codex"
    return "codex"


def parse(file_path: str | Path) -> Session:
    """Auto-detect format and parse a transcript file.

    Results are cached by (resolved_path, mtime) so repeated calls for an
    unchanged file skip all I/O and parsing.
    """
    p = Path(file_path).resolve()
    try:
        mtime = p.stat().st_mtime
    except OSError:
        mtime = 0.0
    key = (str(p), mtime)

    cached = _parse_cache.get(key)
    if cached is not None:
        return cached

    fmt = auto_detect(file_path)
    if fmt == "claude_code":
        session = parse_claude_code(file_path)
    elif fmt == "gemini":
        session = parse_gemini(file_path)
    else:
        session = parse_codex(file_path)

    # Evict stale entries for the same path (old mtimes)
    stale_keys = [k for k in _parse_cache if k[0] == str(p) and k[1] != mtime]
    for sk in stale_keys:
        del _parse_cache[sk]
    # Evict oldest entry if cache is still full
    if len(_parse_cache) >= _PARSE_CACHE_MAX:
        oldest = next(iter(_parse_cache))
        del _parse_cache[oldest]
    _parse_cache[key] = session
    return session


def parse_codex(file_path: str | Path) -> Session:
    """Parse a Codex CLI rollout JSONL transcript into a Session.

    Codex CLI writes rollout files to ~/.codex/sessions/YYYY/MM/DD/rollout-*.jsonl.
    Each line has a ``type`` field: ``session_meta``, ``event_msg``, or
    ``response_item``.  Legacy files may use ``type: "message"`` with a ``role``
    field instead.

    Assumptions (best-effort -- format may evolve):
    - ``response_item`` lines contain ``item.type`` of ``"message"`` (with
      ``role`` and ``content``) or ``"function_call"`` (tool invocation).
    - ``event_msg`` lines with ``payload.type == "token_count"`` carry token
      usage in ``payload.info.last_token_usage``.
    - ``session_meta`` provides the session timestamp and model name.
    """
    file_path = Path(file_path)
    session = Session(id=file_path.stem)
    main_agent = Agent(id="main", name="Codex", color="green")
    session.agents["main"] = main_agent

    lines = _read_jsonl(file_path)

    for rec in lines:
        rec_type = rec.get("type", "")
        timestamp = rec.get("timestamp", "")

        # --- session_meta: first line with session-level info ---
        if rec_type == "session_meta":
            session.start_time = timestamp
            session.version = rec.get("model", "")
            continue

        # --- response_item: conversation messages and tool calls ---
        if rec_type == "response_item":
            item = rec.get("item", {})
            item_type = item.get("type", "")
            role = item.get("role", "")

            if item_type == "message":
                content = _extract_codex_content(item.get("content", []))
                if role == "user":
                    session.events.append(
                        Event(
                            timestamp=timestamp,
                            type=EventType.USER,
                            agent_id="main",
                            content=content,
                        )
                    )
                else:
                    session.events.append(
                        Event(
                            timestamp=timestamp,
                            type=EventType.TEXT,
                            agent_id="main",
                            content=content,
                        )
                    )

            elif item_type == "function_call":
                tool_name = item.get("name", "unknown")
                arguments = item.get("arguments", "")
                event_type = EventType.BASH if tool_name == "shell" else EventType.TOOL_CALL
                if tool_name in ("write_file", "create_file"):
                    event_type = EventType.FILE_CREATE
                elif tool_name in ("edit_file", "patch"):
                    event_type = EventType.FILE_UPDATE
                elif tool_name == "read_file":
                    event_type = EventType.FILE_READ
                session.events.append(
                    Event(
                        timestamp=timestamp,
                        type=event_type,
                        agent_id="main",
                        tool_name=tool_name,
                        content=arguments[:500] if arguments else tool_name,
                    )
                )

            elif item_type == "function_call_output":
                output = item.get("output", "")
                session.events.append(
                    Event(
                        timestamp=timestamp,
                        type=EventType.TOOL_RESULT,
                        agent_id="main",
                        content=output[:2000] if output else "",
                    )
                )
            continue

        # --- Legacy format: type=message with role ---
        if rec_type == "message" and "role" in rec:
            role = rec.get("role", "")
            content = _extract_codex_content(rec.get("content", []))
            if role == "user":
                session.events.append(
                    Event(
                        timestamp=timestamp,
                        type=EventType.USER,
                        agent_id="main",
                        content=content,
                    )
                )
            elif role == "assistant":
                session.events.append(
                    Event(
                        timestamp=timestamp,
                        type=EventType.TEXT,
                        agent_id="main",
                        content=content,
                    )
                )
            continue

        # --- event_msg: token counts ---
        if rec_type == "event_msg":
            payload = rec.get("payload", rec.get("msg", {}))
            if isinstance(payload, dict) and payload.get("type") == "token_count":
                info = payload.get("info", {})
                usage = info.get("last_token_usage", {})
                in_tok = usage.get("input_tokens", 0)
                out_tok = usage.get("output_tokens", 0)
                cache_tok = usage.get("cached_input_tokens", 0) or usage.get(
                    "cache_read_input_tokens", 0
                )
                main_agent.input_tokens += in_tok
                main_agent.output_tokens += out_tok
                main_agent.cache_read_tokens += cache_tok
            continue

        # --- turn_context: model info ---
        if rec_type == "turn_context":
            payload = rec.get("payload", {})
            model = payload.get("model", "")
            if model:
                session.version = model
            continue

    # Sort events by timestamp
    session.events.sort(key=lambda e: e.timestamp)

    # Derive start_time from first event if not set via session_meta
    if not session.start_time and session.events:
        session.start_time = session.events[0].timestamp

    # Set agent spawn time
    if session.events:
        main_agent.spawn_time = session.events[0].timestamp

    return session


def _extract_codex_content(content: str | list) -> str:
    """Extract text from a Codex content field (string or content blocks)."""
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        parts = []
        for block in content:
            if isinstance(block, str):
                parts.append(block)
            elif isinstance(block, dict):
                parts.append(block.get("text", block.get("content", "")))
        return "\n".join(p for p in parts if p)
    return str(content) if content else ""


def parse_gemini(file_path: str | Path) -> Session:
    """Parse a Gemini CLI session log into a Session.

    Gemini CLI currently stores sessions as JSON files in
    ``~/.gemini/tmp/<hash>/logs.json`` containing a messages array.  A JSONL
    format (``session-*.jsonl``) is being introduced with ``type`` fields of
    ``session_metadata``, ``user``, ``gemini``, and ``message_update``.

    This parser handles both the legacy JSON format and the newer JSONL format.

    Assumptions:
    - Legacy JSON: ``{"messages": [{"role": "user"|"model", "parts": [...]}]}``
      or a bare list ``[{"role": "user"|"model", "parts": [...]}]``.
    - JSONL: lines with ``type`` of ``user`` / ``gemini`` and a ``content``
      array of ``{text: "..."}`` objects.
    - Tool calls appear as ``functionCall`` parts (legacy) or within content
      blocks (JSONL).
    """
    file_path = Path(file_path)
    session = Session(id=file_path.stem)
    main_agent = Agent(id="main", name="Gemini", color="blue")
    session.agents["main"] = main_agent

    # Try JSON first (legacy format)
    if file_path.suffix == ".json":
        _parse_gemini_json(file_path, session, main_agent)
    else:
        _parse_gemini_jsonl(file_path, session, main_agent)

    # Sort events and set metadata
    session.events.sort(key=lambda e: e.timestamp)
    if session.events:
        if not session.start_time:
            session.start_time = session.events[0].timestamp
        main_agent.spawn_time = session.events[0].timestamp

    return session


def _parse_gemini_json(file_path: Path, session: Session, agent: Agent) -> None:
    """Parse legacy Gemini CLI JSON session file."""
    with open(file_path, encoding="utf-8") as f:
        data = json.load(f)

    messages: list = []
    if isinstance(data, dict):
        messages = data.get("messages", data.get("history", []))
        session.id = data.get("sessionId", session.id)
        session.start_time = data.get("startTime", data.get("createTime", ""))
    elif isinstance(data, list):
        messages = data

    for msg in messages:
        if not isinstance(msg, dict):
            continue
        role = msg.get("role", "")
        parts = msg.get("parts", [])
        timestamp = msg.get("timestamp", msg.get("createTime", ""))

        for part in parts:
            if not isinstance(part, dict):
                continue

            # Text content
            text = part.get("text", "")
            if text.strip():
                event_type = EventType.USER if role == "user" else EventType.TEXT
                session.events.append(
                    Event(
                        timestamp=timestamp,
                        type=event_type,
                        agent_id="main",
                        content=text,
                    )
                )

            # Function calls (tool use)
            fc = part.get("functionCall")
            if fc and isinstance(fc, dict):
                tool_name = fc.get("name", "unknown")
                args = fc.get("args", {})
                event_type = EventType.BASH if tool_name in ("run_shell", "shell") else EventType.TOOL_CALL
                if "edit" in tool_name.lower() or "update" in tool_name.lower():
                    event_type = EventType.FILE_UPDATE
                elif "read" in tool_name.lower():
                    event_type = EventType.FILE_READ
                elif "write" in tool_name.lower() or "create" in tool_name.lower():
                    event_type = EventType.FILE_CREATE
                session.events.append(
                    Event(
                        timestamp=timestamp,
                        type=event_type,
                        agent_id="main",
                        tool_name=tool_name,
                        content=json.dumps(args)[:500] if args else tool_name,
                    )
                )

            # Function response (tool result)
            fr = part.get("functionResponse")
            if fr and isinstance(fr, dict):
                response = fr.get("response", {})
                session.events.append(
                    Event(
                        timestamp=timestamp,
                        type=EventType.TOOL_RESULT,
                        agent_id="main",
                        content=json.dumps(response)[:2000] if response else "",
                    )
                )


def _parse_gemini_jsonl(file_path: Path, session: Session, agent: Agent) -> None:
    """Parse Gemini CLI JSONL session file."""
    lines = _read_jsonl(file_path)

    for rec in lines:
        rec_type = rec.get("type", "")
        timestamp = rec.get("timestamp", "")

        if rec_type == "session_metadata":
            session.id = rec.get("sessionId", session.id)
            session.start_time = rec.get("startTime", timestamp)
            continue

        if rec_type in ("user", "gemini"):
            content_blocks = rec.get("content", [])
            event_type = EventType.USER if rec_type == "user" else EventType.TEXT
            text_parts = []
            for block in content_blocks:
                if isinstance(block, dict):
                    text = block.get("text", "")
                    if text.strip():
                        text_parts.append(text)

                    # Tool calls in content blocks
                    fc = block.get("functionCall")
                    if fc and isinstance(fc, dict):
                        tool_name = fc.get("name", "unknown")
                        args = fc.get("args", {})
                        tc_type = EventType.BASH if tool_name in ("run_shell", "shell") else EventType.TOOL_CALL
                        session.events.append(
                            Event(
                                timestamp=timestamp,
                                type=tc_type,
                                agent_id="main",
                                tool_name=tool_name,
                                content=json.dumps(args)[:500] if args else tool_name,
                            )
                        )

                elif isinstance(block, str) and block.strip():
                    text_parts.append(block)

            if text_parts:
                session.events.append(
                    Event(
                        timestamp=timestamp,
                        type=event_type,
                        agent_id="main",
                        content="\n".join(text_parts),
                    )
                )
            continue

        # Token updates
        if rec_type == "message_update":
            tokens = rec.get("tokens", {})
            agent.input_tokens += tokens.get("input", 0)
            agent.output_tokens += tokens.get("output", 0)
            continue


def parse_claude_code(file_path: str | Path) -> Session:
    """Parse a Claude Code JSONL transcript into a Session."""
    file_path = Path(file_path)
    session = Session(id="unknown")
    main_agent = Agent(id="main", name="Main", color="cyan")
    session.agents["main"] = main_agent
    color_idx = 0

    # Collect main session lines
    lines = _read_jsonl(file_path)

    # Extract session ID from records for subagent lookup
    session_id = file_path.stem
    for rec in lines:
        if "sessionId" in rec:
            session_id = rec["sessionId"]
            break

    # Discover sub-agent files (check both filename stem and session ID dirs)
    subagent_files: list[Path] = []
    for candidate_dir in [
        file_path.parent / file_path.stem / "subagents",
        file_path.parent / session_id / "subagents",
    ]:
        if candidate_dir.is_dir():
            subagent_files = sorted(candidate_dir.glob("agent-*.jsonl"))
            break

    # Parse sub-agent files to register agents and collect their events
    subagent_events: list[tuple[str, list[dict]]] = []
    for sa_file in subagent_files:
        sa_lines = _read_jsonl(sa_file)
        if not sa_lines:
            continue
        agent_id = sa_lines[0].get("agentId", sa_file.stem.replace("agent-", ""))
        short_id = agent_id[:7] if len(agent_id) > 7 else agent_id
        agent = Agent(
            id=agent_id,
            name=short_id,
            is_subagent=True,
            color=AGENT_COLORS[color_idx % len(AGENT_COLORS)],
        )
        color_idx += 1
        session.agents[agent_id] = agent
        subagent_events.append((agent_id, sa_lines))

    # Process main session lines
    _process_lines(lines, "main", session)

    # Process sub-agent lines
    for agent_id, sa_lines in subagent_events:
        _process_lines(sa_lines, agent_id, session)

    # Sort all events by timestamp
    session.events.sort(key=lambda e: e.timestamp)

    # Set session metadata from first meaningful record
    for rec in lines:
        if rec.get("type") in ("user", "assistant") and "sessionId" in rec:
            session.id = rec.get("sessionId", session.id)
            session.slug = rec.get("slug", "")
            session.version = rec.get("version", "")
            session.branch = rec.get("gitBranch", "")
            session.start_time = rec.get("timestamp", "")
            break

    # Set agent spawn times
    for event in session.events:
        agent = session.agents.get(event.agent_id)
        if agent and not agent.spawn_time:
            agent.spawn_time = event.timestamp

    return session


def _read_jsonl(path: Path) -> list[dict]:
    """Read a JSONL file, returning parsed records."""
    records = []
    with open(path, encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            try:
                records.append(json.loads(line))
            except json.JSONDecodeError:
                continue
    return records


def _process_lines(lines: list[dict], agent_id: str, session: Session) -> None:
    """Process JSONL records into events on the session."""
    agent = session.agents.get(agent_id)
    seen_request_ids: set[str] = set()  # Track to avoid double-counting agent tokens
    request_tokens_assigned: set[str] = set()  # Track per-event token attribution

    for rec in lines:
        rec_type = rec.get("type")
        timestamp = rec.get("timestamp", "")

        if rec_type == "user":
            msg = rec.get("message", {})
            content = msg.get("content", "")

            # User text message
            if isinstance(content, str) and content.strip():
                session.events.append(
                    Event(
                        timestamp=timestamp,
                        type=EventType.USER,
                        agent_id=agent_id,
                        content=content,
                    )
                )

            # Tool results inside user messages
            if isinstance(content, list):
                for block in content:
                    if not isinstance(block, dict):
                        continue
                    if block.get("type") == "tool_result":
                        result_text = block.get("content", "")
                        if isinstance(result_text, list):
                            # Extract text from content blocks
                            parts = []
                            for rb in result_text:
                                if isinstance(rb, dict) and rb.get("type") == "text":
                                    parts.append(rb.get("text", ""))
                            result_text = "\n".join(parts)
                        is_error = block.get("is_error", False)
                        session.events.append(
                            Event(
                                timestamp=timestamp,
                                type=EventType.ERROR if is_error else EventType.TOOL_RESULT,
                                agent_id=agent_id,
                                content=str(result_text),
                            )
                        )

        elif rec_type == "assistant":
            msg = rec.get("message", {})
            content_blocks = msg.get("content", [])
            usage = msg.get("usage", {})

            # Track tokens (only once per requestId to avoid double-counting)
            request_id = rec.get("requestId", "")
            in_tok = usage.get("input_tokens", 0)
            out_tok = usage.get("output_tokens", 0)
            cache_tok = usage.get("cache_read_input_tokens", 0)

            # Count agent-level tokens once per request
            if request_id and request_id not in seen_request_ids:
                seen_request_ids.add(request_id)
                if agent:
                    agent.input_tokens += in_tok
                    agent.output_tokens += out_tok
                    agent.cache_read_tokens += cache_tok

            if not isinstance(content_blocks, list):
                continue

            def _event_tokens() -> tuple[int, int, int]:
                """Return tokens for the first event per request, zero after."""
                if request_id and request_id not in request_tokens_assigned:
                    request_tokens_assigned.add(request_id)
                    return in_tok, out_tok, cache_tok
                return 0, 0, 0

            for block in content_blocks:
                if not isinstance(block, dict):
                    continue
                block_type = block.get("type")

                if block_type == "thinking":
                    thinking_text = block.get("thinking", "")
                    if thinking_text.strip():
                        et_in, et_out, et_cache = _event_tokens()
                        session.events.append(
                            Event(
                                timestamp=timestamp,
                                type=EventType.THINK,
                                agent_id=agent_id,
                                content=thinking_text,
                                input_tokens=et_in,
                                output_tokens=et_out,
                                cache_read_tokens=et_cache,
                            )
                        )

                elif block_type == "text":
                    text = block.get("text", "").strip()
                    if text:
                        session.events.append(
                            Event(
                                timestamp=timestamp,
                                type=EventType.TEXT,
                                agent_id=agent_id,
                                content=text,
                            )
                        )

                elif block_type == "tool_use":
                    tool_name = block.get("name", "unknown")
                    tool_input = block.get("input", {})
                    event_type = TOOL_TYPE_MAP.get(tool_name, EventType.TOOL_CALL)

                    file_path = ""
                    description = ""

                    if tool_name in ("Read", "Write", "Edit"):
                        file_path = tool_input.get("file_path", "")
                    elif tool_name == "Bash":
                        description = tool_input.get("description", "") or tool_input.get("command", "")
                    elif tool_name == "Task":
                        description = tool_input.get("description", "")
                        event_type = EventType.SPAWN
                    elif tool_name in ("Glob", "Grep"):
                        description = tool_input.get("pattern", "")
                    elif tool_name == "WebSearch":
                        description = tool_input.get("query", "")
                    elif tool_name == "WebFetch":
                        description = tool_input.get("url", "")
                    else:
                        description = str(tool_input)

                    content = description or file_path
                    et_in, et_out, et_cache = _event_tokens()

                    session.events.append(
                        Event(
                            timestamp=timestamp,
                            type=event_type,
                            agent_id=agent_id,
                            tool_name=tool_name,
                            file_path=file_path,
                            content=content,
                            input_tokens=et_in,
                            output_tokens=et_out,
                            cache_read_tokens=et_cache,
                        )
                    )

"""JSONL parsing for Claude Code (and future Codex CLI) transcripts."""

from __future__ import annotations

import json
import os
from pathlib import Path

from .models import Agent, Event, EventType, Session

# Agent colors assigned round-robin to sub-agents
AGENT_COLORS = ["cyan", "magenta", "yellow", "green", "red", "blue"]

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
    """Detect transcript format. Returns 'claude_code' or 'codex'."""
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
    return "codex"


def parse(file_path: str | Path) -> Session:
    """Auto-detect format and parse a transcript file."""
    fmt = auto_detect(file_path)
    if fmt == "claude_code":
        return parse_claude_code(file_path)
    return parse_codex(file_path)


def parse_codex(file_path: str | Path) -> Session:
    """Stub for Codex CLI transcript parsing."""
    raise NotImplementedError("Codex CLI parsing not yet implemented")


def parse_claude_code(file_path: str | Path) -> Session:
    """Parse a Claude Code JSONL transcript into a Session."""
    file_path = Path(file_path)
    session = Session(id="unknown")
    main_agent = Agent(id="main", name="Main", color="white")
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
                        content=_truncate(content, 200),
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
                                content=_truncate(str(result_text), 200),
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
                                content=_truncate(thinking_text, 200),
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
                                content=_truncate(text, 200),
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
                        description = str(tool_input)[:100]

                    content = description or file_path
                    et_in, et_out, et_cache = _event_tokens()

                    session.events.append(
                        Event(
                            timestamp=timestamp,
                            type=event_type,
                            agent_id=agent_id,
                            tool_name=tool_name,
                            file_path=file_path,
                            content=_truncate(content, 200),
                            input_tokens=et_in,
                            output_tokens=et_out,
                            cache_read_tokens=et_cache,
                        )
                    )


def _truncate(text: str, max_len: int) -> str:
    """Truncate text, collapsing whitespace."""
    text = " ".join(text.split())
    if len(text) > max_len:
        return text[: max_len - 3] + "..."
    return text

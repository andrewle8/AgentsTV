"""Dataclasses for parsed agent session data."""

from __future__ import annotations

from dataclasses import dataclass, field
from enum import Enum
from pathlib import Path


class EventType(str, Enum):
    SPAWN = "spawn"
    THINK = "think"
    TOOL_CALL = "tool_call"
    TOOL_RESULT = "tool_result"
    FILE_CREATE = "file_create"
    FILE_UPDATE = "file_update"
    FILE_READ = "file_read"
    BASH = "bash"
    WEB_SEARCH = "web_search"
    TEXT = "text"
    ERROR = "error"
    COMPLETE = "complete"
    USER = "user"


def _summarize(text: str, max_len: int = 120) -> str:
    """Create a 1-line summary from full content."""
    text = " ".join(text.split())
    if len(text) > max_len:
        return text[: max_len - 1] + "\u2026"
    return text


def _short_path(path: str) -> str:
    """Shorten a file path for display."""
    if not path:
        return ""
    p = Path(path)
    parts = p.parts
    if len(parts) > 3:
        return str(Path("\u2026", *parts[-2:]))
    return str(p.name) if len(parts) <= 1 else str(Path(*parts[-2:]))


@dataclass
class Event:
    timestamp: str
    type: EventType
    agent_id: str
    tool_name: str = ""
    file_path: str = ""
    input_tokens: int = 0
    output_tokens: int = 0
    cache_read_tokens: int = 0
    content: str = ""

    def to_dict(self) -> dict:
        return {
            "timestamp": self.timestamp,
            "type": self.type.value,
            "agent_id": self.agent_id,
            "tool_name": self.tool_name,
            "file_path": self.file_path,
            "short_path": _short_path(self.file_path),
            "input_tokens": self.input_tokens,
            "output_tokens": self.output_tokens,
            "cache_read_tokens": self.cache_read_tokens,
            "content": self.content,
            "summary": _summarize(self.content),
        }


@dataclass
class Agent:
    id: str
    name: str
    is_subagent: bool = False
    color: str = "white"
    spawn_time: str = ""
    input_tokens: int = 0
    output_tokens: int = 0
    cache_read_tokens: int = 0

    def to_dict(self) -> dict:
        return {
            "id": self.id,
            "name": self.name,
            "is_subagent": self.is_subagent,
            "color": self.color,
            "spawn_time": self.spawn_time,
            "input_tokens": self.input_tokens,
            "output_tokens": self.output_tokens,
            "cache_read_tokens": self.cache_read_tokens,
        }


@dataclass
class Session:
    id: str
    slug: str = ""
    version: str = ""
    branch: str = ""
    start_time: str = ""
    agents: dict[str, Agent] = field(default_factory=dict)
    events: list[Event] = field(default_factory=list)

    def to_dict(self) -> dict:
        return {
            "id": self.id,
            "slug": self.slug,
            "version": self.version,
            "branch": self.branch,
            "start_time": self.start_time,
            "agents": {k: v.to_dict() for k, v in self.agents.items()},
            "events": [e.to_dict() for e in self.events],
        }


@dataclass
class SessionSummary:
    id: str
    project_name: str
    file_path: str
    event_count: int
    agent_count: int
    is_active: bool
    last_modified: float
    total_input_tokens: int = 0
    total_output_tokens: int = 0
    total_cache_tokens: int = 0
    slug: str = ""
    branch: str = ""
    source: str = "claude"

    def to_dict(self) -> dict:
        return {
            "id": self.id,
            "project_name": self.project_name,
            "file_path": self.file_path,
            "event_count": self.event_count,
            "agent_count": self.agent_count,
            "is_active": self.is_active,
            "last_modified": self.last_modified,
            "total_input_tokens": self.total_input_tokens,
            "total_output_tokens": self.total_output_tokens,
            "total_cache_tokens": self.total_cache_tokens,
            "slug": self.slug,
            "branch": self.branch,
            "source": self.source,
        }

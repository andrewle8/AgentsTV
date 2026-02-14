"""Dataclasses for parsed agent session data."""

from __future__ import annotations

from dataclasses import dataclass, field
from enum import Enum


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


@dataclass
class Session:
    id: str
    slug: str = ""
    version: str = ""
    branch: str = ""
    start_time: str = ""
    agents: dict[str, Agent] = field(default_factory=dict)
    events: list[Event] = field(default_factory=list)

"""Tests for agentstv.parser — format detection, parsing, and caching."""

import os
import time

from agentstv.models import EventType
from agentstv.parser import _parse_cache, auto_detect, parse


def test_auto_detect_claude_code(sample_claude_jsonl):
    """Claude Code JSONL files are detected as 'claude_code'."""
    assert auto_detect(sample_claude_jsonl) == "claude_code"


def test_auto_detect_codex(sample_codex_jsonl):
    """Codex CLI JSONL files are detected as 'codex'."""
    assert auto_detect(sample_codex_jsonl) == "codex"


def test_auto_detect_gemini(sample_gemini_json):
    """Gemini CLI JSON files are detected as 'gemini'."""
    assert auto_detect(sample_gemini_json) == "gemini"


def test_parse_claude_code_events(sample_claude_jsonl):
    """Parsing a Claude Code JSONL produces expected event types."""
    _parse_cache.clear()
    session = parse(sample_claude_jsonl)
    assert len(session.events) >= 2
    types = {e.type for e in session.events}
    assert EventType.USER in types
    # The assistant records should produce TEXT and/or BASH events
    assert types & {EventType.TEXT, EventType.BASH}


def test_parse_codex_events(sample_codex_jsonl):
    """Parsing a Codex CLI JSONL produces at least one event."""
    _parse_cache.clear()
    session = parse(sample_codex_jsonl)
    assert len(session.events) > 0


def test_parse_gemini_events(sample_gemini_json):
    """Parsing a Gemini CLI JSON produces at least one event."""
    _parse_cache.clear()
    session = parse(sample_gemini_json)
    assert len(session.events) > 0


def test_malformed_jsonl_handled(malformed_jsonl):
    """Malformed JSONL lines are skipped without crashing."""
    _parse_cache.clear()
    session = parse(malformed_jsonl)
    # Should return a session (possibly with 0 events), not raise
    assert session is not None


def test_parse_cache_hit(sample_claude_jsonl):
    """Calling parse() twice on an unchanged file returns the same object."""
    _parse_cache.clear()
    session1 = parse(sample_claude_jsonl)
    session2 = parse(sample_claude_jsonl)
    assert session1 is session2


def test_parse_cache_invalidation(sample_claude_jsonl):
    """Modifying the file mtime causes the cache to return a new object."""
    _parse_cache.clear()
    session1 = parse(sample_claude_jsonl)

    # Bump the file mtime forward
    stat = os.stat(sample_claude_jsonl)
    new_time = stat.st_mtime + 10
    os.utime(sample_claude_jsonl, (new_time, new_time))

    session2 = parse(sample_claude_jsonl)
    assert session2 is not session1


def test_large_file_truncation(large_jsonl):
    """A 60k-line JSONL file parses without crashing."""
    _parse_cache.clear()
    session = parse(large_jsonl)
    # Just verify it completes and returns a session
    assert session is not None
    assert session.id is not None

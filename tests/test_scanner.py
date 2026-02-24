"""Tests for agentstv.scanner — session discovery and caching."""

import json
import shutil
import time
from pathlib import Path

from agentstv.scanner import _scan_cache, scan_sessions


def test_scan_empty_dir(tmp_dir):
    """Scanning an empty directory returns an empty list."""
    _scan_cache.clear()
    result = scan_sessions(tmp_dir)
    assert result == []


def test_scan_finds_session(tmp_dir, sample_claude_jsonl):
    """Scanner discovers a JSONL session file in a subdirectory."""
    _scan_cache.clear()
    # Create a project subdirectory structure matching Claude Code layout
    project_dir = tmp_dir / "my-project"
    project_dir.mkdir()
    dest = project_dir / sample_claude_jsonl.name
    shutil.copy2(sample_claude_jsonl, dest)

    summaries = scan_sessions(tmp_dir)
    assert len(summaries) >= 1
    paths = [s.file_path for s in summaries]
    assert any(str(dest) in p for p in paths)


def test_scan_caching(tmp_dir, sample_claude_jsonl):
    """Calling scan_sessions twice within TTL returns the same list object."""
    _scan_cache.clear()
    project_dir = tmp_dir / "cache-test"
    project_dir.mkdir()
    shutil.copy2(sample_claude_jsonl, project_dir / sample_claude_jsonl.name)

    result1 = scan_sessions(tmp_dir)
    result2 = scan_sessions(tmp_dir)
    assert result1 is result2


def test_session_summary_fields(tmp_dir, sample_claude_jsonl):
    """Session summaries have the expected fields populated."""
    _scan_cache.clear()
    project_dir = tmp_dir / "field-test"
    project_dir.mkdir()
    shutil.copy2(sample_claude_jsonl, project_dir / sample_claude_jsonl.name)

    summaries = scan_sessions(tmp_dir)
    assert len(summaries) >= 1
    s = summaries[0]
    assert s.id  # non-empty session id
    assert s.project_name  # non-empty project name
    assert s.event_count > 0  # line count from file
    assert s.file_path  # non-empty file path


def test_active_detection(tmp_dir, sample_claude_jsonl):
    """A freshly created file should be detected as active."""
    _scan_cache.clear()
    project_dir = tmp_dir / "active-test"
    project_dir.mkdir()
    dest = project_dir / sample_claude_jsonl.name
    shutil.copy2(sample_claude_jsonl, dest)
    # Touch the file to ensure mtime is recent
    dest.touch()

    summaries = scan_sessions(tmp_dir)
    assert len(summaries) >= 1
    assert summaries[0].is_active is True

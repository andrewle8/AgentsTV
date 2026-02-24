"""Tests for agentstv.llm — configuration, readiness, and response parsing."""

import pytest

from agentstv import llm
from agentstv.llm import _parse_response, configure, get_settings, is_ready


@pytest.fixture(autouse=True)
def _save_restore_llm_state():
    """Save and restore LLM module globals to prevent test pollution."""
    saved = {
        "LLM_PROVIDER": llm.LLM_PROVIDER,
        "OLLAMA_URL": llm.OLLAMA_URL,
        "OLLAMA_MODEL": llm.OLLAMA_MODEL,
        "OPENAI_KEY": llm.OPENAI_KEY,
        "OPENAI_MODEL": llm.OPENAI_MODEL,
        "ANTHROPIC_KEY": llm.ANTHROPIC_KEY,
        "ANTHROPIC_MODEL": llm.ANTHROPIC_MODEL,
        "LOW_POWER": llm.LOW_POWER,
    }
    yield
    for attr, val in saved.items():
        setattr(llm, attr, val)


def test_configure_sets_provider():
    """configure(provider=...) updates LLM_PROVIDER."""
    configure(provider="openai")
    assert llm.LLM_PROVIDER == "openai"


def test_configure_sets_model():
    """configure(ollama_model=...) updates OLLAMA_MODEL."""
    configure(ollama_model="test-model")
    assert llm.OLLAMA_MODEL == "test-model"


def test_is_ready_off():
    """Provider 'off' means is_ready() returns False."""
    configure(provider="off")
    assert is_ready() is False


def test_is_ready_ollama_no_model():
    """Ollama provider with empty model is not ready."""
    configure(provider="ollama", ollama_model="")
    assert is_ready() is False


def test_is_ready_ollama_with_model():
    """Ollama provider with a model name is ready."""
    configure(provider="ollama", ollama_model="test")
    assert is_ready() is True


def test_key_masking():
    """Long API keys are masked in get_settings() output."""
    configure(provider="openai", openai_key="sk-abcdef1234567890xyz")
    settings = get_settings()
    masked = settings["openai_key"]
    # Starts with first 3 chars, ends with last 4
    assert masked.startswith("sk-")
    assert masked.endswith("0xyz")
    # Full key should NOT appear
    assert "abcdef1234567890" not in masked


def test_parse_response_json_array():
    """A JSON array string is parsed into a list of strings."""
    result = _parse_response('["a","b","c"]', 5)
    assert result == ["a", "b", "c"]


def test_parse_response_json_object():
    """A JSON object with a 'messages' key extracts the list."""
    result = _parse_response('{"messages":["a","b"]}', 5)
    assert result == ["a", "b"]


def test_parse_response_fallback_lines():
    """Numbered lines are parsed as fallback when JSON fails."""
    result = _parse_response("1. hello\n2. world", 5)
    assert result == ["hello", "world"]


@pytest.mark.asyncio
async def test_shutdown_clients():
    """After shutdown_clients(), HTTP clients should be closed."""
    # Initialize clients by accessing them
    llm._get_ollama_client()
    llm._get_openai_client()
    llm._get_anthropic_client()
    await llm.shutdown_clients()
    assert llm._ollama_client is None or llm._ollama_client.is_closed
    assert llm._openai_client is None or llm._openai_client.is_closed
    assert llm._anthropic_client is None or llm._anthropic_client.is_closed

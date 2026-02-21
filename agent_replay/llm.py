"""LLM provider abstraction for generating viewer chat messages."""

from __future__ import annotations

import json
import logging
import os
import random

import httpx

log = logging.getLogger(__name__)

# Persistent HTTP clients — lazily initialized, reused across calls
_ollama_client: httpx.AsyncClient | None = None
_openai_client: httpx.AsyncClient | None = None
_anthropic_client: httpx.AsyncClient | None = None


def _get_ollama_client() -> httpx.AsyncClient:
    global _ollama_client
    if _ollama_client is None or _ollama_client.is_closed:
        _ollama_client = httpx.AsyncClient(timeout=60.0)
    return _ollama_client


def _get_openai_client() -> httpx.AsyncClient:
    global _openai_client
    if _openai_client is None or _openai_client.is_closed:
        _openai_client = httpx.AsyncClient(timeout=30.0)
    return _openai_client


def _get_anthropic_client() -> httpx.AsyncClient:
    global _anthropic_client
    if _anthropic_client is None or _anthropic_client.is_closed:
        _anthropic_client = httpx.AsyncClient(timeout=30.0)
    return _anthropic_client

# Appended to Ollama user prompts to disable internal reasoning (Qwen3, Cogito).
# Kept off for generate_interactive_reply where thinking improves quality.
_NO_THINK = " /no_think"

STREAMER_NAMES = [
    "the coder", "our code monkey", "the engineer",
    "master coder", "the dev", "chief architect",
]


def _random_streamer() -> str:
    return random.choice(STREAMER_NAMES)


def _system_prompt() -> str:
    name = _random_streamer()
    return (
        "You are a Twitch chat viewer watching a live AI coding stream. "
        f"Generate short chat messages (under 20 words each) reacting to what {name} just did. "
        "Be casual, use slang, emojis optional. You are a developer yourself. "
        "Mix these tones:\n"
        "- Reference SPECIFIC files, functions, or commands from the context "
        "(e.g. \"server.py is getting thicc\", \"that grep tho\")\n"
        "- Give backseat coding suggestions tied to what's actually happening "
        "(e.g. \"add a try-catch around that fetch\", \"extract that into a helper\")\n"
        "- Comment on code quality, patterns, or architecture choices "
        "(e.g. \"nice separation of concerns\", \"watch the cyclomatic complexity\")\n"
        "- React to errors, edits, or bash commands specifically\n"
        "- Short hype reactions (max 2 of these)\n"
        "IMPORTANT: At least 7 of your messages MUST reference specific files, "
        "tools, code patterns, or commands from the context. Generic messages "
        "like \"nice\" or \"W\" are okay for at most 2 of the messages.\n"
        "Return a JSON array of strings, nothing else."
    )

SYSTEM_PROMPT_EXPLAIN = (
    "You are a brief coding stream commentator. When asked about an AI agent's actions, "
    "explain what it DID in 1-2 short sentences. Focus on the actual code, file, or "
    "command — not the agent's thought process. Never describe yourself. If no specific "
    "event context is provided, say what the agent has been working on recently."
)

SYSTEM_PROMPT_NARRATOR = (
    "You are an enthusiastic esports-style commentator narrating a live AI coding stream. "
    "Give play-by-play commentary on what just happened. Be dramatic but brief (1-2 sentences). "
    "Use present tense. Reference specific files, tools, or actions. "
    "Return a JSON array of 3 strings, nothing else."
)

SYSTEM_PROMPT_REACT = (
    "You are a Twitch chat viewer. Another chatter just said something. "
    "Generate 1-2 very short casual reactions (under 10 words each). "
    "Be natural — agree, disagree, meme, or riff on what they said. "
    "Return a JSON array of strings, nothing else."
)

# Provider config — set via env vars or CLI flags
LLM_PROVIDER: str = os.environ.get("AGENTSTV_LLM", "ollama")
OLLAMA_URL: str = os.environ.get("AGENTSTV_OLLAMA_URL", "http://localhost:11434")
OLLAMA_MODEL: str = os.environ.get("AGENTSTV_OLLAMA_MODEL", "")
OPENAI_KEY: str = os.environ.get("AGENTSTV_OPENAI_KEY", "")
OPENAI_MODEL: str = os.environ.get("AGENTSTV_OPENAI_MODEL", "gpt-4o-mini")
ANTHROPIC_KEY: str = os.environ.get("AGENTSTV_ANTHROPIC_KEY", "")
ANTHROPIC_MODEL: str = os.environ.get("AGENTSTV_ANTHROPIC_MODEL", "claude-haiku-4-5-20241022")

# Low-power mode — reduces batch sizes and adds delays between calls
LOW_POWER: bool = os.environ.get("AGENTSTV_LOW_POWER", "").lower() in ("1", "true", "yes")


def configure(
    provider: str | None = None,
    ollama_url: str | None = None,
    ollama_model: str | None = None,
    openai_key: str | None = None,
    openai_model: str | None = None,
    anthropic_key: str | None = None,
    anthropic_model: str | None = None,
    low_power: bool | None = None,
) -> None:
    """Override LLM settings (called from CLI arg parsing)."""
    global LLM_PROVIDER, OLLAMA_URL, OLLAMA_MODEL, OPENAI_KEY, OPENAI_MODEL
    global ANTHROPIC_KEY, ANTHROPIC_MODEL, LOW_POWER
    if provider is not None:
        LLM_PROVIDER = provider
    if ollama_url is not None:
        OLLAMA_URL = ollama_url
    if ollama_model is not None:
        OLLAMA_MODEL = ollama_model
    if openai_key is not None:
        OPENAI_KEY = openai_key
    if openai_model is not None:
        OPENAI_MODEL = openai_model
    if anthropic_key is not None:
        ANTHROPIC_KEY = anthropic_key
    if anthropic_model is not None:
        ANTHROPIC_MODEL = anthropic_model
    if low_power is not None:
        LOW_POWER = low_power


def is_ready() -> bool:
    """Return True if the LLM is configured and usable."""
    if LLM_PROVIDER == "off":
        return False
    if LLM_PROVIDER == "openai":
        return bool(OPENAI_KEY and OPENAI_MODEL)
    if LLM_PROVIDER == "anthropic":
        return bool(ANTHROPIC_KEY and ANTHROPIC_MODEL)
    return bool(OLLAMA_MODEL)


def get_settings() -> dict:
    """Return current LLM configuration (API keys are masked)."""
    masked_openai = ""
    if OPENAI_KEY:
        masked_openai = OPENAI_KEY[:3] + "…" + OPENAI_KEY[-4:] if len(OPENAI_KEY) > 8 else "••••"
    masked_anthropic = ""
    if ANTHROPIC_KEY:
        masked_anthropic = ANTHROPIC_KEY[:3] + "…" + ANTHROPIC_KEY[-4:] if len(ANTHROPIC_KEY) > 8 else "••••"
    return {
        "provider": LLM_PROVIDER,
        "ollama_url": OLLAMA_URL,
        "ollama_model": OLLAMA_MODEL,
        "openai_key": masked_openai,
        "openai_model": OPENAI_MODEL,
        "anthropic_key": masked_anthropic,
        "anthropic_model": ANTHROPIC_MODEL,
        "low_power": LOW_POWER,
    }


async def generate_viewer_messages(
    context: str, count: int = 5
) -> tuple[list[str], str]:
    """Generate viewer chat messages using the configured LLM provider.

    Returns (messages, error_string).  error_string is empty on success.
    """
    if not is_ready():
        return [], ""

    if LOW_POWER:
        count = min(count, 3)

    name = _random_streamer()
    user_prompt = (
        f"Here are the last few things {name} did:\n{context}\n\n"
        f"Generate {count} different short viewer chat messages reacting to this."
    )
    system = _system_prompt()

    try:
        return await _dispatch(user_prompt, system, count=count), ""
    except Exception as exc:
        err = str(exc) or type(exc).__name__
        log.warning("LLM viewer-chat call failed: %s", err)
        return [], err


async def generate_interactive_reply(
    user_message: str,
    event_content: str,
    event_type: str,
    context: str,
) -> str:
    """Generate a reply to a user question about agent activity.

    Returns a string reply, or empty string on failure / LLM off.
    """
    if not is_ready():
        return ""

    user_prompt = (
        f"The user is watching an AI coding agent and asked:\n\"{user_message}\"\n\n"
    )
    if event_content:
        user_prompt += f"They're asking about this specific event ({event_type}):\n{event_content[:2000]}\n\n"
    if context:
        user_prompt += f"Recent agent activity for context:\n{context}\n"

    try:
        return await _dispatch(user_prompt, SYSTEM_PROMPT_EXPLAIN, raw=True)
    except Exception as exc:
        log.warning("Interactive LLM call failed: %s", str(exc) or type(exc).__name__)
        return ""


async def generate_narrator_messages(context: str, count: int = 3) -> list[str]:
    """Generate narrator play-by-play messages using the configured LLM provider.

    Returns a list of strings, or an empty list on failure.
    """
    if not is_ready():
        return []

    if LOW_POWER:
        count = min(count, 1)

    name = _random_streamer()
    user_prompt = (
        f"Here is what {name} just did:\n{context}\n\n"
        f"Generate {count} dramatic play-by-play commentary lines about this."
    )

    try:
        return await _dispatch(user_prompt, SYSTEM_PROMPT_NARRATOR, count=count)
    except Exception as exc:
        log.warning("Narrator LLM call failed: %s", str(exc) or type(exc).__name__)
        return []


async def generate_viewer_reaction(user_message: str) -> list[str]:
    """Generate 1-2 viewer reactions to a user's chat message.

    Returns a list of strings, or an empty list on failure.
    """
    if not is_ready():
        return []

    user_prompt = (
        f"A chatter said: \"{user_message}\"\n\n"
        "Generate 1-2 casual viewer reactions."
    )

    try:
        return await _dispatch(user_prompt, SYSTEM_PROMPT_REACT, count=2)
    except Exception as exc:
        log.warning("Viewer reaction LLM call failed: %s", str(exc) or type(exc).__name__)
        return []


async def _dispatch(
    user_prompt: str,
    system_prompt: str = "",
    *,
    count: int = 5,
    raw: bool = False,
) -> list[str] | str:
    """Route to the configured LLM provider."""
    if LLM_PROVIDER == "anthropic":
        return await _call_anthropic(user_prompt, system_prompt, count=count, raw=raw)
    if LLM_PROVIDER == "openai":
        return await _call_openai(user_prompt, system_prompt, count=count, raw=raw)
    # Default: ollama — append /no_think unless raw (interactive reply benefits from thinking)
    prompt = user_prompt if raw else user_prompt + _NO_THINK
    return await _call_ollama(prompt, system_prompt, count=count, raw=raw)


async def _call_anthropic(
    user_prompt: str,
    system_prompt: str = "",
    *,
    count: int = 5,
    raw: bool = False,
) -> list[str] | str:
    url = "https://api.anthropic.com/v1/messages"
    headers = {
        "x-api-key": ANTHROPIC_KEY,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
    }
    payload = {
        "model": ANTHROPIC_MODEL,
        "max_tokens": 500 if raw else 300,
        "system": system_prompt,
        "messages": [
            {"role": "user", "content": user_prompt},
        ],
    }
    client = _get_anthropic_client()
    resp = await client.post(url, json=payload, headers=headers)
    resp.raise_for_status()
    body = resp.json()
    text = body["content"][0]["text"]
    if raw:
        return text.strip()
    return _parse_response(text, count)


async def _call_ollama(
    user_prompt: str,
    system_prompt: str = "",
    *,
    count: int = 5,
    raw: bool = False,
) -> list[str] | str:
    url = f"{OLLAMA_URL}/api/chat"
    payload = {
        "model": OLLAMA_MODEL,
        "messages": [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_prompt},
        ],
        "stream": False,
    }
    if not raw:
        payload["format"] = "json"
    client = _get_ollama_client()
    resp = await client.post(url, json=payload)
    resp.raise_for_status()
    body = resp.json()
    text = body["message"]["content"]
    if raw:
        return text.strip()
    return _parse_response(text, count)


async def _call_openai(
    user_prompt: str,
    system_prompt: str = "",
    *,
    count: int = 5,
    raw: bool = False,
) -> list[str] | str:
    url = "https://api.openai.com/v1/chat/completions"
    headers = {"Authorization": f"Bearer {OPENAI_KEY}"}
    payload = {
        "model": OPENAI_MODEL,
        "messages": [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_prompt},
        ],
        "temperature": 1.0,
        "max_tokens": 300 if not raw else 500,
    }
    client = _get_openai_client()
    resp = await client.post(url, json=payload, headers=headers)
    resp.raise_for_status()
    body = resp.json()
    text = body["choices"][0]["message"]["content"]
    if raw:
        return text.strip()
    return _parse_response(text, count)


def _parse_response(text: str, count: int) -> list[str]:
    """Parse LLM response into a list of message strings."""
    text = text.strip()
    try:
        data = json.loads(text)
        # Handle {"messages": [...]} or just [...]
        if isinstance(data, dict):
            for key in ("messages", "chat", "responses", "items"):
                if key in data and isinstance(data[key], list):
                    data = data[key]
                    break
            else:
                # Take first list value found
                for v in data.values():
                    if isinstance(v, list):
                        data = v
                        break
                else:
                    # Dict with only string values — extract them
                    strings = [str(v) for v in data.values() if v and isinstance(v, str)]
                    if strings:
                        return strings[:count]
        if isinstance(data, list):
            return [str(m) for m in data if m][:count]
    except json.JSONDecodeError:
        pass
    # Fallback: split by newlines, strip numbering
    lines = [ln.strip().lstrip("0123456789.-) ").strip('"\'') for ln in text.splitlines()]
    return [ln for ln in lines if ln and len(ln) < 100][:count]

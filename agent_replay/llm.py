"""LLM provider abstraction for generating viewer chat messages."""

from __future__ import annotations

import json
import logging
import os

import httpx

log = logging.getLogger(__name__)

SYSTEM_PROMPT = (
    "You are a Twitch chat viewer watching an AI coding stream. "
    "Generate short chat messages (under 15 words each) reacting to what the coder just did. "
    "Be casual, use slang, emojis optional. Vary the tone: hype, jokes, backseat coding, questions. "
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

# Provider config — set via env vars or CLI flags
LLM_PROVIDER: str = os.environ.get("AGENTSTV_LLM", "ollama")
OLLAMA_URL: str = os.environ.get("AGENTSTV_OLLAMA_URL", "http://localhost:11434")
OLLAMA_MODEL: str = os.environ.get("AGENTSTV_OLLAMA_MODEL", "qwen3:14b")
OPENAI_KEY: str = os.environ.get("AGENTSTV_OPENAI_KEY", "")
OPENAI_MODEL: str = os.environ.get("AGENTSTV_OPENAI_MODEL", "gpt-4o-mini")


def configure(
    provider: str | None = None,
    ollama_url: str | None = None,
    ollama_model: str | None = None,
    openai_key: str | None = None,
    openai_model: str | None = None,
) -> None:
    """Override LLM settings (called from CLI arg parsing)."""
    global LLM_PROVIDER, OLLAMA_URL, OLLAMA_MODEL, OPENAI_KEY, OPENAI_MODEL
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


def get_settings() -> dict:
    """Return current LLM configuration (OpenAI key is masked)."""
    masked_key = ""
    if OPENAI_KEY:
        masked_key = OPENAI_KEY[:3] + "…" + OPENAI_KEY[-4:] if len(OPENAI_KEY) > 8 else "••••"
    return {
        "provider": LLM_PROVIDER,
        "ollama_url": OLLAMA_URL,
        "ollama_model": OLLAMA_MODEL,
        "openai_key": masked_key,
        "openai_model": OPENAI_MODEL,
    }


async def generate_viewer_messages(context: str, count: int = 5) -> list[str]:
    """Generate viewer chat messages using the configured LLM provider.

    Returns a list of strings, or an empty list on failure.
    """
    if LLM_PROVIDER == "off":
        return []

    user_prompt = (
        f"Here are the last few things the AI coder did:\n{context}\n\n"
        f"Generate {count} different short viewer chat messages reacting to this."
    )

    try:
        if LLM_PROVIDER == "openai":
            return await _call_openai(user_prompt, SYSTEM_PROMPT, count=count)
        else:
            return await _call_ollama(user_prompt, SYSTEM_PROMPT, count=count)
    except Exception:
        log.debug("LLM call failed", exc_info=True)
        return []


async def generate_interactive_reply(
    user_message: str,
    event_content: str,
    event_type: str,
    context: str,
) -> str:
    """Generate a reply to a user question about agent activity.

    Returns a string reply, or empty string on failure / LLM off.
    """
    if LLM_PROVIDER == "off":
        return ""

    user_prompt = (
        f"The user is watching an AI coding agent and asked:\n\"{user_message}\"\n\n"
    )
    if event_content:
        user_prompt += f"They're asking about this specific event ({event_type}):\n{event_content[:2000]}\n\n"
    if context:
        user_prompt += f"Recent agent activity for context:\n{context}\n"

    try:
        if LLM_PROVIDER == "openai":
            return await _call_openai(user_prompt, SYSTEM_PROMPT_EXPLAIN, raw=True)
        else:
            return await _call_ollama(user_prompt, SYSTEM_PROMPT_EXPLAIN, raw=True)
    except Exception:
        log.debug("Interactive LLM call failed", exc_info=True)
        return ""


async def generate_narrator_messages(context: str, count: int = 3) -> list[str]:
    """Generate narrator play-by-play messages using the configured LLM provider.

    Returns a list of strings, or an empty list on failure.
    """
    if LLM_PROVIDER == "off":
        return []

    user_prompt = (
        f"Here is what the AI coder just did:\n{context}\n\n"
        f"Generate {count} dramatic play-by-play commentary lines about this."
    )

    try:
        if LLM_PROVIDER == "openai":
            return await _call_openai(user_prompt, SYSTEM_PROMPT_NARRATOR, count=count)
        else:
            return await _call_ollama(user_prompt, SYSTEM_PROMPT_NARRATOR, count=count)
    except Exception:
        log.debug("Narrator LLM call failed", exc_info=True)
        return []


async def _call_ollama(
    user_prompt: str,
    system_prompt: str = SYSTEM_PROMPT,
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
    async with httpx.AsyncClient(timeout=30.0) as client:
        resp = await client.post(url, json=payload)
        resp.raise_for_status()
        body = resp.json()
    text = body["message"]["content"]
    if raw:
        return text.strip()
    return _parse_response(text, count)


async def _call_openai(
    user_prompt: str,
    system_prompt: str = SYSTEM_PROMPT,
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
    async with httpx.AsyncClient(timeout=30.0) as client:
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
        if isinstance(data, list):
            return [str(m) for m in data if m][:count]
    except json.JSONDecodeError:
        pass
    # Fallback: split by newlines, strip numbering
    lines = [ln.strip().lstrip("0123456789.-) ").strip('"\'') for ln in text.splitlines()]
    return [ln for ln in lines if ln and len(ln) < 100][:count]

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

# Provider config — set via env vars or CLI flags
LLM_PROVIDER: str = os.environ.get("AGENTSTV_LLM", "ollama")
OLLAMA_URL: str = os.environ.get("AGENTSTV_OLLAMA_URL", "http://localhost:11434")
OLLAMA_MODEL: str = os.environ.get("AGENTSTV_OLLAMA_MODEL", "mistral-small3.2")
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
    user_prompt = (
        f"Here are the last few things the AI coder did:\n{context}\n\n"
        f"Generate {count} different short viewer chat messages reacting to this."
    )

    try:
        if LLM_PROVIDER == "openai":
            return await _call_openai(user_prompt, count)
        else:
            return await _call_ollama(user_prompt, count)
    except Exception:
        log.debug("LLM call failed", exc_info=True)
        return []


async def _call_ollama(user_prompt: str, count: int) -> list[str]:
    url = f"{OLLAMA_URL}/api/chat"
    payload = {
        "model": OLLAMA_MODEL,
        "messages": [
            {"role": "system", "content": SYSTEM_PROMPT},
            {"role": "user", "content": user_prompt},
        ],
        "format": "json",
        "stream": False,
    }
    async with httpx.AsyncClient(timeout=30.0) as client:
        resp = await client.post(url, json=payload)
        resp.raise_for_status()
        body = resp.json()
    return _parse_response(body["message"]["content"], count)


async def _call_openai(user_prompt: str, count: int) -> list[str]:
    url = "https://api.openai.com/v1/chat/completions"
    headers = {"Authorization": f"Bearer {OPENAI_KEY}"}
    payload = {
        "model": OPENAI_MODEL,
        "messages": [
            {"role": "system", "content": SYSTEM_PROMPT},
            {"role": "user", "content": user_prompt},
        ],
        "temperature": 1.0,
        "max_tokens": 300,
    }
    async with httpx.AsyncClient(timeout=30.0) as client:
        resp = await client.post(url, json=payload, headers=headers)
        resp.raise_for_status()
        body = resp.json()
    text = body["choices"][0]["message"]["content"]
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

# AgentsTV

[![PyPI version](https://img.shields.io/pypi/v/agentstv)](https://pypi.org/project/agentstv/)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Python 3.10+](https://img.shields.io/badge/python-3.10+-blue.svg)](https://www.python.org/downloads/)

**Turn your AI coding agent sessions into a Twitch-style pixel art live stream.**

Your AI coding sessions already generate thousands of events. AgentsTV turns them into something you can actually watch -- pixel art characters coding in real-time, simulated Twitch chat reacting to what the agent does, esports-style narration, and a multi-session Master Control Room.

![AgentsTV session view](https://raw.githubusercontent.com/andrewle8/AgentsTV/master/screenshot.png?v=3)

![AgentsTV dashboard](https://raw.githubusercontent.com/andrewle8/AgentsTV/master/screenshot-dashboard.png?v=3)

## Quick Start

```bash
pip install agentstv
agentstv
```

The dashboard auto-discovers your session logs and opens in your browser.

### Add AI Chat (optional)

Hook up a local LLM via [Ollama](https://ollama.com/) for viewer chat, narrator commentary, and interactive Q&A:

```bash
ollama pull qwen3:14b
agentstv --llm ollama --ollama-model qwen3:14b
```

Without Ollama, everything still works -- chat falls back to built-in messages.

| Hardware | Model | Notes |
|---|---|---|
| Desktop GPU (12GB+ VRAM) | `qwen3:14b` | Best overall |
| MacBook / Laptop | `qwen3:8b` | Good balance of quality and speed |
| Low VRAM / older GPU | `phi4-mini` | Lightweight, surprisingly capable |

Also supports OpenAI and Anthropic as cloud providers -- configure via CLI flags or the in-app settings panel.

## Features

- **Pixel art webcam** -- Procedurally generated scenes with idle animations, weather effects, and event reactions (error shakes, completion confetti, thinking bubbles)
- **Viewer chat** -- Simulated Twitch chat reacting to what the agent is doing
- **Interactive chat** -- Ask questions about the current session and get context-aware answers
- **Narrator bot** -- Esports-style play-by-play commentary
- **Auto stream titles** -- Generated from recent activity (e.g. `Coding / Python / main`)
- **Master Control Room** -- Multi-monitor dashboard for all active sessions
- **Session replay** -- Seek, speed control (0.5x-8x), full event recreation
- **Clip recording** -- Record and download WebM clips
- **OBS overlay** -- Browser Source at `/overlay.html` for stream compositing
- **Sound effects** -- Keystrokes, error buzzer, completion chime, chat pops
- **Public mode** -- `--public` scrubs secrets server-side before sharing
- **Dark/light theme**, keyboard shortcuts (`?`), search, sort, alert toasts

## Usage

```bash
agentstv                         # Launch (opens browser)
agentstv --port 8420             # Custom port (default: 8420)
agentstv --host 0.0.0.0         # Bind to all interfaces (LAN access)
agentstv --public                # Redact secrets for public sharing
agentstv --low-power             # Reduce LLM batch sizes for laptops
agentstv --no-browser            # Don't auto-open browser
```

Logs are discovered from `~/.claude/projects/`. Override with `AGENTSTV_DATA_DIR=/path/to/logs`.

## Supported Formats

- **Claude Code** JSONL transcripts (full support)
- **Codex CLI** session logs (experimental)
- **Gemini CLI** session logs (experimental)

## Contributing

PRs welcome. MIT-licensed.

```bash
git clone https://github.com/andrewle8/AgentsTV.git
cd AgentsTV
pip install -e .
agentstv --no-browser
```

Areas where help is especially welcome:
- Additional agent format parsers (Copilot CLI, Aider, etc.)
- Custom pixel art themes and character skins
- Mobile layout improvements
- OBS overlay enhancements

## License

MIT

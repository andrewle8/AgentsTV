# AgentsTV

[![PyPI version](https://img.shields.io/pypi/v/agentstv)](https://pypi.org/project/agentstv/)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Python 3.10+](https://img.shields.io/badge/python-3.10+-blue.svg)](https://www.python.org/downloads/)

**Turn your AI coding agent sessions into a Twitch-style pixel art live stream.**

Your Claude Code sessions are already generating thousands of events. AgentsTV turns them into something you can actually watch -- pixel art characters coding in real-time, simulated Twitch chat reacting to what the agent does, esports-style narration, and a Master Control Room when you're running multiple sessions.

![AgentsTV session view](https://raw.githubusercontent.com/andrewle8/AgentsTV/master/screenshot.png?v=3)

![AgentsTV dashboard](https://raw.githubusercontent.com/andrewle8/AgentsTV/master/screenshot-dashboard.png?v=3)

## Quick Start

```bash
pip install agentstv
agentstv
```

That's it. The dashboard auto-discovers your Claude Code session logs and opens in your browser.

### Add AI Chat (optional)

AgentsTV can use a local LLM via [Ollama](https://ollama.com/) for viewer chat, narrator commentary, and interactive Q&A:

```bash
ollama pull qwen3:14b
agentstv --llm ollama --ollama-model qwen3:14b
```

Without Ollama, everything works -- viewer chat uses built-in fallback messages.

| Hardware | Model | Notes |
|---|---|---|
| Desktop GPU (12GB+ VRAM) | `qwen3:14b` | Best overall |
| MacBook / Laptop | `qwen3:8b` | Good balance of quality and speed |
| Low VRAM / older GPU | `phi4-mini` | Lightweight, surprisingly capable |

Also supports OpenAI and Anthropic as cloud LLM providers. Configure via CLI flags or the in-app settings panel.

## Features

- **Pixel art webcam** -- Procedurally generated coding scenes with idle animations, desk decorations, weather effects, and event reactions (error shakes, completion confetti, spawn rings, thinking bubbles)
- **Viewer chat** -- Simulated Twitch chat where LLM-generated viewers react to what the agent is doing
- **Interactive chat** -- Ask questions about what the agent is working on and get context-aware answers
- **Narrator bot** -- Esports-style play-by-play commentary on agent activity
- **Auto stream titles** -- Generated from recent activity (e.g. `Coding / Python / main`)
- **Master Control Room** -- Multi-monitor view aggregating all active sessions with status LEDs and alert lights
- **Session replay** -- Play back completed sessions with seek, speed control (0.5x-8x), and full event recreation
- **Clip recording** -- Record and download WebM clips of interesting moments
- **OBS overlay** -- Browser Source page at `/overlay.html` for compositing over your stream
- **Sound effects** -- Keystrokes, error buzzer, completion chime, chat pops
- **Public mode** -- `--public` flag scrubs API keys, tokens, paths, and secrets server-side before sharing
- **Dark / light theme**, keyboard shortcuts (`?` to view), search and sort, stream alert toasts

## Usage

```bash
agentstv                         # Launch (opens browser)
agentstv --port 8420             # Custom port (default: 8420)
agentstv --host 0.0.0.0         # Bind to all interfaces (LAN access)
agentstv --public                # Redact secrets for public sharing
agentstv --low-power             # Reduce LLM batch sizes for laptops
agentstv --no-browser            # Don't auto-open browser
```

Session logs are discovered from `~/.claude/projects/`. Override with `AGENTSTV_DATA_DIR=/path/to/logs`.

## Supported Formats

- **Claude Code** JSONL transcripts (full support)
- **Codex CLI** session logs (experimental)
- **Gemini CLI** session logs (experimental)

## About

The idea started as a simple TUI to replay Claude Code session logs. I built the first version, went to bed, and woke up wanting something completely different: a Twitch-style live dashboard with pixel art characters, LLM-powered chat, and streaming overlays. The full web app was built and published in about 12 hours.

Built with Claude Code. I made the architectural decisions and directed the implementation across Python, JavaScript, HTML, and CSS.

## Contributing

Contributions are welcome! AgentsTV is MIT-licensed and open to PRs.

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

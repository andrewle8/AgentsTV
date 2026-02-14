# agent-replay

CLI Agent Visualizer — replay Claude Code sessions as animated TUI scenes.

```
┌─────────────────────────┬──────────────────┐
│     EVENT LOG           │   AGENTS         │
│  (scrolling combat text)│  ■ Main    1.2k  │
│                         │    ┗ scout  340   │
│  ★ scout-a3f spawned!   │                  │
│  $ Main runs tests      │   INVENTORY      │
│  + Main creates api.py  │  config.py  [R]  │
│  ~ Main edits utils.py  │  utils.py   [W]  │
│  ◆ Main thinks...       │  api.py     [C]  │
├─────────────────────────┴──────────────────┤
│ ▶ Playing  [████████░░░░] 67%   2x  42/63  │
└─────────────────────────────────────────────┘
```

## Install

```bash
pip install -e .
```

## Usage

```bash
# Replay a Claude Code transcript
agent-replay ~/.claude/projects/<project>/session.jsonl

# Or run as module
python -m agent_replay path/to/transcript.jsonl
```

## Controls

| Key | Action |
|-----|--------|
| `Space` | Play / Pause |
| `1-4` | Speed multiplier |
| `←` / `→` | Step back / forward |
| `q` | Quit |

## Architecture

```
agent_replay/
  parser.py    # JSONL parsing → normalized event stream (shared across renderers)
  models.py    # Event, Agent, Session dataclasses
  tui.py       # Terminal renderer (Rich Live + Layout)
```

The parser is renderer-agnostic. Future phases will add web (HTML/CSS) and Canvas/WebGL renderers reusing the same parser module.

## Supported Formats

- **Claude Code** JSONL transcripts (full support)
- **Codex CLI** (planned)

## License

MIT

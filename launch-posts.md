# AgentsTV Launch Posts

---

## 1. Show HN

**Title:** AgentsTV -- Twitch-style pixel art dashboard for AI coding agent sessions

**Body:**

I built a web dashboard that turns AI coding agent session logs into Twitch-style live streams with pixel art characters, simulated chat, and streaming overlays.

It reads Claude Code, Codex CLI, and Gemini CLI session logs and renders them as streams: a procedurally generated pixel art coding scene reacts to agent events (desk shake on errors, fist pump on completion), while an LLM generates viewer chat reactions and play-by-play narration.

Other features: timeline replay controls, WebM clip recording via canvas.captureStream, OBS Browser Source overlay, Master Control Room aggregating all active sessions, keyboard shortcuts, sound effects via Web Audio API.

The frontend is vanilla JS with ES modules -- no framework, no build step. Backend is FastAPI + uvicorn. LLM integration supports Ollama (local), OpenAI, and Anthropic.

```
pip install agent-replay && agent-replay
```

Auto-discovers sessions, opens in your browser.

I built the initial version in about 12 hours, with Claude Code handling implementation while I directed architecture and design decisions. MIT licensed.

GitHub: https://github.com/andrewle8/AgentsTV

---

## 2. r/ClaudeAI

**Title:** I built a Twitch-style pixel art dashboard for watching Claude Code sessions -- pip install and go

**Body:**

I made AgentsTV, a web dashboard that turns your Claude Code sessions into Twitch-style live streams with pixel art characters, simulated viewer chat, and streaming overlays.

It auto-discovers your Claude Code session logs from `~/.claude/projects/` and renders each one as a stream. The pixel art character reacts to what the agent is doing in real-time -- desk shakes on errors, fist pumps on completions, thought bubbles when planning, lightning bolts during bash commands. An LLM generates viewer chat reactions and a narrator bot provides esports-style play-by-play commentary.

It also supports Codex CLI and Gemini CLI sessions, but Claude Code is the primary target and gets the most polish.

Some highlights:

- Timeline controls for replaying past sessions
- WebM clip recording for sharing moments
- OBS Browser Source overlay for actual streaming
- Master Control Room view aggregating all active sessions
- Works with Ollama (local), OpenAI, or Anthropic for LLM features
- Runs fine without any LLM (falls back to hardcoded chat)

Install and run:

```
pip install agent-replay
agent-replay
```

That's it. Opens in your browser automatically.

Built the whole thing with Claude Code in about 12 hours initially. I made architecture decisions and directed implementation. MIT licensed, open source.

GitHub: https://github.com/andrewle8/AgentsTV

---

## 3. r/LocalLLaMA

**Title:** AgentsTV -- local-first Twitch-style dashboard for AI coding sessions, powered by Ollama

**Body:**

I built a web dashboard that visualizes AI coding agent sessions (Claude Code, Codex CLI, Gemini CLI) as Twitch-style pixel art streams. The LLM features are local-first with Ollama -- no cloud API keys required.

The Ollama integration drives three features:

1. **Viewer chat** -- simulated Twitch viewers react to what the agent is doing, generated in parallel batches for fast buffer fill
2. **Narrator bot** -- esports-style play-by-play commentary on agent actions
3. **Interactive chat** -- ask questions about what the agent is doing and get contextual answers

For Ollama models that support `/no_think` (Qwen3, Cogito), viewer chat and narrator prompts automatically disable internal reasoning to reduce latency. Interactive chat keeps thinking enabled for better answers.

The settings panel auto-detects locally installed Ollama models and lets you pick one. Hardware profiles (Desktop GPU / Laptop / Cloud Only) auto-suggest appropriate models and buffer sizes. Low-power mode reduces batch sizes for laptops.

Everything runs locally. The only network call is to your own Ollama instance. No telemetry, no cloud dependency. Works fully offline if your sessions are already cached.

```
pip install agent-replay
agent-replay --llm ollama --ollama-model qwen3:14b
```

MIT licensed: https://github.com/andrewle8/AgentsTV

---

## 4. r/programming

**Title:** AgentsTV: Twitch-style dashboard for AI coding sessions -- FastAPI, vanilla JS, no build step

**Body:**

I built a web dashboard that renders AI coding agent session logs as Twitch-style streams with pixel art visuals, simulated chat, and recording. Sharing because the tech stack choices might be interesting.

**Backend:** FastAPI + uvicorn. Serves static files, parses JSONL session logs, and proxies LLM calls to Ollama/OpenAI/Anthropic. Three Python files, no ORM, no database. Session discovery walks `~/.claude/projects/` looking for JSONL files.

**Frontend:** Vanilla JavaScript with ES modules. No React, no build step, no bundler. The entire UI is ~15 JS files loaded directly by the browser. State management is just module-scoped variables and event dispatching.

**Pixel art rendering:** HTML5 Canvas with requestAnimationFrame. Each coding scene is procedurally generated -- character sprites, desk decorations, window backgrounds, monitor content. Agent events trigger animations (desk shake, confetti, thought bubbles) via a simple state machine.

**Audio:** Web Audio API with programmatically generated sounds -- oscillators and noise buffers, no audio files. Keystroke sounds, error buzzer, completion chime.

**Recording:** canvas.captureStream() piped into MediaRecorder for WebM clip export. No ffmpeg, no server-side processing.

**LLM integration:** Batched async calls for chat message generation. Pre-fetches a buffer of messages so chat feels continuous. Supports streaming responses for interactive chat.

```
pip install agent-replay && agent-replay
```

Dependencies are just FastAPI, uvicorn, and httpx. MIT licensed.

GitHub: https://github.com/andrewle8/AgentsTV

---

## 5. Twitter/X

```
I built AgentsTV -- a Twitch-style pixel art dashboard for watching AI coding agents work.

Pixel art characters react to errors and completions. LLM-powered viewer chat. One command:

pip install agent-replay

https://github.com/andrewle8/AgentsTV
```

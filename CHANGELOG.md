# Changelog

## v0.4.0

### Security
- Fix path traversal vulnerability in session ID resolution
- Add input validation with message length limits on API endpoints
- Replace silent exception swallowing with proper logging

### Performance
- Add parse cache with mtime invalidation — skip re-parsing unchanged files
- Add 5-second TTL cache for session scanner — stop re-globbing filesystem every request
- Use persistent httpx clients for LLM calls instead of creating one per request
- Fix async lock held during LLM calls — no longer blocks concurrent requests
- Cap chat DOM at 500 messages to prevent unbounded growth

### New Features
- Add Anthropic Claude as a cloud LLM provider (Haiku default)
- Add `--low-power` mode for laptops — reduced batch sizes, conservative defaults
- Add hardware profile selector: Desktop GPU / Laptop / Cloud Only
- Add sound effects (keystrokes, error buzzer, completion chime, spawn whoosh)
- Add keyboard shortcut overlay (press `?`) with wired shortcuts
- Add dark/light theme toggle
- Add stream alert toasts for errors, completions, spawns
- Add session uptime timer ("LIVE for Xm Ys")
- Add dashboard search/filter by project name, branch, slug
- Add dashboard sort by most recent, most events, most agents
- Add chat log export as .txt
- Add viewer name customization in settings
- Skip LLM calls for inactive sessions — use fallback messages only

### Refactoring
- Split monolithic 3000-line app.js into 10 ES modules
- Replace hand-rolled CLI arg parser with argparse
- Fix duplicate `drawRealCode` function — renamed to distinct session/master variants
- Remove hardcoded default model — user picks on first launch

## v0.3.1

- Add `/no_think` mode for Ollama prompts (viewer chat, narrator, reactions) — skips internal reasoning for faster responses on Qwen3/Cogito models. Interactive "explain" replies keep thinking mode for higher quality answers.
- Add code overlay panel showing real code snippets from agent events
- Add real content to Master Control Room monitors
- Improve chat viewer personalities and variety
- Add monkey-behind-desk character variant
- Change default Ollama model to `qwen3:14b`
- Fix browser opening `localhost` instead of `0.0.0.0` on Windows

## v0.3.0

- Add narrator bot with esports-style play-by-play commentary
- Add live stream titles generated from recent agent activity
- Add interactive chat — ask the LLM about specific agent events
- Add viewer reactions to user chat messages
- Add LLM on/off toggle and dynamic model picker
- Remove demo mode — users always have real sessions
- Add `httpx` dependency for LLM API calls
- Update README with full feature documentation

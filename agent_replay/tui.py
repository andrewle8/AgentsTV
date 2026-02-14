"""Terminal UI renderer using Rich — replays agent sessions as animated TUI scenes."""

from __future__ import annotations

import sys
import time
from pathlib import Path

from rich.console import Console
from rich.layout import Layout
from rich.live import Live
from rich.panel import Panel
from rich.table import Table
from rich.text import Text

from .models import EventType, Session
from .parser import parse

# Color scheme for event types
EVENT_COLORS = {
    EventType.SPAWN: "bold magenta",
    EventType.THINK: "yellow",
    EventType.TOOL_CALL: "cyan",
    EventType.TOOL_RESULT: "dim white",
    EventType.FILE_CREATE: "bold green",
    EventType.FILE_UPDATE: "green",
    EventType.FILE_READ: "dim green",
    EventType.BASH: "bright_cyan",
    EventType.WEB_SEARCH: "blue",
    EventType.TEXT: "white",
    EventType.ERROR: "bold red",
    EventType.COMPLETE: "bold white",
    EventType.USER: "bold bright_blue",
}

# Icons for event types
EVENT_ICONS = {
    EventType.SPAWN: "★",
    EventType.THINK: "◆",
    EventType.TOOL_CALL: "▸",
    EventType.TOOL_RESULT: "◂",
    EventType.FILE_CREATE: "+",
    EventType.FILE_UPDATE: "~",
    EventType.FILE_READ: "○",
    EventType.BASH: "$",
    EventType.WEB_SEARCH: "⌕",
    EventType.TEXT: "│",
    EventType.ERROR: "✖",
    EventType.COMPLETE: "✔",
    EventType.USER: "▶",
}

# Status indicators for agents
AGENT_STATUS = {
    "idle": ("·", "dim"),
    "thinking": ("◆", "yellow"),
    "acting": ("▸", "cyan"),
    "error": ("✖", "red"),
}


class ReplayTUI:
    """Interactive TUI for replaying agent sessions."""

    def __init__(self, session: Session, live_file: Path | None = None):
        self.session = session
        self.console = Console()
        self.current_idx = 0
        self.playing = True
        self.speed = 1  # 1-4 multiplier
        self.log_lines: list[tuple[EventType, Text]] = []  # (event_type, rendered_line)
        self.max_log_lines = 50
        self.files_touched: dict[str, str] = {}  # path -> R/W/C tag
        self.agent_tokens: dict[str, tuple[int, int]] = {}  # agent_id -> (in, out)
        self.agent_cache_tokens: dict[str, int] = {}  # agent_id -> cache_read
        self.agent_status: dict[str, str] = {}  # agent_id -> status key
        self.floating_tokens: list[tuple[int, int, str]] = []  # (appear_idx, tokens, agent_color)
        self.live_file = live_file
        self._last_reload = 0.0
        self.filter_noise = False  # Toggle to hide tool_results and dim text

    def run(self) -> None:
        """Main loop — render with Rich Live, handle keyboard input."""
        if not self.session.events:
            self.console.print("[red]No events found in transcript.[/red]")
            return

        try:
            self._run_live()
        except KeyboardInterrupt:
            pass

    def _run_live(self) -> None:
        """Run the Rich Live display loop."""
        import threading

        key_queue: list[str] = []
        stop_flag = threading.Event()

        def _read_keys():
            """Background thread to read single keypresses."""
            try:
                if sys.platform == "win32":
                    import msvcrt

                    while not stop_flag.is_set():
                        if msvcrt.kbhit():
                            ch = msvcrt.getwch()
                            if ch in ("\xe0", "\x00"):
                                ch2 = msvcrt.getwch()
                                if ch2 == "K":
                                    key_queue.append("left")
                                elif ch2 == "M":
                                    key_queue.append("right")
                            else:
                                key_queue.append(ch)
                        else:
                            time.sleep(0.02)
                else:
                    import termios
                    import tty

                    fd = sys.stdin.fileno()
                    old = termios.tcgetattr(fd)
                    try:
                        tty.setcbreak(fd)
                        while not stop_flag.is_set():
                            ch = sys.stdin.read(1)
                            if ch == "\x1b":
                                ch2 = sys.stdin.read(1)
                                if ch2 == "[":
                                    ch3 = sys.stdin.read(1)
                                    if ch3 == "D":
                                        key_queue.append("left")
                                    elif ch3 == "C":
                                        key_queue.append("right")
                            else:
                                key_queue.append(ch)
                    finally:
                        termios.tcsetattr(fd, termios.TCSADRAIN, old)
            except Exception:
                pass

        key_thread = threading.Thread(target=_read_keys, daemon=True)
        key_thread.start()

        total = len(self.session.events)

        with Live(self._build_layout(), console=self.console, refresh_per_second=15, screen=True) as live:
            last_advance = time.time()

            while True:
                while key_queue:
                    k = key_queue.pop(0)
                    if k == "q":
                        stop_flag.set()
                        return
                    elif k == " ":
                        self.playing = not self.playing
                    elif k in "1234":
                        self.speed = int(k)
                    elif k == "right":
                        self._advance()
                    elif k == "left":
                        self._step_back()
                    elif k == "f":
                        self.filter_noise = not self.filter_noise

                now = time.time()
                interval = 0.3 / self.speed
                if self.playing and (now - last_advance) >= interval:
                    if self.current_idx < total:
                        self._advance()
                        last_advance = now
                    else:
                        self.playing = False

                # Live mode: periodically re-parse for new events
                if self.live_file and (now - self._last_reload) > 2.0:
                    self._reload_live()
                    self._last_reload = now

                live.update(self._build_layout())
                time.sleep(0.03)

    def _reload_live(self) -> None:
        """Re-parse the transcript file to pick up new events (live mode)."""
        try:
            new_session = parse(self.live_file)
            if len(new_session.events) > len(self.session.events):
                # Merge new agents
                for aid, agent in new_session.agents.items():
                    if aid not in self.session.agents:
                        self.session.agents[aid] = agent
                # Append new events only
                self.session.events = new_session.events
        except Exception:
            pass

    def _advance(self) -> None:
        """Process the next event."""
        if self.current_idx >= len(self.session.events):
            return
        event = self.session.events[self.current_idx]
        self._process_event(event)
        self.current_idx += 1

    def _step_back(self) -> None:
        """Step back one event (rebuild state from scratch)."""
        if self.current_idx <= 0:
            return
        target = self.current_idx - 1
        self.log_lines.clear()
        self.files_touched.clear()
        self.agent_tokens.clear()
        self.agent_cache_tokens.clear()
        self.agent_status.clear()
        self.floating_tokens.clear()
        self.current_idx = 0
        for _ in range(target):
            self._advance()

    def _process_event(self, event) -> None:
        """Add event to log and update state."""
        agent = self.session.agents.get(event.agent_id)
        agent_name = agent.name if agent else event.agent_id
        agent_color = agent.color if agent else "white"

        icon = EVENT_ICONS.get(event.type, "·")
        color = EVENT_COLORS.get(event.type, "white")

        # Update agent status
        if event.type == EventType.THINK:
            self.agent_status[event.agent_id] = "thinking"
        elif event.type in (EventType.BASH, EventType.TOOL_CALL, EventType.FILE_CREATE,
                            EventType.FILE_UPDATE, EventType.FILE_READ, EventType.SPAWN,
                            EventType.WEB_SEARCH):
            self.agent_status[event.agent_id] = "acting"
        elif event.type == EventType.ERROR:
            self.agent_status[event.agent_id] = "error"
        elif event.type in (EventType.TEXT, EventType.TOOL_RESULT, EventType.USER):
            self.agent_status[event.agent_id] = "idle"

        # Track agent tokens
        total_tok = event.input_tokens + event.output_tokens
        if total_tok > 0:
            prev = self.agent_tokens.get(event.agent_id, (0, 0))
            self.agent_tokens[event.agent_id] = (
                prev[0] + event.input_tokens,
                prev[1] + event.output_tokens,
            )
            self.floating_tokens.append((self.current_idx, total_tok, agent_color))
        if event.cache_read_tokens > 0:
            prev_cache = self.agent_cache_tokens.get(event.agent_id, 0)
            self.agent_cache_tokens[event.agent_id] = prev_cache + event.cache_read_tokens

        # Trim old floating tokens (keep last 3)
        if len(self.floating_tokens) > 3:
            self.floating_tokens = self.floating_tokens[-3:]

        # Build log line
        line = Text()
        line.append(f"  {icon} ", style=color)

        # Agent tag with colored background
        if agent and agent.is_subagent:
            line.append(f" {agent_name} ", style=f"bold on {agent_color}")
        else:
            line.append(f"{agent_name}", style=f"bold {agent_color}")
        line.append(" ", style="white")

        if event.type == EventType.SPAWN:
            line.append(f"spawns → ", style="dim magenta")
            line.append(f"{event.content}", style=color)
        elif event.type == EventType.THINK:
            line.append(f"thinks: ", style="dim yellow")
            line.append(f"{event.content[:70]}", style=color)
        elif event.type == EventType.BASH:
            line.append(f"$ ", style="bold bright_cyan")
            line.append(f"{event.content[:70]}", style=color)
        elif event.type == EventType.FILE_CREATE:
            line.append(f"creates ", style="dim green")
            line.append(f"{_short_path(event.file_path)}", style="bold green")
        elif event.type == EventType.FILE_UPDATE:
            line.append(f"edits ", style="dim green")
            line.append(f"{_short_path(event.file_path)}", style=color)
        elif event.type == EventType.FILE_READ:
            line.append(f"reads ", style="dim")
            line.append(f"{_short_path(event.file_path)}", style=color)
        elif event.type == EventType.WEB_SEARCH:
            line.append(f"searches: ", style="dim blue")
            line.append(f"{event.content[:70]}", style=color)
        elif event.type == EventType.USER:
            line.append(f"» ", style="bold bright_blue")
            line.append(f"{event.content[:70]}", style=color)
        elif event.type == EventType.ERROR:
            line.append(f"ERROR ", style="bold red")
            line.append(f"{event.content[:70]}", style="red")
        elif event.type == EventType.TEXT:
            line.append(event.content[:70], style=color)
        elif event.type == EventType.TOOL_CALL:
            line.append(f"{event.tool_name} ", style="bold cyan")
            line.append(f"{event.content[:60]}", style=color)
        elif event.type == EventType.TOOL_RESULT:
            line.append(f"← ", style="dim")
            line.append(f"{event.content[:60]}", style=color)
        else:
            line.append(event.content[:70], style=color)

        # Token cost floating number (RPG style)
        if total_tok > 0:
            line.append(f"  +{_fmt_tokens(total_tok)} tok", style="bold yellow")

        self.log_lines.append((event.type, line))
        if len(self.log_lines) > self.max_log_lines:
            self.log_lines = self.log_lines[-self.max_log_lines :]

        # Track files
        if event.file_path:
            short = _short_path(event.file_path)
            if event.type == EventType.FILE_CREATE:
                self.files_touched[short] = "C"
            elif event.type == EventType.FILE_UPDATE:
                self.files_touched[short] = "W"
            elif event.type == EventType.FILE_READ:
                if short not in self.files_touched:
                    self.files_touched[short] = "R"

    def _build_layout(self) -> Layout:
        """Build the full TUI layout."""
        layout = Layout()
        layout.split_column(
            Layout(name="header", size=3),
            Layout(name="main", ratio=1),
            Layout(name="status", size=3),
        )
        layout["main"].split_row(
            Layout(name="log", ratio=3),
            Layout(name="sidebar", ratio=1, minimum_size=30),
        )
        layout["sidebar"].split_column(
            Layout(name="agents", ratio=1),
            Layout(name="inventory", ratio=1),
        )

        layout["header"].update(self._render_header())
        layout["log"].update(self._render_log())
        layout["agents"].update(self._render_agents())
        layout["inventory"].update(self._render_inventory())
        layout["status"].update(self._render_status())

        return layout

    def _render_header(self) -> Panel:
        """Render session info header with token counts and cost."""
        s = self.session
        text = Text()
        text.append(" agent-replay ", style="bold white on bright_black")
        text.append("  ", style="white")
        if s.slug:
            text.append(f"{s.slug}", style="bold")
            text.append("  ", style="white")
        if s.version:
            text.append(f"v{s.version}", style="dim")
            text.append("  ", style="white")
        if s.branch:
            text.append(f"⎇ {s.branch}", style="dim cyan")
            text.append("  ", style="white")

        # Token totals and cost
        total_in = sum(t[0] for t in self.agent_tokens.values())
        total_out = sum(t[1] for t in self.agent_tokens.values())
        total_cache = sum(
            self.agent_cache_tokens.get(aid, 0)
            for aid in self.agent_tokens
        )
        total_all = total_in + total_out

        if total_all > 0:
            text.append(f"tokens: ", style="dim")
            text.append(f"{_fmt_tokens(total_in)}", style="yellow")
            text.append(f" in  ", style="dim")
            text.append(f"{_fmt_tokens(total_out)}", style="bold yellow")
            text.append(f" out", style="dim")
            if total_cache > 0:
                text.append(f"  {_fmt_tokens(total_cache)}", style="dim cyan")
                text.append(f" cached", style="dim")
            # Estimated cost (Sonnet pricing as reasonable default)
            # $3/MTok in, $15/MTok out, $0.30/MTok cache read
            cost = (total_in * 3.0 + total_out * 15.0 + total_cache * 0.30) / 1_000_000
            text.append(f"  ~$", style="dim")
            text.append(f"{cost:.3f}" if cost < 1 else f"{cost:.2f}", style="bold bright_green")

        return Panel(text, border_style="bright_black")

    # Event types hidden when filter is on
    NOISE_TYPES = {EventType.TOOL_RESULT, EventType.TEXT}

    def _render_log(self) -> Panel:
        """Render the scrolling event log panel."""
        text = Text()
        visible = self.log_lines
        if self.filter_noise:
            visible = [(t, l) for t, l in visible if t not in self.NOISE_TYPES]
        for i, (_, line) in enumerate(visible):
            text.append_text(line)
            if i < len(visible) - 1:
                text.append("\n")

        filter_label = "  [dim][f]ilter: ON[/dim]" if self.filter_noise else ""
        return Panel(
            text,
            title=f"[bold bright_white] EVENT LOG [/bold bright_white]{filter_label}",
            border_style="bright_black",
            subtitle=f"[dim]{len(self.session.events)} events[/dim]",
        )

    def _render_agents(self) -> Panel:
        """Render the agents panel with status indicators."""
        table = Table(show_header=False, box=None, padding=(0, 1), expand=True)
        table.add_column("Status", width=2)
        table.add_column("Agent", ratio=1)
        table.add_column("Tokens", justify="right", width=10)

        for agent in self.session.agents.values():
            # Status indicator
            status_key = self.agent_status.get(agent.id, "idle")
            status_icon, status_style = AGENT_STATUS[status_key]
            status = Text(status_icon, style=status_style)

            # Agent name with color
            name_style = f"bold {agent.color}"
            if agent.is_subagent:
                prefix = "┗ "
            else:
                prefix = "■ "
            name = Text(f"{prefix}{agent.name}", style=name_style)

            # Token bar
            tok = self.agent_tokens.get(agent.id, (0, 0))
            total = tok[0] + tok[1]
            tok_text = Text()
            if total > 0:
                tok_text.append(_fmt_tokens(total), style="bold yellow")
            else:
                tok_text.append("—", style="dim")

            table.add_row(status, name, tok_text)

        return Panel(
            table,
            title="[bold bright_white] AGENTS [/bold bright_white]",
            border_style="bright_black",
        )

    def _render_inventory(self) -> Panel:
        """Render the file inventory panel."""
        text = Text()
        items = list(self.files_touched.items())
        visible = items[-25:]
        for i, (path, tag) in enumerate(visible):
            tag_colors = {"R": "dim green", "W": "bold green", "C": "bold bright_green"}
            tag_style = tag_colors.get(tag, "white")
            text.append(f"  {path}", style="white")
            text.append(f"  [{tag}]", style=tag_style)
            if i < len(visible) - 1:
                text.append("\n")

        return Panel(
            text,
            title="[bold bright_white] INVENTORY [/bold bright_white]",
            border_style="bright_black",
        )

    def _elapsed_str(self) -> str:
        """Return elapsed time from session start to current event."""
        events = self.session.events
        if not events or self.current_idx == 0:
            return ""
        try:
            from datetime import datetime

            t0 = datetime.fromisoformat(events[0].timestamp.replace("Z", "+00:00"))
            cur = self.current_idx - 1
            t1 = datetime.fromisoformat(events[cur].timestamp.replace("Z", "+00:00"))
            delta = t1 - t0
            total_secs = int(delta.total_seconds())
            if total_secs < 0:
                return ""
            mins, secs = divmod(total_secs, 60)
            hrs, mins = divmod(mins, 60)
            if hrs > 0:
                return f"{hrs}h{mins:02d}m{secs:02d}s"
            return f"{mins}m{secs:02d}s"
        except (ValueError, IndexError):
            return ""

    def _render_status(self) -> Panel:
        """Render the playback status bar."""
        total = len(self.session.events)
        current = self.current_idx
        progress = current / total if total > 0 else 0

        bar_width = 30
        filled = int(bar_width * progress)
        bar = "█" * filled + "░" * (bar_width - filled)

        state_icon = "▶" if self.playing else "⏸"
        state_label = "Playing" if self.playing else "Paused"
        state_style = "bold bright_green" if self.playing else "bold yellow"
        pct = f"{int(progress * 100)}%"

        text = Text()
        text.append(f" {state_icon} {state_label}", style=state_style)
        text.append(f"  [", style="dim")
        text.append(bar[:filled], style="bold bright_green")
        text.append(bar[filled:], style="dim")
        text.append(f"] {pct}", style="dim")
        text.append(f"   {self.speed}x", style="bold yellow")
        text.append(f"   {current}/{total}", style="dim white")

        # Time elapsed from first event to current event
        elapsed = self._elapsed_str()
        if elapsed:
            text.append(f"   {elapsed}", style="dim cyan")

        # Floating token costs (recent)
        for appear_idx, tok, color in self.floating_tokens:
            age = self.current_idx - appear_idx
            if age < 5:
                text.append(f"  +{_fmt_tokens(tok)}", style=f"bold {color}")

        return Panel(text, border_style="bright_black")


def _short_path(path: str) -> str:
    """Shorten a file path for display."""
    if not path:
        return ""
    p = Path(path)
    parts = p.parts
    if len(parts) > 3:
        return str(Path("…", *parts[-2:]))
    return str(p.name) if len(parts) <= 1 else str(Path(*parts[-2:]))


def _fmt_tokens(n: int) -> str:
    """Format token count for display."""
    if n >= 1_000_000:
        return f"{n / 1_000_000:.1f}M"
    if n >= 1_000:
        return f"{n / 1_000:.1f}k"
    return str(n)


def _find_latest_transcript() -> Path | None:
    """Find the most recently modified JSONL transcript in ~/.claude/projects/."""
    claude_dir = Path.home() / ".claude" / "projects"
    if not claude_dir.is_dir():
        return None
    candidates = list(claude_dir.rglob("*.jsonl"))
    # Exclude subagent files
    candidates = [c for c in candidates if "subagents" not in str(c)]
    if not candidates:
        return None
    return max(candidates, key=lambda p: p.stat().st_mtime)


def _list_sessions() -> None:
    """List recent sessions interactively."""
    import json
    from datetime import datetime

    claude_dir = Path.home() / ".claude" / "projects"
    if not claude_dir.is_dir():
        print("No transcripts found in ~/.claude/projects/")
        return

    candidates = list(claude_dir.rglob("*.jsonl"))
    candidates = [c for c in candidates if "subagents" not in str(c)]
    candidates.sort(key=lambda p: p.stat().st_mtime, reverse=True)
    candidates = candidates[:20]

    console = Console()
    table = Table(title="Recent Sessions", show_lines=False)
    table.add_column("#", style="dim", width=3)
    table.add_column("Date", style="cyan", width=18)
    table.add_column("Project", style="bold", width=20)
    table.add_column("Lines", justify="right", width=6)
    table.add_column("Path", style="dim")

    for i, path in enumerate(candidates):
        # Quick metadata extraction
        mtime = datetime.fromtimestamp(path.stat().st_mtime).strftime("%Y-%m-%d %H:%M")
        line_count = sum(1 for _ in open(path, encoding="utf-8", errors="ignore"))
        # Project from parent directory name
        project = path.parent.name
        if project == "projects":
            project = path.stem[:12]
        table.add_row(str(i + 1), mtime, project, str(line_count), str(path))

    console.print(table)
    console.print("\n[dim]Run: agent-replay <path>[/dim]")


def main(args: list[str] | None = None) -> None:
    """CLI entry point."""
    if args is None:
        args = sys.argv[1:]

    # --no-live disables live mode (on by default)
    no_live = "--no-live" in args
    args = [a for a in args if a not in ("--live", "--watch", "--no-live")]

    # Strip --latest (it's the default when no file given)
    if "--latest" in args:
        args.remove("--latest")

    if "--list" in args or "-l" in args:
        _list_sessions()
        sys.exit(0)

    if args and args[0] in ("-h", "--help"):
        print("Usage: agent-replay [transcript.jsonl]")
        print("\nReplay Claude Code sessions as animated TUI scenes.")
        print("With no arguments, replays the most recent session in live mode.")
        print("\nOptions:")
        print("  --list     List recent sessions")
        print("  --no-live  Disable live reload (replay only, don't watch for new events)")
        print("\nControls:")
        print("  SPACE    play/pause     f     toggle filter")
        print("  1-4      speed          ←/→   step back/forward")
        print("  q        quit")
        sys.exit(0)

    # Default to latest transcript if no file given
    if not args:
        latest = _find_latest_transcript()
        if latest:
            args = [str(latest)]
        else:
            print("Error: no transcripts found in ~/.claude/projects/")
            print("Usage: agent-replay [transcript.jsonl]")
            sys.exit(1)

    file_path = Path(args[0]).expanduser().resolve()
    if not file_path.exists():
        print(f"Error: file not found: {file_path}")
        sys.exit(1)

    live_mode = not no_live

    console = Console()
    console.print(f"[dim]Loading {file_path.name}...[/dim]")

    session = parse(file_path)
    mode_label = "live" if live_mode else "replay"
    console.print(
        f"[dim]Parsed {len(session.events)} events, "
        f"{len(session.agents)} agent(s) [{mode_label}][/dim]"
    )

    tui = ReplayTUI(session, live_file=file_path if live_mode else None)
    tui.run()


if __name__ == "__main__":
    main()

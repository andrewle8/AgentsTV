/* AgentsTV — session replay/playback mode */

import { state, bus } from './state.js';
import { appendChatMessage, getAgentLog, updateChatCounters, renderMods, renderDonationGoal, buildStreamTitle, stopViewerChat } from './chat.js';
import { triggerReaction } from './pixelEngine.js';
import { updateCodeOverlay } from './session.js';

let replayEvents = [];
let replaySession = null;

// ============================================================
// REPLAY CONTROLS
// ============================================================

export function startReplay(session, speed) {
    replaySession = session;
    replayEvents = session.events || [];
    state.replay.active = true;
    state.replay.speed = speed || 1;
    state.replay.position = 0;
    state.replay.playing = true;

    // Disconnect live WS while replaying
    if (state.ws) { state.ws.close(); state.ws = null; }
    stopViewerChat();

    // Clear chat log
    const log = getAgentLog();
    if (log) log.innerHTML = '';
    state.inventory = {};

    showReplayControls();
    updateReplayUI();
    scheduleNextEvent();
}

export function pauseReplay() {
    state.replay.playing = false;
    if (state.replay.timer) {
        clearTimeout(state.replay.timer);
        state.replay.timer = null;
    }
    updateReplayUI();
}

export function resumeReplay() {
    if (!state.replay.active) return;
    state.replay.playing = true;
    updateReplayUI();
    scheduleNextEvent();
}

export function seekReplay(position) {
    if (!state.replay.active) return;
    const wasPlaying = state.replay.playing;
    pauseReplay();

    // Re-render everything up to the target position
    const log = getAgentLog();
    if (log) log.innerHTML = '';
    state.inventory = {};

    const target = Math.min(position, replayEvents.length);
    for (let i = 0; i < target; i++) {
        appendChatMessage(log, replayEvents[i], replaySession, false, i);
    }

    state.replay.position = target;

    if (target > 0) {
        const lastEvt = replayEvents[target - 1];
        triggerReaction(lastEvt.type, lastEvt.content);
        const evtPath = lastEvt.short_path || lastEvt.file_path || '';
        updateCodeOverlay(lastEvt.type, lastEvt.content, evtPath);
    }

    updateChatCounters(replaySession);
    renderMods(replaySession);
    renderDonationGoal();

    if (log) log.scrollTop = log.scrollHeight;
    updateReplayUI();

    if (wasPlaying && target < replayEvents.length) {
        resumeReplay();
    }
}

export function setReplaySpeed(speed) {
    state.replay.speed = speed;
    // Reschedule if playing
    if (state.replay.playing) {
        if (state.replay.timer) {
            clearTimeout(state.replay.timer);
            state.replay.timer = null;
        }
        scheduleNextEvent();
    }
    updateReplayUI();
}

export function stopReplay() {
    state.replay.active = false;
    state.replay.playing = false;
    state.replay.position = 0;
    if (state.replay.timer) {
        clearTimeout(state.replay.timer);
        state.replay.timer = null;
    }
    replayEvents = [];
    replaySession = null;
    hideReplayControls();
}

// ============================================================
// SCHEDULING
// ============================================================

function scheduleNextEvent() {
    if (!state.replay.active || !state.replay.playing) return;
    if (state.replay.position >= replayEvents.length) {
        state.replay.playing = false;
        updateReplayUI();
        return;
    }

    const currentEvt = replayEvents[state.replay.position];
    let delay;

    if (state.replay.position === 0 || !currentEvt.timestamp) {
        delay = 100; // first event or no timestamp
    } else {
        const prevEvt = replayEvents[state.replay.position - 1];
        if (prevEvt.timestamp && currentEvt.timestamp) {
            const gap = (currentEvt.timestamp - prevEvt.timestamp) * 1000;
            // Cap individual gaps at 5 seconds (before speed multiplier)
            delay = Math.min(gap, 5000) / state.replay.speed;
        } else {
            delay = 300 / state.replay.speed;
        }
    }

    // Minimum delay to prevent UI lock
    delay = Math.max(delay, 30);

    state.replay.timer = setTimeout(() => {
        playCurrentEvent();
        scheduleNextEvent();
    }, delay);
}

function playCurrentEvent() {
    if (state.replay.position >= replayEvents.length) return;

    const evt = replayEvents[state.replay.position];
    const log = getAgentLog();

    appendChatMessage(log, evt, replaySession, false, state.replay.position);
    triggerReaction(evt.type, evt.content);

    const evtPath = evt.short_path || evt.file_path || '';
    updateCodeOverlay(evt.type, evt.content, evtPath);
    bus.emit('agent-event', evt);

    state.replay.position++;

    updateChatCounters(replaySession);
    renderMods(replaySession);
    renderDonationGoal();
    document.getElementById('session-meta').textContent = buildStreamTitle(replaySession);

    if (state.autoScroll && log) {
        log.scrollTop = log.scrollHeight;
    }

    updateReplayUI();
}

// ============================================================
// UI
// ============================================================

function showReplayControls() {
    const bar = document.getElementById('replay-controls');
    if (bar) bar.style.display = 'flex';

    // Hide LIVE badge during replay
    const liveBadge = document.getElementById('live-badge');
    if (liveBadge) liveBadge.style.display = 'none';

    // Show REPLAY badge
    const replayBadge = document.getElementById('replay-badge');
    if (replayBadge) replayBadge.style.display = 'inline';
}

function hideReplayControls() {
    const bar = document.getElementById('replay-controls');
    if (bar) bar.style.display = 'none';

    const replayBadge = document.getElementById('replay-badge');
    if (replayBadge) replayBadge.style.display = 'none';
}

function updateReplayUI() {
    const playBtn = document.getElementById('replay-play-btn');
    const speedEl = document.getElementById('replay-speed-select');
    const progressBar = document.getElementById('replay-progress-fill');
    const positionEl = document.getElementById('replay-position');
    const timeEl = document.getElementById('replay-time');

    if (!playBtn) return;

    playBtn.textContent = state.replay.playing ? '⏸' : '▶';
    playBtn.title = state.replay.playing ? 'Pause' : 'Play';

    if (speedEl) speedEl.value = String(state.replay.speed);

    const total = replayEvents.length;
    const pos = state.replay.position;
    const pct = total > 0 ? (pos / total) * 100 : 0;

    if (progressBar) progressBar.style.width = pct + '%';
    if (positionEl) positionEl.textContent = `${pos} / ${total}`;

    if (timeEl && total > 0) {
        const elapsed = getElapsedTime(pos);
        const totalTime = getElapsedTime(total);
        timeEl.textContent = `${formatDuration(elapsed)} / ${formatDuration(totalTime)}`;
    }
}

function getElapsedTime(upToIndex) {
    if (replayEvents.length === 0 || upToIndex === 0) return 0;
    const idx = Math.min(upToIndex, replayEvents.length) - 1;
    const first = replayEvents[0];
    const target = replayEvents[idx];
    if (!first.timestamp || !target.timestamp) return 0;
    return target.timestamp - first.timestamp;
}

function formatDuration(seconds) {
    if (seconds <= 0) return '0:00';
    const m = Math.floor(seconds / 60);
    const s = Math.floor(seconds % 60);
    return `${m}:${s.toString().padStart(2, '0')}`;
}

// ============================================================
// INIT — wire up control bar buttons
// ============================================================

export function initReplay() {
    const playBtn = document.getElementById('replay-play-btn');
    const speedSelect = document.getElementById('replay-speed-select');
    const progressTrack = document.getElementById('replay-progress-track');
    const exitBtn = document.getElementById('replay-exit-btn');

    if (playBtn) {
        playBtn.addEventListener('click', () => {
            if (state.replay.playing) pauseReplay();
            else resumeReplay();
        });
    }

    if (speedSelect) {
        speedSelect.addEventListener('change', (e) => {
            setReplaySpeed(parseFloat(e.target.value));
        });
    }

    // Clickable progress bar to seek
    if (progressTrack) {
        progressTrack.addEventListener('click', (e) => {
            const rect = progressTrack.getBoundingClientRect();
            const pct = (e.clientX - rect.left) / rect.width;
            const target = Math.floor(pct * replayEvents.length);
            seekReplay(Math.max(0, Math.min(target, replayEvents.length)));
        });
    }

    if (exitBtn) {
        exitBtn.addEventListener('click', () => {
            stopReplay();
            // Re-navigate to refresh the session view with live data
            const hash = window.location.hash || '';
            if (hash.startsWith('#/replay/')) {
                const filePath = decodeURIComponent(hash.slice('#/replay/'.length));
                window.location.hash = '#/session/' + encodeURIComponent(filePath);
            } else {
                window.location.hash = '#/';
            }
        });
    }
}

// ============================================================
// START REPLAY FROM SESSION (called by route or button)
// ============================================================

export async function startReplayForSession(filePath) {
    try {
        // Reuse session data if already loaded by showSessionView
        const data = (state.session && state.session.events && state.session.events.length > 0)
            ? state.session
            : await fetch('/api/session/' + encodeURIComponent(filePath)).then(r => r.json());
        if (data.error || !data.events || data.events.length === 0) {
            return;
        }
        startReplay(data, 1);
    } catch (e) {
        console.error('Failed to load session for replay:', e);
    }
}

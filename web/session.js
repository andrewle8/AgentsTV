/* AgentsTV — session (single stream) view */

import { state, bus, ICONS, EVENT_LABELS, PALETTES } from './state.js';
import { esc, fmtTokens, hashCode } from './utils.js';
import { startPixelAnimation, triggerReaction } from './pixelEngine.js';
import {
    getViewerLog, getAgentLog, applyChatMode, toggleChatSplit,
    appendChatMessage, renderChatLog, updateChatCounters,
    renderViewerCount, renderDonationGoal, renderMods, renderFiles,
    initFilters, startViewerChat, buildStreamTitle,
    loadPersistedState, persistTips, persistLikes, persistFollow,
    addTipToChat, setupScrollListener, exportChatLog,
    setupDividerDrag,
} from './chat.js';
import { connectWithRetry, navigate } from './dashboard.js';
import { syncLlmToggleUI } from './settings.js';
import { playTipSound } from './sound.js';
import { startReplayForSession } from './replay.js';

// ============================================================
// UPTIME TIMER
// ============================================================

export function startUptimeTimer(session) {
    stopUptimeTimer();
    const timerEl = document.getElementById('uptime-timer');
    if (!timerEl || !session) { if (timerEl) timerEl.textContent = ''; return; }

    // Use start_time, or fall back to first event timestamp
    let startTs = session.start_time;
    if (!startTs && session.events && session.events.length > 0) {
        startTs = session.events[0].timestamp;
    }
    if (!startTs) { timerEl.textContent = ''; return; }

    function update() {
        const elapsed = Math.floor(Date.now() / 1000 - startTs);
        if (elapsed < 0) { timerEl.textContent = ''; return; }
        const h = Math.floor(elapsed / 3600);
        const m = Math.floor((elapsed % 3600) / 60);
        const s = elapsed % 60;
        timerEl.textContent = h > 0
            ? `LIVE for ${h}h ${m}m ${s}s`
            : `LIVE for ${m}m ${s}s`;
    }
    update();
    state.uptimeInterval = setInterval(update, 1000);
}

export function stopUptimeTimer() {
    if (state.uptimeInterval) {
        clearInterval(state.uptimeInterval);
        state.uptimeInterval = null;
    }
    const timerEl = document.getElementById('uptime-timer');
    if (timerEl) timerEl.textContent = '';
}

// ============================================================
// CODE OVERLAY
// ============================================================

export function updateCodeOverlay(type, content, filePath) {
    const overlay = document.getElementById('code-overlay');
    if (!overlay) return;

    if (!content || typeof content !== 'string' || content.length <= 20) return;

    const typeEl = document.getElementById('code-overlay-type');
    const fileEl = document.getElementById('code-overlay-file');
    const bodyEl = document.getElementById('code-overlay-body');

    const label = EVENT_LABELS[type] || type;
    const icon = ICONS[type] || '';
    typeEl.textContent = `${icon} ${label}`;
    typeEl.className = 'code-overlay-type type-' + type;

    fileEl.textContent = filePath || '';

    let lines = content.split('\n');
    if (lines.length > 100) lines = lines.slice(0, 100);
    bodyEl.textContent = lines.join('\n');
    bodyEl.className = 'code-overlay-body content-' + type;

    overlay.classList.add('visible');

    if (state.codeOverlayTimer) clearTimeout(state.codeOverlayTimer);
    state.codeOverlayTimer = setTimeout(() => {
        overlay.classList.remove('visible');
        state.codeOverlayTimer = null;
    }, (state.tuning.overlayDuration || 15) * 1000);
}

export function hideCodeOverlay() {
    const overlay = document.getElementById('code-overlay');
    if (overlay) overlay.classList.remove('visible');
    if (state.codeOverlayTimer) {
        clearTimeout(state.codeOverlayTimer);
        state.codeOverlayTimer = null;
    }
}

// ============================================================
// SESSION VIEW
// ============================================================

export async function showSessionView(filePath) {
    state.view = 'session';
    state.inventory = {};
    state.sessionFilePath = filePath;
    loadPersistedState(filePath);

    if (state.ws) { state.ws.close(); state.ws = null; }
    document.getElementById('dashboard-view').style.display = 'none';
    document.getElementById('session-view').style.display = 'flex';

    document.getElementById('back-btn').onclick = () => navigate('#/');

    try { state.chatSplit = localStorage.getItem('agenttv_chatSplit') === '1'; } catch {}
    document.getElementById('chat-log').innerHTML = '';
    document.getElementById('event-log').innerHTML = '';
    const viewerLogInit = document.getElementById('viewer-log');
    if (viewerLogInit) viewerLogInit.innerHTML = '';
    applyChatMode();
    getViewerLog().innerHTML = '<div style="padding:20px;color:var(--text-muted)">Connecting to stream\u2026</div>';
    const vcc = document.getElementById('viewer-chat-count'); if (vcc) vcc.textContent = '';
    const alc = document.getElementById('agent-log-count'); if (alc) alc.textContent = '';

    setupActions(filePath);

    document.getElementById('split-chat-btn').onclick = toggleChatSplit;
    const exportBtn = document.getElementById('export-chat-btn');
    if (exportBtn) exportBtn.onclick = exportChatLog;
    document.getElementById('filter-toggle-btn').onclick = () => {
        const panel = document.getElementById('filters-panel');
        panel.style.display = panel.style.display === 'none' ? 'block' : 'none';
    };

    document.getElementById('expand-chat-btn').onclick = () => {
        state.chatFullscreen = !state.chatFullscreen;
        const layout = document.querySelector('.stream-layout');
        layout.classList.toggle('chat-fullscreen', state.chatFullscreen);
        document.getElementById('expand-chat-btn').textContent = state.chatFullscreen ? '\u229F' : '\u26F6';
        document.getElementById('expand-chat-btn').title = state.chatFullscreen ? 'Exit fullscreen chat' : 'Toggle fullscreen chat';
    };

    document.getElementById('like-count').textContent = state.likes;
    const followBtn = document.getElementById('follow-btn');
    followBtn.textContent = state.following ? '\u2665 Following' : '+ Follow';
    followBtn.classList.toggle('following', state.following);
    if (state.likes > 0) document.getElementById('like-btn').classList.add('liked');

    try {
        const resp = await fetch('/api/session/' + encodeURIComponent(filePath));
        const data = await resp.json();
        if (data.error) {
            getViewerLog().innerHTML = `<div style="padding:20px;color:var(--text-muted)">${esc(data.error)}</div>`;
            return;
        }
        state.session = data;
        initFilters();
        renderSession();
        setupScrollListener();
        connectSessionWS(filePath);
        startUptimeTimer(data);

        const canvas = document.getElementById('webcam-canvas');
        const seed = hashCode(filePath) % PALETTES.length;
        startPixelAnimation(canvas, seed, true);
        syncLlmToggleUI();
        if (state.llmEnabled) startViewerChat();
    } catch (e) {
        getViewerLog().innerHTML = `<div style="padding:20px;color:var(--text-muted)">Failed to connect to stream</div>`;
    }
}

export function setupActions(filePath) {
    const likeBtn = document.getElementById('like-btn');
    const tipBtn = document.getElementById('tip-btn');
    const followBtn = document.getElementById('follow-btn');

    likeBtn.onclick = (e) => {
        state.likes++;
        document.getElementById('like-count').textContent = state.likes;
        likeBtn.classList.add('liked');
        persistLikes(filePath);
        const heart = document.createElement('span');
        heart.className = 'heart-float';
        heart.textContent = '\u2665';
        heart.style.left = (e.clientX - 10) + 'px';
        heart.style.top = (e.clientY - 20) + 'px';
        document.body.appendChild(heart);
        setTimeout(() => heart.remove(), 1000);
    };

    tipBtn.onclick = (e) => {
        const amounts = [100, 500, 1000, 2500, 5000];
        const amount = amounts[Math.floor(Math.random() * amounts.length)];
        state.tips += amount;
        persistTips(filePath);
        addTipToChat(amount);
        triggerReaction('complete');
        playTipSound();
        const float = document.createElement('span');
        float.className = 'tip-float';
        float.textContent = `\uD83D\uDC8E ${fmtTokens(amount)}`;
        float.style.left = (e.clientX - 20) + 'px';
        float.style.top = (e.clientY - 20) + 'px';
        document.body.appendChild(float);
        setTimeout(() => float.remove(), 1500);
        renderDonationGoal();
    };

    followBtn.onclick = () => {
        state.following = !state.following;
        followBtn.textContent = state.following ? '\u2665 Following' : '+ Follow';
        followBtn.classList.toggle('following', state.following);
        persistFollow(filePath);
    };

    const replayBtn = document.getElementById('replay-session-btn');
    if (replayBtn) {
        replayBtn.onclick = () => {
            navigate('#/replay/' + encodeURIComponent(filePath));
        };
    }
}

function renderSession() {
    const s = state.session;
    if (!s) return;

    document.getElementById('session-slug').textContent = s.slug || 'AgentsTV Stream';
    document.getElementById('session-meta').textContent = buildStreamTitle(s);

    renderViewerCount();
    renderDonationGoal();
    renderChatLog(s);
    renderMods(s);
    renderFiles();
}

function connectSessionWS(filePath) {
    const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
    const statusEl = document.getElementById('session-status');
    const liveBadge = document.getElementById('live-badge');

    const ws = connectWithRetry(
        () => new WebSocket(`${proto}//${location.host}/ws/session/${encodeURIComponent(filePath)}`),
        statusEl, liveBadge
    );
    ws.onmessage = (e) => {
        const msg = JSON.parse(e.data);
        if (msg.type === 'full') {
            state.session = msg.data;
            initFilters();
            renderSession();
        } else if (msg.type === 'delta' && state.session) {
            state.session.events.push(...msg.events);
            state.session.agents = msg.agents;

            if (msg.events.length > 0) {
                const lastEvt = msg.events[msg.events.length - 1];
                const evtPath = lastEvt.short_path || lastEvt.file_path || '';
                triggerReaction(lastEvt.type, lastEvt.content);
                updateCodeOverlay(lastEvt.type, lastEvt.content, evtPath);
                bus.emit('agent-event', lastEvt);
            }

            const log = getAgentLog();
            const atBottom = log.scrollTop + log.clientHeight >= log.scrollHeight - 30;
            state.autoScroll = atBottom;

            const baseIdx = state.session.events.length - msg.events.length;
            msg.events.forEach((evt, i) => appendChatMessage(log, evt, state.session, false, baseIdx + i));
            updateChatCounters(state.session);
            renderMods(state.session);
            renderDonationGoal();
            document.getElementById('session-meta').textContent = buildStreamTitle(state.session);

            if (atBottom) {
                log.scrollTop = log.scrollHeight;
            } else {
                const badge = document.getElementById('new-events-badge');
                badge.textContent = `${msg.events.length} new`;
                badge.style.display = 'inline';
                badge.onclick = () => {
                    log.scrollTop = log.scrollHeight;
                    badge.style.display = 'none';
                    state.autoScroll = true;
                };
            }
        }
    };
}


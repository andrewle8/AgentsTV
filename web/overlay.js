/* AgentsTV — OBS Browser Source overlay entry point
 *
 * Usage: /static/overlay.html#<session_id>?chat=on&webcam=on&alerts=on&theme=dark
 *
 * URL parameters (all optional):
 *   chat      - on/off (default: on)  — show viewer/agent chat panel
 *   webcam    - on/off (default: on)  — show pixel art canvas
 *   alerts    - on/off (default: off) — show alert toasts on events
 *   theme     - dark/transparent (default: dark)
 */

import { state, bus, PALETTES, ICONS, EVENT_LABELS } from './state.js';
import { esc, hashCode } from './utils.js';
import { startPixelAnimation, triggerReaction } from './pixelEngine.js';

// ============================================================
// PARSE URL CONFIG
// ============================================================

function parseOverlayConfig() {
    const hash = window.location.hash.slice(1); // remove leading #
    const qIdx = hash.indexOf('?');
    const sessionId = qIdx >= 0 ? hash.slice(0, qIdx) : hash;
    const params = new URLSearchParams(qIdx >= 0 ? hash.slice(qIdx + 1) : '');

    return {
        sessionId: decodeURIComponent(sessionId),
        chat: params.get('chat') !== 'off',
        webcam: params.get('webcam') !== 'off',
        alerts: params.get('alerts') === 'on',
        theme: params.get('theme') || 'dark',
    };
}

const config = parseOverlayConfig();

// ============================================================
// APPLY THEME
// ============================================================

if (config.theme === 'transparent') {
    document.body.classList.add('overlay-transparent');
}

// ============================================================
// TOGGLE PANELS BASED ON CONFIG
// ============================================================

if (!config.chat) {
    const chatPanel = document.getElementById('chat-panel');
    if (chatPanel) chatPanel.style.display = 'none';
    document.getElementById('overlay-root').classList.add('no-chat');
}

if (!config.webcam) {
    const canvas = document.getElementById('webcam-canvas');
    if (canvas) canvas.style.display = 'none';
    document.getElementById('overlay-root').classList.add('no-webcam');
}

// ============================================================
// ALERTS (optional)
// ============================================================

const ALERT_MAP = {
    error: { icon: '\u{1F6A8}', text: 'Error detected!', color: 'var(--red-soft)' },
    complete: { icon: '\u2705', text: 'Task completed!', color: 'var(--green)' },
    spawn: { icon: '\u{1F31F}', text: 'New agent spawned!', color: 'var(--purple-light)' },
    file_create: { icon: '\u{1F4C4}', text: 'File created!', color: 'var(--green-dim)' },
};

let activeAlerts = [];

function showAlert(type) {
    if (!config.alerts) return;
    const info = ALERT_MAP[type];
    if (!info) return;

    const container = document.getElementById('alert-container');
    while (activeAlerts.length >= 3) {
        const oldest = activeAlerts.shift();
        oldest.remove();
    }

    const toast = document.createElement('div');
    toast.className = 'alert-toast';
    toast.style.borderLeftColor = info.color;
    toast.innerHTML = `<span class="alert-icon">${info.icon}</span><span class="alert-text">${info.text}</span>`;
    container.appendChild(toast);
    activeAlerts.push(toast);

    requestAnimationFrame(() => toast.classList.add('visible'));

    setTimeout(() => {
        toast.classList.remove('visible');
        toast.classList.add('dismissing');
        setTimeout(() => {
            toast.remove();
            const idx = activeAlerts.indexOf(toast);
            if (idx !== -1) activeAlerts.splice(idx, 1);
        }, 300);
    }, 4000);
}

bus.on('agent-event', (evt) => showAlert(evt.type));

// ============================================================
// CODE OVERLAY (reused from session.js logic)
// ============================================================

function updateCodeOverlay(type, content, filePath) {
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

// ============================================================
// CHAT RENDERING (simplified for overlay — no interactivity)
// ============================================================

const CHAT_BADGES_OVERLAY = {
    spawn: '\u{1F7E3}', think: '\u{1F9E0}', bash: '\u26A1', error: '\u{1F534}',
    user: '\u{1F464}', file_create: '\u{1F4DD}', file_update: '\u270F\uFE0F',
    file_read: '\u{1F4D6}', web_search: '\u{1F310}', tool_call: '\u{1F527}',
    tool_result: '\u{1F4E8}', text: '\u{1F4AC}', complete: '\u2705',
};

const MAX_OVERLAY_MESSAGES = 200;

function appendOverlayChatMessage(evt, session) {
    const log = document.getElementById('chat-log');
    if (!log) return;

    const agent = session.agents[evt.agent_id];
    const agentName = agent ? agent.name : evt.agent_id;
    const agentColor = agent ? agent.color : 'white';

    const badge = CHAT_BADGES_OVERLAY[evt.type] || '\u00b7';
    const chatText = buildOverlayChatText(evt);

    const div = document.createElement('div');
    div.className = 'chat-msg';
    div.innerHTML = `<span class="chat-badge">${badge}</span>`
        + `<span class="chat-name name-${agentColor}">${esc(agentName)}</span>`
        + `<span class="chat-text">${esc(chatText)}</span>`;

    log.appendChild(div);

    // Cap DOM
    while (log.children.length > MAX_OVERLAY_MESSAGES) {
        log.removeChild(log.firstChild);
    }

    log.scrollTop = log.scrollHeight;
}

function buildOverlayChatText(evt) {
    switch (evt.type) {
        case 'spawn': return `spawns \u2192 ${evt.summary}`;
        case 'think': return evt.summary;
        case 'bash': return `$ ${evt.summary}`;
        case 'file_create': return `creates ${evt.short_path || evt.file_path}`;
        case 'file_update': return `edits ${evt.short_path || evt.file_path}`;
        case 'file_read': return `reads ${evt.short_path || evt.file_path}`;
        case 'web_search': return evt.summary;
        case 'user': return evt.summary;
        case 'error': return `ERROR: ${evt.summary}`;
        case 'tool_call': return `${evt.tool_name} ${evt.summary}`;
        case 'tool_result': return evt.summary;
        default: return evt.summary;
    }
}

function renderAllChatMessages(session) {
    const log = document.getElementById('chat-log');
    if (!log) return;
    log.innerHTML = '';
    for (const evt of session.events) {
        appendOverlayChatMessage(evt, session);
    }
}

// ============================================================
// WEBSOCKET + SESSION LOADING
// ============================================================

let ws = null;
let session = null;
let retryDelay = 1000;

async function init() {
    if (!config.sessionId) {
        console.error('[overlay] No session ID in URL hash');
        return;
    }

    state.sessionFilePath = config.sessionId;

    // Load initial session data
    try {
        const resp = await fetch('/api/session/' + encodeURIComponent(config.sessionId));
        const data = await resp.json();
        if (data.error) {
            console.error('[overlay] Session error:', data.error);
            return;
        }
        session = data;
        state.session = data;

        // Render slug
        const slugEl = document.getElementById('session-slug');
        if (slugEl) slugEl.textContent = session.slug || '';

        // Start pixel art
        if (config.webcam) {
            const canvas = document.getElementById('webcam-canvas');
            const seed = hashCode(config.sessionId) % PALETTES.length;
            startPixelAnimation(canvas, seed, true);
        }

        // Render initial chat
        if (config.chat) {
            renderAllChatMessages(session);
        }

        // Connect WebSocket for live updates
        connectWS();
    } catch (e) {
        console.error('[overlay] Failed to load session:', e);
    }
}

function connectWS() {
    const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
    const url = `${proto}//${location.host}/ws/session/${encodeURIComponent(config.sessionId)}`;

    ws = new WebSocket(url);

    ws.addEventListener('open', () => {
        retryDelay = 1000;
        const badge = document.getElementById('live-badge');
        if (badge) badge.style.display = 'inline';
    });

    ws.addEventListener('close', () => {
        const badge = document.getElementById('live-badge');
        if (badge) badge.style.display = 'none';
        setTimeout(connectWS, retryDelay);
        retryDelay = Math.min(retryDelay * 2, 30000);
    });

    ws.addEventListener('error', () => {
        ws.close();
    });

    ws.addEventListener('message', (e) => {
        const msg = JSON.parse(e.data);

        if (msg.type === 'full') {
            session = msg.data;
            state.session = msg.data;
            if (config.chat) renderAllChatMessages(session);
        } else if (msg.type === 'delta' && session) {
            session.events.push(...msg.events);
            session.agents = msg.agents;

            for (const evt of msg.events) {
                triggerReaction(evt.type, evt.content);
                const evtPath = evt.short_path || evt.file_path || '';
                updateCodeOverlay(evt.type, evt.content, evtPath);
                bus.emit('agent-event', evt);

                if (config.chat) {
                    appendOverlayChatMessage(evt, session);
                }
            }
        }
    });
}

// ============================================================
// BOOT
// ============================================================

init();

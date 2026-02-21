/* AgentsTV — dashboard / browse channels view */

import { state } from './state.js';
import { esc, formatTimeAgo } from './utils.js';
import { startPixelAnimation } from './pixelEngine.js';

// ============================================================
// DASHBOARD
// ============================================================

export function showDashboard() {
    state.view = 'dashboard';
    if (state.ws) { state.ws.close(); state.ws = null; }
    document.getElementById('dashboard-view').style.display = 'flex';
    document.getElementById('session-view').style.display = 'none';
    const searchInput = document.getElementById('session-search');
    const sortSelect = document.getElementById('session-sort');
    if (searchInput && !searchInput.dataset.bound) {
        searchInput.dataset.bound = '1';
        searchInput.addEventListener('input', () => renderDashboard());
    }
    if (sortSelect && !sortSelect.dataset.bound) {
        sortSelect.dataset.bound = '1';
        sortSelect.addEventListener('change', () => renderDashboard());
    }
    loadSessions();
    connectDashboardWS();
}

async function loadSessions() {
    try {
        const resp = await fetch('/api/sessions');
        state.sessions = await resp.json();
        renderDashboard();
    } catch (e) {
        console.error('Failed to load sessions:', e);
    }
}

function connectDashboardWS() {
    if (state.ws) state.ws.close();
    const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
    const statusEl = document.getElementById('dash-status');

    const ws = connectWithRetry(
        () => new WebSocket(`${proto}//${location.host}/ws/dashboard`),
        statusEl, null
    );
    ws.onmessage = (e) => {
        const msg = JSON.parse(e.data);
        if (msg.type === 'sessions') {
            state.sessions = msg.data;
            renderDashboard();
        }
    };
}

function consolidateSessions(sessions, sortMode) {
    const groups = {};
    for (const s of sessions) {
        const key = s.project_name;
        if (!groups[key]) {
            groups[key] = { latest: s, count: 1, totalEvents: s.event_count, hasActive: s.is_active, maxAgents: s.agent_count || 0 };
        } else {
            groups[key].count++;
            groups[key].totalEvents += s.event_count;
            if (s.is_active) groups[key].hasActive = true;
            if ((s.agent_count || 0) > groups[key].maxAgents) groups[key].maxAgents = s.agent_count || 0;
            if (s.last_modified > groups[key].latest.last_modified) {
                groups[key].latest = s;
            }
        }
    }
    const vals = Object.values(groups);
    vals.sort((a, b) => {
        if (a.hasActive !== b.hasActive) return b.hasActive - a.hasActive;
        if (sortMode === 'events') return b.totalEvents - a.totalEvents;
        if (sortMode === 'agents') return b.maxAgents - a.maxAgents;
        return b.latest.last_modified - a.latest.last_modified;
    });
    return vals;
}

function filterSessions(sessions, query) {
    if (!query) return sessions;
    const q = query.toLowerCase();
    return sessions.filter(s =>
        (s.project_name && s.project_name.toLowerCase().includes(q)) ||
        (s.branch && s.branch.toLowerCase().includes(q)) ||
        (s.slug && s.slug.toLowerCase().includes(q))
    );
}

export function renderDashboard() {
    const grid = document.getElementById('session-grid');
    const empty = document.getElementById('no-sessions');

    if (!state.sessions.length) {
        grid.innerHTML = '';
        empty.style.display = 'flex';
        return;
    }
    empty.style.display = 'none';

    const searchInput = document.getElementById('session-search');
    const sortSelect = document.getElementById('session-sort');
    const query = searchInput ? searchInput.value : '';
    const sortMode = sortSelect ? sortSelect.value : 'recent';
    const filtered = filterSessions(state.sessions, query);
    const groups = consolidateSessions(filtered, sortMode);
    document.getElementById('channel-count').textContent = `(${groups.length} channels)`;

    const activeCount = groups.filter(g => g.hasActive).length;
    const totalEvts = groups.reduce((s, g) => s + g.totalEvents, 0);
    const masterCard = `
    <div class="channel-card master-card" data-master="true">
        <div class="channel-thumb">
            <canvas width="640" height="180" data-seed="master"></canvas>
            <div class="thumb-overlay"><span class="live-pill">ALL STREAMS</span></div>
            <span class="thumb-viewers">${totalEvts} total events</span>
            <span class="thumb-time">${activeCount} active</span>
        </div>
        <div class="channel-info">
            <div class="channel-avatar" style="background:linear-gradient(135deg,var(--purple),var(--gold))">👁</div>
            <div class="channel-text">
                <div class="channel-name">\uD83D\uDDA5 Master Control Room</div>
                <div class="channel-category">All agents \u00b7 All projects \u00b7 Everything at once</div>
                <div class="channel-tags"><span class="tag">${groups.length} projects</span></div>
            </div>
        </div>
    </div>`;

    grid.innerHTML = masterCard + groups.map((g, idx) => {
        const s = g.latest;
        const isLive = g.hasActive;
        const pill = isLive
            ? '<span class="live-pill">LIVE</span>'
            : '<span class="offline-pill">OFFLINE</span>';
        const viewers = `${g.totalEvents} events`;
        const timeAgo = formatTimeAgo(s.last_modified);
        const avatarClass = isLive ? 'channel-avatar is-live' : 'channel-avatar';
        const countBadge = g.count > 1
            ? `<span class="session-count-badge">${g.count} sessions</span>`
            : '';
        const branchTag = s.branch ? `<span class="tag">\u23C7 ${esc(s.branch)}</span>` : '';
        const agentTag = `<span class="tag">\u2605 ${s.agent_count} agent${s.agent_count !== 1 ? 's' : ''}</span>`;

        return `
        <div class="channel-card" data-path="${esc(s.file_path)}" data-idx="${idx}">
            <div class="channel-thumb">
                <canvas width="320" height="180" data-seed="${idx}"></canvas>
                <div class="thumb-overlay">${pill}</div>
                <span class="thumb-viewers">${viewers}</span>
                <span class="thumb-time">${timeAgo}</span>
                <button class="replay-card-btn" data-replay-path="${esc(s.file_path)}" title="Replay session">&#x25B6; Replay</button>
            </div>
            <div class="channel-info">
                <div class="${avatarClass}">\uD83D\uDC12</div>
                <div class="channel-text">
                    <div class="channel-name">${esc(s.project_name)}${countBadge}</div>
                    <div class="channel-category">Coding \u00b7 ${esc(s.slug || 'Claude Code')}</div>
                    <div class="channel-tags">${branchTag}${agentTag}</div>
                </div>
            </div>
        </div>`;
    }).join('');

    grid.querySelectorAll('.channel-card').forEach(card => {
        card.addEventListener('click', () => {
            if (card.dataset.master) {
                navigate('#/master');
            } else {
                navigate('#/session/' + encodeURIComponent(card.dataset.path));
            }
        });
    });

    grid.querySelectorAll('.replay-card-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            const filePath = btn.dataset.replayPath;
            navigate('#/replay/' + encodeURIComponent(filePath));
        });
    });

    grid.querySelectorAll('.channel-thumb canvas').forEach(canvas => {
        const seed = canvas.dataset.seed;
        if (seed === 'master') {
            startPixelAnimation(canvas, 99, false);
        } else {
            startPixelAnimation(canvas, parseInt(seed) || 0, false);
        }
    });

    // Fetch latest event content for each session thumbnail
    groups.forEach((g, idx) => {
        const filePath = g.latest.file_path;
        fetch('/api/session/' + encodeURIComponent(filePath))
            .then(r => r.json())
            .then(data => {
                if (data.error || !data.events || !data.events.length) return;
                for (let i = data.events.length - 1; i >= 0; i--) {
                    const evt = data.events[i];
                    if (evt.content && evt.content.length > 10) {
                        const canvas = grid.querySelector(`canvas[data-seed="${idx}"]`);
                        if (canvas) {
                            canvas._monitorContent = { _text: evt.content, _type: evt.type };
                        }
                        break;
                    }
                }
            })
            .catch(() => {});
    });
}

// ============================================================
// WEBSOCKET CONNECT WITH RETRY (shared)
// ============================================================

export function connectWithRetry(createWsFn, statusEl, liveBadge) {
    let retryDelay = 1000;
    let ws = null;

    function connect() {
        ws = createWsFn();

        ws.addEventListener('open', () => {
            retryDelay = 1000;
            if (statusEl) { statusEl.className = 'conn-status connected'; statusEl.textContent = liveBadge ? 'live' : 'connected'; }
            if (liveBadge) liveBadge.style.display = 'inline';
        });

        ws.addEventListener('close', () => {
            if (statusEl) { statusEl.className = 'conn-status'; statusEl.textContent = 'offline'; }
            if (liveBadge) liveBadge.style.display = 'none';
            setTimeout(() => {
                if (state.ws === ws) connect();
            }, retryDelay);
            retryDelay = Math.min(retryDelay * 2, 30000);
        });

        state.ws = ws;
        return ws;
    }

    return connect();
}

// ============================================================
// NAVIGATION HELPER
// ============================================================

export function navigate(hash) { window.location.hash = hash; }

/* AgentTV — Twitch-style agent session viewer */

const ICONS = {
    spawn: '★', think: '◆', tool_call: '▸', tool_result: '◂',
    file_create: '+', file_update: '~', file_read: '○',
    bash: '$', web_search: '⌕', text: '│', error: '✖',
    complete: '✔', user: '▶',
};

const EVENT_LABELS = {
    spawn: 'Spawn', think: 'Think', tool_call: 'Tool', tool_result: 'Result',
    file_create: 'Create', file_update: 'Edit', file_read: 'Read',
    bash: 'Bash', web_search: 'Web', text: 'Text', error: 'Error',
    complete: 'Done', user: 'User',
};

const CHAT_BADGES = {
    spawn: '🟣', think: '🧠', bash: '⚡', error: '🔴',
    user: '👤', file_create: '📝', file_update: '✏️', file_read: '📖',
    web_search: '🌐', tool_call: '🔧', tool_result: '📨',
    text: '💬', complete: '✅',
};

// Pixel art palettes for different "streamers"
const PALETTES = [
    { skin: '#ffcc99', hair: '#4a2800', shirt: '#9146ff', monitor: '#003322' },
    { skin: '#e8a87c', hair: '#2d132c', shirt: '#eb0400', monitor: '#001a33' },
    { skin: '#ffdab9', hair: '#c68642', shirt: '#00b4d8', monitor: '#1a0033' },
    { skin: '#d4a07a', hair: '#1a1a2e', shirt: '#f0c674', monitor: '#0a1628' },
    { skin: '#f5cba7', hair: '#6c3483', shirt: '#00e676', monitor: '#1a0a00' },
    { skin: '#ffdbac', hair: '#e74c3c', shirt: '#81d4fa', monitor: '#001a00' },
];

let state = {
    view: 'dashboard',
    sessions: [],
    session: null,
    ws: null,
    filters: {},
    autoScroll: true,
    inventory: {},
    likes: 0,
    tips: 0,
    following: false,
    animFrames: new Map(),
};

// ============================================================
// PIXEL ART ENGINE
// ============================================================

function drawPixelScene(canvas, seed, frame, isLarge) {
    const ctx = canvas.getContext('2d');
    const w = canvas.width;
    const h = canvas.height;
    const px = isLarge ? 4 : 3; // pixel size
    const palette = PALETTES[seed % PALETTES.length];

    ctx.fillStyle = '#0a0a18';
    ctx.fillRect(0, 0, w, h);

    // Floor
    ctx.fillStyle = '#1a1a2e';
    ctx.fillRect(0, h * 0.72, w, h * 0.28);
    ctx.fillStyle = '#151528';
    for (let x = 0; x < w; x += px * 8) {
        ctx.fillRect(x, h * 0.72, px * 4, h * 0.28);
    }

    // Desk
    const deskY = h * 0.55;
    const deskH = px * 4;
    ctx.fillStyle = '#3d2b1f';
    ctx.fillRect(w * 0.15, deskY, w * 0.7, deskH);
    ctx.fillStyle = '#2a1f14';
    ctx.fillRect(w * 0.15, deskY + deskH, w * 0.7, px);

    // Desk legs
    ctx.fillStyle = '#2a1f14';
    ctx.fillRect(w * 0.18, deskY + deskH, px * 2, h * 0.17);
    ctx.fillRect(w * 0.78, deskY + deskH, px * 2, h * 0.17);

    // Monitor body
    const monX = w * 0.35;
    const monY = deskY - px * 18;
    const monW = px * 28;
    const monH = px * 16;
    ctx.fillStyle = '#2c2c34';
    ctx.fillRect(monX - px, monY - px, monW + px * 2, monH + px * 2);

    // Monitor screen with CRT glow
    ctx.fillStyle = palette.monitor;
    ctx.fillRect(monX, monY, monW, monH);

    // Scanlines
    ctx.fillStyle = 'rgba(0,0,0,0.15)';
    for (let y = monY; y < monY + monH; y += px * 2) {
        ctx.fillRect(monX, y, monW, 1);
    }

    // Code on screen (scrolling based on frame)
    const codeColors = ['#00ff41', '#00cc33', '#66ff66', '#33ff88', '#00ff99'];
    const scrollOffset = (frame * 0.5) % 20;
    for (let row = 0; row < 7; row++) {
        const lineY = monY + px * 2 + row * px * 2;
        if (lineY >= monY + monH - px) continue;
        const lineSeed = (seed * 7 + row + Math.floor(scrollOffset)) * 31;
        const lineLen = 4 + (lineSeed % 18);
        const indent = (lineSeed >> 4) % 4;
        ctx.fillStyle = codeColors[row % codeColors.length];
        for (let col = 0; col < lineLen; col++) {
            const charSeed = (lineSeed + col * 13) % 100;
            if (charSeed < 20) continue; // gaps
            ctx.fillRect(monX + px * (indent + 1 + col), lineY, px - 1, px - 1);
        }
    }

    // CRT flicker
    if (frame % 60 < 2) {
        ctx.fillStyle = 'rgba(255,255,255,0.03)';
        ctx.fillRect(monX, monY, monW, monH);
    }

    // Monitor stand
    ctx.fillStyle = '#2c2c34';
    ctx.fillRect(monX + monW / 2 - px * 2, deskY - px * 2, px * 4, px * 2);
    ctx.fillRect(monX + monW / 2 - px * 4, deskY - px, px * 8, px);

    // Character — seated at desk
    const charX = w * 0.42;
    const charY = deskY - px * 2;

    // Chair back
    ctx.fillStyle = '#1a1a2e';
    ctx.fillRect(charX - px * 2, charY - px * 4, px * 14, px * 8);
    ctx.fillStyle = '#252540';
    ctx.fillRect(charX - px, charY - px * 3, px * 12, px * 6);

    // Body (torso)
    ctx.fillStyle = palette.shirt;
    ctx.fillRect(charX + px * 2, charY - px * 6, px * 6, px * 5);

    // Head
    ctx.fillStyle = palette.skin;
    ctx.fillRect(charX + px * 3, charY - px * 11, px * 4, px * 4);

    // Hair
    ctx.fillStyle = palette.hair;
    ctx.fillRect(charX + px * 3, charY - px * 12, px * 4, px * 2);
    ctx.fillRect(charX + px * 2, charY - px * 11, px, px * 2);

    // Eyes
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(charX + px * 4, charY - px * 9, px, px);
    ctx.fillRect(charX + px * 6, charY - px * 9, px, px);

    // Arms — typing animation
    const armPhase = Math.sin(frame * 0.3);
    const lArmY = charY - px * 4 + (armPhase > 0 ? -px : 0);
    const rArmY = charY - px * 4 + (armPhase > 0 ? 0 : -px);

    ctx.fillStyle = palette.skin;
    // Left arm
    ctx.fillRect(charX, lArmY, px * 2, px * 2);
    ctx.fillRect(charX - px, lArmY + px, px, px);
    // Right arm
    ctx.fillRect(charX + px * 8, rArmY, px * 2, px * 2);
    ctx.fillRect(charX + px * 10, rArmY + px, px, px);

    // Keyboard on desk
    ctx.fillStyle = '#3a3a44';
    ctx.fillRect(charX - px, deskY - px * 2, px * 12, px * 2);
    // Key highlights
    ctx.fillStyle = '#4a4a55';
    for (let k = 0; k < 5; k++) {
        const kx = charX + k * px * 2;
        ctx.fillRect(kx, deskY - px * 2, px, px);
    }

    // Coffee mug
    ctx.fillStyle = '#e0e0e0';
    ctx.fillRect(w * 0.7, deskY - px * 4, px * 3, px * 3);
    ctx.fillStyle = '#8b4513';
    ctx.fillRect(w * 0.7 + px * 0.5, deskY - px * 3.5, px * 2, px * 2);
    // Steam
    if (frame % 8 < 4) {
        ctx.fillStyle = 'rgba(200,200,200,0.3)';
        ctx.fillRect(w * 0.7 + px, deskY - px * 6, px, px);
        ctx.fillRect(w * 0.7 + px * 0.5, deskY - px * 7, px, px);
    }

    // Ambient particles (dust in light)
    const pCount = 5;
    for (let i = 0; i < pCount; i++) {
        const pSeed = (seed * 13 + i * 7 + frame) % 1000;
        const px2 = (pSeed % w);
        const py2 = ((pSeed * 3 + frame * 0.2) % (h * 0.7));
        ctx.fillStyle = `rgba(255,255,255,${0.05 + (pSeed % 10) * 0.01})`;
        ctx.fillRect(px2, py2, 1, 1);
    }
}

function startPixelAnimation(canvas, seed, isLarge) {
    let frame = Math.floor(Math.random() * 100);
    const id = canvas.dataset.animId || ('' + Math.random());
    canvas.dataset.animId = id;

    // Stop any existing animation for this canvas
    if (state.animFrames.has(id)) cancelAnimationFrame(state.animFrames.get(id));

    function animate() {
        drawPixelScene(canvas, seed, frame, isLarge);
        frame++;
        state.animFrames.set(id, requestAnimationFrame(animate));
    }
    animate();
}

function stopAllAnimations() {
    state.animFrames.forEach((id) => cancelAnimationFrame(id));
    state.animFrames.clear();
}

// ============================================================
// ROUTING
// ============================================================

function navigate(hash) { window.location.hash = hash; }

function handleRoute() {
    stopAllAnimations();
    const hash = window.location.hash || '#/';
    if (hash.startsWith('#/session/')) {
        const filePath = decodeURIComponent(hash.slice('#/session/'.length));
        showSessionView(filePath);
    } else {
        showDashboard();
    }
}

window.addEventListener('hashchange', handleRoute);

// ============================================================
// DASHBOARD — Browse Channels
// ============================================================

function showDashboard() {
    state.view = 'dashboard';
    if (state.ws) { state.ws.close(); state.ws = null; }
    document.getElementById('dashboard-view').style.display = 'flex';
    document.getElementById('session-view').style.display = 'none';
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
    const ws = new WebSocket(`${proto}//${location.host}/ws/dashboard`);
    state.ws = ws;
    const statusEl = document.getElementById('dash-status');

    ws.onopen = () => { statusEl.className = 'conn-status connected'; statusEl.textContent = 'connected'; };
    ws.onclose = () => { statusEl.className = 'conn-status'; statusEl.textContent = 'offline'; };
    ws.onmessage = (e) => {
        const msg = JSON.parse(e.data);
        if (msg.type === 'sessions') {
            state.sessions = msg.data;
            renderDashboard();
        }
    };
}

function consolidateSessions(sessions) {
    // Group by project_name, keep only the most recent per project
    const groups = {};
    for (const s of sessions) {
        const key = s.project_name;
        if (!groups[key]) {
            groups[key] = { latest: s, count: 1, totalEvents: s.event_count, hasActive: s.is_active };
        } else {
            groups[key].count++;
            groups[key].totalEvents += s.event_count;
            if (s.is_active) groups[key].hasActive = true;
            if (s.last_modified > groups[key].latest.last_modified) {
                groups[key].latest = s;
            }
        }
    }
    // Sort: active first, then by recency
    return Object.values(groups).sort((a, b) => {
        if (a.hasActive !== b.hasActive) return b.hasActive - a.hasActive;
        return b.latest.last_modified - a.latest.last_modified;
    });
}

function renderDashboard() {
    const grid = document.getElementById('session-grid');
    const empty = document.getElementById('no-sessions');

    if (!state.sessions.length) {
        grid.innerHTML = '';
        empty.style.display = 'flex';
        return;
    }
    empty.style.display = 'none';

    const groups = consolidateSessions(state.sessions);
    document.getElementById('channel-count').textContent = `(${groups.length} channels)`;

    grid.innerHTML = groups.map((g, idx) => {
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
        const branchTag = s.branch ? `<span class="tag">⎇ ${esc(s.branch)}</span>` : '';
        const agentTag = `<span class="tag">★ ${s.agent_count} agent${s.agent_count !== 1 ? 's' : ''}</span>`;

        return `
        <div class="channel-card" data-path="${esc(s.file_path)}" data-idx="${idx}">
            <div class="channel-thumb">
                <canvas width="320" height="180" data-seed="${idx}"></canvas>
                <div class="thumb-overlay">${pill}</div>
                <span class="thumb-viewers">${viewers}</span>
                <span class="thumb-time">${timeAgo}</span>
            </div>
            <div class="channel-info">
                <div class="${avatarClass}">🤖</div>
                <div class="channel-text">
                    <div class="channel-name">${esc(s.project_name)}${countBadge}</div>
                    <div class="channel-category">Coding · ${esc(s.slug || 'Claude Code')}</div>
                    <div class="channel-tags">${branchTag}${agentTag}</div>
                </div>
            </div>
        </div>`;
    }).join('');

    // Attach click handlers
    grid.querySelectorAll('.channel-card').forEach(card => {
        card.addEventListener('click', () => {
            navigate('#/session/' + encodeURIComponent(card.dataset.path));
        });
    });

    // Start pixel art animations for visible thumbnails
    grid.querySelectorAll('.channel-thumb canvas').forEach(canvas => {
        const seed = parseInt(canvas.dataset.seed) || 0;
        startPixelAnimation(canvas, seed, false);
    });
}

// ============================================================
// SESSION VIEW — Stream Page
// ============================================================

async function showSessionView(filePath) {
    state.view = 'session';
    state.inventory = {};
    state.likes = 0;
    state.tips = 0;
    state.following = false;
    if (state.ws) { state.ws.close(); state.ws = null; }
    document.getElementById('dashboard-view').style.display = 'none';
    document.getElementById('session-view').style.display = 'flex';

    document.getElementById('back-btn').onclick = () => navigate('#/');
    document.getElementById('event-log').innerHTML = '<div style="padding:20px;color:var(--text-muted)">Connecting to stream…</div>';

    // Setup action buttons
    setupActions();

    // Setup filter toggle
    document.getElementById('filter-toggle-btn').onclick = () => {
        const panel = document.getElementById('filters-panel');
        panel.style.display = panel.style.display === 'none' ? 'block' : 'none';
    };

    try {
        const resp = await fetch('/api/session/' + encodeURIComponent(filePath));
        const data = await resp.json();
        if (data.error) {
            document.getElementById('event-log').innerHTML = `<div style="padding:20px;color:var(--text-muted)">${esc(data.error)}</div>`;
            return;
        }
        state.session = data;
        initFilters();
        renderSession();
        connectSessionWS(filePath);

        // Start webcam animation
        const canvas = document.getElementById('webcam-canvas');
        const seed = hashCode(filePath) % PALETTES.length;
        startPixelAnimation(canvas, seed, true);
    } catch (e) {
        document.getElementById('event-log').innerHTML = `<div style="padding:20px;color:var(--text-muted)">Failed to connect to stream</div>`;
    }
}

function setupActions() {
    const likeBtn = document.getElementById('like-btn');
    const tipBtn = document.getElementById('tip-btn');
    const followBtn = document.getElementById('follow-btn');

    likeBtn.onclick = (e) => {
        state.likes++;
        document.getElementById('like-count').textContent = state.likes;
        likeBtn.classList.add('liked');
        // Heart float animation
        const heart = document.createElement('span');
        heart.className = 'heart-float';
        heart.textContent = '♥';
        heart.style.left = (e.clientX - 10) + 'px';
        heart.style.top = (e.clientY - 20) + 'px';
        document.body.appendChild(heart);
        setTimeout(() => heart.remove(), 1000);
    };

    tipBtn.onclick = (e) => {
        const amounts = [100, 500, 1000, 2500, 5000];
        const amount = amounts[Math.floor(Math.random() * amounts.length)];
        state.tips += amount;
        addTipToChat(amount);
        // Float animation
        const float = document.createElement('span');
        float.className = 'tip-float';
        float.textContent = `💎 ${fmtTokens(amount)}`;
        float.style.left = (e.clientX - 20) + 'px';
        float.style.top = (e.clientY - 20) + 'px';
        document.body.appendChild(float);
        setTimeout(() => float.remove(), 1500);
        // Update goal
        renderDonationGoal();
    };

    followBtn.onclick = () => {
        state.following = !state.following;
        followBtn.textContent = state.following ? '♥ Following' : '+ Follow';
        followBtn.classList.toggle('following', state.following);
    };
}

function addTipToChat(amount) {
    const log = document.getElementById('event-log');
    const names = ['viewer_42', 'code_fan99', 'pixel_dev', 'stream_lurker', 'bug_hunter', 'git_pusher'];
    const name = names[Math.floor(Math.random() * names.length)];
    const messages = [
        'Keep coding! 🔥', 'Amazing stream!', 'Fix that bug! 🐛',
        'Ship it! 🚀', 'Clean code! ✨', 'LFG!! 💪',
    ];
    const msg = messages[Math.floor(Math.random() * messages.length)];

    const div = document.createElement('div');
    div.className = 'chat-msg is-tip';
    div.innerHTML = `<span class="chat-badge">💎</span>`
        + `<span class="chat-name" style="color:var(--tip-blue)">${esc(name)}</span>`
        + `<span class="tip-amount">${fmtTokens(amount)} tokens</span> `
        + `<span class="chat-text">${esc(msg)}</span>`;
    log.appendChild(div);

    if (state.autoScroll) log.scrollTop = log.scrollHeight;
}

function renderSession() {
    const s = state.session;
    if (!s) return;

    // Header info
    document.getElementById('session-slug').textContent = s.slug || 'AgentTV Stream';
    const meta = [];
    if (s.version) meta.push(`v${s.version}`);
    if (s.branch) meta.push(`⎇ ${s.branch}`);
    document.getElementById('session-meta').textContent = meta.join(' · ') || 'Coding · Claude Code';

    // Viewer count = file count
    renderViewerCount();
    renderDonationGoal();
    renderChatLog(s);
    renderMods(s);
    renderViewers();
}

function renderViewerCount() {
    const count = Object.keys(state.inventory).length;
    document.getElementById('viewer-count').textContent = `👁 ${count} viewers`;
}

function renderDonationGoal() {
    const s = state.session;
    if (!s) return;
    const agents = Object.values(s.agents);
    const totalIn = agents.reduce((sum, a) => sum + a.input_tokens, 0);
    const totalOut = agents.reduce((sum, a) => sum + a.output_tokens, 0);
    const totalCache = agents.reduce((sum, a) => sum + a.cache_read_tokens, 0);
    const totalTokens = totalIn + totalOut + state.tips;
    const cost = (totalIn * 3.0 + totalOut * 15.0 + totalCache * 0.30) / 1_000_000;

    // Goal: next round number
    const goal = Math.ceil(totalTokens / 100000) * 100000 || 100000;
    const pct = Math.min(100, (totalTokens / goal) * 100);

    document.getElementById('goal-text').textContent =
        `${fmtTokens(totalTokens)} / ${fmtTokens(goal)} tokens (~$${cost < 1 ? cost.toFixed(3) : cost.toFixed(2)})`;
    document.getElementById('goal-bar').style.width = pct + '%';
}

// ============================================================
// CHAT LOG (Event log as Twitch chat)
// ============================================================

function renderChatLog(s) {
    const log = document.getElementById('event-log');
    const wasAtBottom = state.autoScroll;
    log.innerHTML = '';
    state.inventory = {};

    s.events.forEach((evt, idx) => {
        // Track inventory
        if (evt.file_path) {
            const sp = evt.short_path || evt.file_path;
            if (evt.type === 'file_create') state.inventory[sp] = 'C';
            else if (evt.type === 'file_update') state.inventory[sp] = 'W';
            else if (evt.type === 'file_read' && !state.inventory[sp]) state.inventory[sp] = 'R';
        }

        if (!isEventVisible(evt.type)) return;

        const agent = s.agents[evt.agent_id];
        const agentName = agent ? agent.name : evt.agent_id;
        const agentColor = agent ? agent.color : 'white';
        const isSubagent = agent ? agent.is_subagent : false;
        const totalTok = evt.input_tokens + evt.output_tokens;

        const div = document.createElement('div');
        div.className = 'chat-msg' + (totalTok > 0 ? ' has-tokens' : '');

        const badge = CHAT_BADGES[evt.type] || '·';
        const modBadge = isSubagent ? '🗡' : '';
        const nameClass = `name-${agentColor}`;
        const chatText = buildChatText(evt);
        const tokenHtml = totalTok > 0
            ? `<span class="token-badge">+${fmtTokens(totalTok)}</span>`
            : '';

        div.innerHTML = `<span class="chat-badge">${badge}</span>`
            + (modBadge ? `<span class="chat-badge">${modBadge}</span>` : '')
            + `<span class="chat-name ${nameClass}">${esc(agentName)}</span>`
            + `<span class="chat-text">${esc(chatText)}</span>`
            + tokenHtml;

        // Expand on click
        const expanded = document.createElement('div');
        expanded.className = 'chat-expanded';
        expanded.textContent = evt.content || '(no content)';

        div.addEventListener('click', () => {
            expanded.style.display = expanded.style.display === 'block' ? 'none' : 'block';
        });

        log.appendChild(div);
        log.appendChild(expanded);
    });

    if (wasAtBottom) log.scrollTop = log.scrollHeight;

    document.getElementById('event-count').textContent = `${s.events.length}`;
    document.getElementById('viewer-list-count').textContent = `(${Object.keys(state.inventory).length})`;
    document.getElementById('mod-count').textContent = `(${Object.keys(s.agents).length})`;
    renderViewerCount();
    renderViewers();
}

function buildChatText(evt) {
    switch (evt.type) {
        case 'spawn': return `spawns → ${evt.summary}`;
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

function renderMods(s) {
    const panel = document.getElementById('agents-panel');
    panel.innerHTML = Object.values(s.agents).map(a => {
        const total = a.input_tokens + a.output_tokens;
        const tokStr = total > 0 ? fmtTokens(total) + ' tok' : '';
        const badge = a.is_subagent ? '🗡' : '👑';
        return `<div class="mod-entry">
            <span class="mod-badge">${badge}</span>
            <span class="mod-name name-${a.color}">${esc(a.name)}</span>
            <span class="mod-tokens">${tokStr}</span>
        </div>`;
    }).join('');
}

function renderViewers() {
    const panel = document.getElementById('inventory-panel');
    const entries = Object.entries(state.inventory);
    if (!entries.length) {
        panel.innerHTML = '<div style="color:var(--text-muted);font-size:11px;padding:4px 0">No viewers yet</div>';
        return;
    }
    panel.innerHTML = entries.map(([path, tag]) =>
        `<div class="viewer-entry">
            <span class="viewer-name">${esc(path)}</span>
            <span class="viewer-tag viewer-tag-${tag}">[${tag}]</span>
        </div>`
    ).join('');
}

// ============================================================
// FILTERS
// ============================================================

function initFilters() {
    const panel = document.getElementById('filters-panel');
    state.filters = {};
    const types = Object.keys(EVENT_LABELS);
    panel.innerHTML = types.map(t => {
        state.filters[t] = true;
        return `<div class="filter-entry">
            <input type="checkbox" id="filter-${t}" checked>
            <label for="filter-${t}">${CHAT_BADGES[t] || '·'} ${EVENT_LABELS[t]}</label>
        </div>`;
    }).join('');

    types.forEach(t => {
        document.getElementById(`filter-${t}`).addEventListener('change', (e) => {
            state.filters[t] = e.target.checked;
            if (state.session) renderChatLog(state.session);
        });
    });
}

function isEventVisible(type) { return state.filters[type] !== false; }

// ============================================================
// WEBSOCKET
// ============================================================

function connectSessionWS(filePath) {
    const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
    const ws = new WebSocket(`${proto}//${location.host}/ws/session/${encodeURIComponent(filePath)}`);
    state.ws = ws;

    const statusEl = document.getElementById('session-status');
    const liveBadge = document.getElementById('live-badge');

    ws.onopen = () => {
        statusEl.className = 'conn-status connected';
        statusEl.textContent = 'live';
        liveBadge.style.display = 'inline';
    };
    ws.onclose = () => {
        statusEl.className = 'conn-status';
        statusEl.textContent = 'offline';
        liveBadge.style.display = 'none';
    };
    ws.onmessage = (e) => {
        const msg = JSON.parse(e.data);
        if (msg.type === 'full') {
            state.session = msg.data;
            initFilters();
            renderSession();
        } else if (msg.type === 'delta' && state.session) {
            state.session.events.push(...msg.events);
            state.session.agents = msg.agents;

            const log = document.getElementById('event-log');
            const atBottom = log.scrollTop + log.clientHeight >= log.scrollHeight - 30;
            state.autoScroll = atBottom;

            renderChatLog(state.session);
            renderMods(state.session);
            renderDonationGoal();

            if (!atBottom) {
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

// ============================================================
// INIT
// ============================================================

document.addEventListener('DOMContentLoaded', () => {
    handleRoute();

    // Auto-scroll tracking
    const observer = new MutationObserver(() => {
        const log = document.getElementById('event-log');
        if (log) {
            log.addEventListener('scroll', () => {
                state.autoScroll = log.scrollTop + log.clientHeight >= log.scrollHeight - 30;
                if (state.autoScroll) {
                    const badge = document.getElementById('new-events-badge');
                    if (badge) badge.style.display = 'none';
                }
            }, { passive: true });
        }
    });
    observer.observe(document.getElementById('app'), { childList: true, subtree: true });
});

// ============================================================
// HELPERS
// ============================================================

function fmtTokens(n) {
    if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'M';
    if (n >= 1_000) return (n / 1_000).toFixed(1) + 'k';
    return String(n);
}

function formatTimeAgo(ts) {
    const diff = Date.now() / 1000 - ts;
    if (diff < 60) return 'just now';
    if (diff < 3600) return Math.floor(diff / 60) + 'm ago';
    if (diff < 86400) return Math.floor(diff / 3600) + 'h ago';
    return Math.floor(diff / 86400) + 'd ago';
}

function esc(s) {
    if (!s) return '';
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function hashCode(str) {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
        hash = ((hash << 5) - hash) + str.charCodeAt(i);
        hash |= 0;
    }
    return Math.abs(hash);
}

/* AgentsTV — master control room view */

import { state, bus } from './state.js';
import { triggerReaction, drawCelebration } from './pixelEngine.js';
import {
    getViewerLog, getAgentLog, applyChatMode, toggleChatSplit,
    appendChatMessage, renderMasterChatLog, updateChatCounters,
    renderViewerCount, renderDonationGoal, renderMods, renderFiles,
    initFilters, startViewerChat, setupScrollListener,
    loadPersistedState, exportChatLog,
} from './chat.js';
import { connectWithRetry, navigate } from './dashboard.js';
import { updateCodeOverlay, setupActions } from './session.js';
import { syncLlmToggleUI } from './settings.js';

// ============================================================
// MCR REAL MONITOR CONTENT
// ============================================================

export function updateMasterMonitors(events) {
    const contentTypes = ['file_create', 'file_update', 'bash', 'tool_call', 'text', 'think', 'error'];
    const byProject = {};

    for (let i = events.length - 1; i >= 0; i--) {
        const evt = events[i];
        if (!evt.project || !contentTypes.includes(evt.type)) continue;
        if (!evt.content || evt.content.length < 10) continue;
        if (byProject[evt.project]) continue;
        byProject[evt.project] = {
            text: evt.content,
            type: evt.type,
            project: evt.project,
            path: evt.short_path || evt.file_path || '',
        };
        if (Object.keys(byProject).length >= 12) break;
    }

    const slots = [];
    for (const proj of Object.keys(byProject)) {
        slots.push(byProject[proj]);
    }
    const n = slots.length;
    const gridSize = n <= 2 ? 2 : n <= 4 ? 4 : n <= 6 ? 6 : n <= 9 ? 9 : 12;
    while (slots.length < gridSize) slots.push(null);
    state.masterMonitorContent = slots;
}

// ============================================================
// MASTER VIEW
// ============================================================

export async function showMasterChannel() {
    state.view = 'master';
    state.inventory = {};
    state.masterEvents = [];
    state.masterAgents = {};
    state.sessionFilePath = '__master__';
    loadPersistedState('__master__');

    if (state.ws) { state.ws.close(); state.ws = null; }
    document.getElementById('dashboard-view').style.display = 'none';
    document.getElementById('session-view').style.display = 'flex';

    document.getElementById('back-btn').onclick = () => navigate('#/');

    try { state.chatSplit = localStorage.getItem('agenttv_chatSplit') === '1'; } catch {}
    document.getElementById('chat-log').innerHTML = '';
    document.getElementById('event-log').innerHTML = '';
    const viewerLogMasterInit = document.getElementById('viewer-log');
    if (viewerLogMasterInit) viewerLogMasterInit.innerHTML = '';
    applyChatMode();
    getViewerLog().innerHTML = '<div style="padding:20px;color:var(--text-muted)">Loading all streams\u2026</div>';
    const vcc2 = document.getElementById('viewer-chat-count'); if (vcc2) vcc2.textContent = '';
    const alc2 = document.getElementById('agent-log-count'); if (alc2) alc2.textContent = '';

    setupActions('__master__');

    document.getElementById('split-chat-btn').onclick = toggleChatSplit;
    const exportBtn = document.getElementById('export-chat-btn');
    if (exportBtn) exportBtn.onclick = exportChatLog;
    document.getElementById('filter-toggle-btn').onclick = () => {
        const panel = document.getElementById('filters-panel');
        panel.style.display = panel.style.display === 'none' ? 'block' : 'none';
    };

    document.getElementById('expand-chat-btn').onclick = () => {
        state.chatFullscreen = !state.chatFullscreen;
        document.querySelector('.stream-layout').classList.toggle('chat-fullscreen', state.chatFullscreen);
        document.getElementById('expand-chat-btn').textContent = state.chatFullscreen ? '\u229F' : '\u26F6';
        document.getElementById('expand-chat-btn').title = state.chatFullscreen ? 'Exit fullscreen chat' : 'Toggle fullscreen chat';
    };

    document.getElementById('like-count').textContent = state.likes;
    const followBtn = document.getElementById('follow-btn');
    followBtn.textContent = state.following ? '\u2665 Following' : '+ Follow';
    followBtn.classList.toggle('following', state.following);
    if (state.likes > 0) document.getElementById('like-btn').classList.add('liked');

    try {
        const resp = await fetch('/api/master');
        const data = await resp.json();

        state.session = {
            slug: '\uD83D\uDDA5 Master Control Room',
            version: '',
            branch: '',
            agents: data.agents,
            events: data.events,
        };
        state.masterSessionCount = data.session_count;

        initFilters();
        renderMasterSession();
        setupScrollListener();
        updateMasterMonitors(data.events);
        connectMasterWS();

        const canvas = document.getElementById('webcam-canvas');
        startControlRoomAnimation(canvas);
        syncLlmToggleUI();
        if (state.llmEnabled) startViewerChat();
    } catch (e) {
        getViewerLog().innerHTML = '<div style="padding:20px;color:var(--text-muted)">Failed to load master channel</div>';
    }
}


function renderMasterSession() {
    const s = state.session;
    if (!s) return;

    document.getElementById('session-slug').textContent = '\uD83D\uDDA5 Master Control Room';
    document.getElementById('session-meta').textContent = `${state.masterSessionCount} projects \u00b7 All agents`;

    renderDonationGoal();
    renderMasterChatLog(s);
    renderMods(s);
    renderFiles();
    renderViewerCount();
}

function connectMasterWS() {
    const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
    const statusEl = document.getElementById('session-status');
    const liveBadge = document.getElementById('live-badge');

    const ws = connectWithRetry(
        () => new WebSocket(`${proto}//${location.host}/ws/master`),
        statusEl, liveBadge
    );
    ws.onmessage = (e) => {
        const msg = JSON.parse(e.data);
        if (msg.type === 'delta' && state.session && msg.events.length > 0) {
            state.session.events.push(...msg.events);
            Object.assign(state.session.agents, msg.agents);
            if (state.session.events.length > 2000) {
                state.session.events = state.session.events.slice(-2000);
            }

            const lastEvt = msg.events[msg.events.length - 1];
            const evtPath = lastEvt.short_path || lastEvt.file_path || '';
            triggerReaction(lastEvt.type, lastEvt.content);
            updateCodeOverlay(lastEvt.type, lastEvt.content, evtPath);
            bus.emit('agent-event', lastEvt);
            updateMasterMonitors(state.session.events);

            const log = getAgentLog();
            const atBottom = log.scrollTop + log.clientHeight >= log.scrollHeight - 30;
            state.autoScroll = atBottom;

            const masterBaseIdx = state.session.events.length - msg.events.length;
            msg.events.forEach((evt, i) => appendChatMessage(log, evt, state.session, true, masterBaseIdx + i));
            updateChatCounters(state.session);
            renderMods(state.session);
            renderDonationGoal();

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

// ============================================================
// CONTROL ROOM PIXEL ART
// ============================================================

function startControlRoomAnimation(canvas) {
    let frame = 0;
    const id = canvas.dataset.animId || ('' + Math.random());
    canvas.dataset.animId = id;
    if (state.animFrames.has(id)) cancelAnimationFrame(state.animFrames.get(id));

    let lastDraw = 0;
    function animate(ts) {
        state.animFrames.set(id, requestAnimationFrame(animate));
        if (ts - lastDraw < 67) return;
        lastDraw = ts;
        drawControlRoom(canvas, frame);
        frame++;
    }
    state.animFrames.set(id, requestAnimationFrame(animate));
}

// Master-view version of drawRealCode (text-based font rendering)
function drawRealCodeMaster(ctx, mx, my, mw, mh, content, frame) {
    const typeColors = {
        bash: '#ffd700', error: '#ff6666', think: '#ffcc00',
        file_create: '#66ff88', file_update: '#a5d6a7',
        tool_call: '#81d4fa', text: '#c5c8c6', spawn: '#e879a8',
    };
    const textColor = typeColors[content.type] || '#c5c8c6';

    ctx.save();
    ctx.beginPath();
    ctx.rect(mx, my, mw, mh);
    ctx.clip();

    ctx.font = '7px monospace';
    ctx.fillStyle = textColor;

    const lines = (content.text || '').split('\n');
    const lineH = 8;
    const maxLines = Math.floor((mh - 6) / lineH);
    const charsPerLine = Math.floor((mw - 8) / 4.2);

    const scrollOffset = Math.floor(frame * 0.05) % Math.max(1, lines.length);

    for (let r = 0; r < maxLines; r++) {
        const lineIdx = (scrollOffset + r) % lines.length;
        const ly = my + 6 + r * lineH;
        let line = lines[lineIdx] || '';
        if (line.length > charsPerLine) line = line.slice(0, charsPerLine);
        ctx.fillText(line, mx + 4, ly + 6);
    }

    ctx.restore();
}

function drawControlRoom(canvas, frame) {
    const ctx = canvas.getContext('2d');
    const w = canvas.width;
    const h = canvas.height;
    const px = 4;

    ctx.fillStyle = '#060612';
    ctx.fillRect(0, 0, w, h);

    ctx.fillStyle = '#12121e';
    ctx.fillRect(0, h * 0.78, w, h * 0.22);

    const totalSlots = state.masterMonitorContent.length || 6;
    const cols = totalSlots <= 2 ? 2 : totalSlots <= 4 ? 2 : totalSlots <= 6 ? 3 : totalSlots <= 9 ? 3 : 4;
    const rows = Math.ceil(totalSlots / cols);

    const monColors = [
        '#003322', '#001a33', '#1a0033', '#0a1628', '#1a0a00', '#001a00',
        '#002233', '#220033', '#0a2800', '#1a1100', '#001a22', '#110022',
    ];
    const codeColors = [
        ['#00ff41', '#00cc33'], ['#ff6666', '#ff4444'], ['#6699ff', '#4488ff'],
        ['#ffcc00', '#ff9900'], ['#ff66ff', '#ff44ff'], ['#66ffcc', '#44ffaa'],
        ['#ff9966', '#ff7744'], ['#99ff66', '#77ff44'], ['#66ccff', '#44aaff'],
        ['#ff6699', '#ff4477'], ['#ccff66', '#aaff44'], ['#9966ff', '#7744ff'],
    ];
    const ledColors = [
        '#00ff00', '#ff0000', '#ffcc00', '#00ff00', '#00ff00', '#ffcc00',
        '#00ffcc', '#ff6600', '#66ff00', '#ff0066', '#00ff66', '#cc00ff',
    ];

    const wallLeft = w * 0.06;
    const wallRight = w * 0.86;
    const wallTop = h * 0.03;
    const wallBottom = Math.min(h * (0.28 + rows * 0.14), h * 0.72);

    const gap = 4;
    const availW = wallRight - wallLeft;
    const availH = wallBottom - wallTop;
    const mw = (availW - gap * (cols + 1)) / cols;
    const mh = (availH - gap * (rows + 1)) / rows;
    const scanlineSpacing = Math.max(2, Math.floor(mh / 20));
    const labelFont = cols >= 3 ? '7px monospace' : '8px monospace';
    const maxLabelLen = cols >= 3 ? 10 : 12;

    // Wall clock
    const clockX = w * 0.02;
    const clockY = h * 0.02;
    const clockR = Math.min(w, h) * 0.04;
    ctx.fillStyle = '#1a1a2e';
    ctx.beginPath();
    ctx.arc(clockX + clockR, clockY + clockR, clockR, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#252540';
    ctx.beginPath();
    ctx.arc(clockX + clockR, clockY + clockR, clockR - 2, 0, Math.PI * 2);
    ctx.fill();
    const seconds = (frame * 0.5) % 60;
    const minutes = (frame * 0.008) % 60;
    const minAngle = (minutes / 60) * Math.PI * 2 - Math.PI / 2;
    ctx.strokeStyle = '#8888aa';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(clockX + clockR, clockY + clockR);
    ctx.lineTo(clockX + clockR + Math.cos(minAngle) * (clockR * 0.6), clockY + clockR + Math.sin(minAngle) * (clockR * 0.6));
    ctx.stroke();
    const secAngle = (seconds / 60) * Math.PI * 2 - Math.PI / 2;
    ctx.strokeStyle = '#ff4444';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(clockX + clockR, clockY + clockR);
    ctx.lineTo(clockX + clockR + Math.cos(secAngle) * (clockR * 0.75), clockY + clockR + Math.sin(secAngle) * (clockR * 0.75));
    ctx.stroke();
    ctx.fillStyle = '#aaaacc';
    ctx.beginPath();
    ctx.arc(clockX + clockR, clockY + clockR, 2, 0, Math.PI * 2);
    ctx.fill();

    // Draw monitors
    for (let row = 0; row < rows; row++) {
        for (let col = 0; col < cols; col++) {
            const idx = row * cols + col;
            if (idx >= totalSlots) break;

            const mx = wallLeft + gap + col * (mw + gap);
            const my = wallTop + gap + row * (mh + gap);

            ctx.fillStyle = '#2c2c34';
            ctx.fillRect(mx - 2, my - 2, mw + 4, mh + 4);
            ctx.fillStyle = monColors[idx % monColors.length];
            ctx.fillRect(mx, my, mw, mh);
            ctx.fillStyle = 'rgba(0,0,0,0.1)';
            for (let y = my; y < my + mh; y += scanlineSpacing) {
                ctx.fillRect(mx, y, mw, 1);
            }

            const realContent = state.masterMonitorContent[idx];

            if (realContent) {
                drawRealCodeMaster(ctx, mx, my, mw, mh, realContent, frame);
            } else {
                const monMode = (idx + Math.floor(frame / 600)) % 4;
                const scroll = (frame * (0.3 + idx * 0.1)) % 20;
                const cc = codeColors[idx % codeColors.length];

                if (monMode === 1) {
                    for (let r = 0; r < 5; r++) {
                        const ly = my + 4 + r * 6;
                        if (ly >= my + mh - 4) continue;
                        ctx.fillStyle = '#aaaaaa';
                        ctx.fillRect(mx + 4, ly, px, px - 2);
                        ctx.fillStyle = cc[0];
                        const lineLen = Math.floor(mw / px) - 6;
                        for (let c = 0; c < lineLen; c++) {
                            if (((idx * 7 + r + c) * 31) % 100 < 25) continue;
                            ctx.fillRect(mx + 8 + c * (px - 1), ly, px - 2, px - 2);
                        }
                    }
                } else if (monMode === 2) {
                    for (let r = 0; r < 5; r++) {
                        const ly = my + 4 + r * 6;
                        if (ly >= my + mh - 4) continue;
                        const indent = (r * idx) % 3;
                        ctx.fillStyle = r % 2 === 0 ? '#f0c674' : '#c5c8c6';
                        ctx.fillRect(mx + 4 + indent * px, ly, px - 1, px - 2);
                        const nameLen = 3 + (r * idx + 5) % 6;
                        for (let c = 0; c < nameLen; c++) {
                            ctx.fillRect(mx + 4 + indent * px + (c + 2) * (px - 1), ly, px - 2, px - 2);
                        }
                    }
                } else if (monMode === 3) {
                    const logC = ['#00ff41', '#ffcc00', '#ff4444'];
                    for (let r = 0; r < 5; r++) {
                        const ly = my + 4 + r * 6;
                        if (ly >= my + mh - 4) continue;
                        ctx.fillStyle = logC[r % logC.length];
                        const lineLen = Math.floor(mw / px) - 4;
                        for (let c = 0; c < lineLen; c++) {
                            if (((idx * 11 + r + c * 13 + Math.floor(scroll)) * 29) % 100 < 25) continue;
                            ctx.fillRect(mx + 4 + c * (px - 1), ly, px - 2, px - 2);
                        }
                    }
                } else {
                    for (let r = 0; r < 5; r++) {
                        const ly = my + 4 + r * 6;
                        if (ly >= my + mh - 4) continue;
                        const lineSeed = (idx * 7 + r + Math.floor(scroll)) * 31;
                        const lineLen = Math.floor(mw / px) - 4;
                        ctx.fillStyle = cc[r % cc.length];
                        for (let c = 0; c < lineLen; c++) {
                            if ((lineSeed + c * 13) % 100 < 25) continue;
                            const cx2 = mx + 4 + c * (px - 1);
                            if (cx2 + px > mx + mw - 4) break;
                            ctx.fillRect(cx2, ly, px - 2, px - 2);
                        }
                    }
                }
            }

            if (frame % (70 + idx * 11) < 2) {
                ctx.fillStyle = 'rgba(255,255,255,0.03)';
                ctx.fillRect(mx, my, mw, mh);
            }

            const ledState = (frame + idx * 37) % 200 < 180;
            ctx.fillStyle = ledState ? ledColors[idx % ledColors.length] : '#333333';
            ctx.fillRect(mx + mw + 4, my + mh / 2, px, px);

            if (realContent && realContent.project) {
                ctx.font = labelFont;
                ctx.fillStyle = '#888899';
                ctx.textAlign = 'center';
                let label = realContent.project;
                if (label.length > maxLabelLen) label = label.slice(0, maxLabelLen - 1) + '\u2026';
                ctx.fillText(label, mx + mw / 2, my + mh + 12);
                ctx.textAlign = 'start';
            }
        }
    }

    // Console desk
    const deskY = wallBottom + 8;
    const deskH = px * 4;
    ctx.fillStyle = '#1a1a2e';
    ctx.fillRect(w * 0.05, deskY, w * 0.9, deskH);
    ctx.fillStyle = '#252540';
    ctx.fillRect(w * 0.06, deskY, w * 0.88, deskH - 2);
    ctx.fillStyle = '#3a3a5a';
    ctx.fillRect(w * 0.06, deskY, w * 0.88, 1);

    // Server rack
    const rackX = w * 0.92;
    const rackY = h * 0.15;
    const rackW = w * 0.06;
    const rackH = h * 0.55;
    ctx.fillStyle = '#0d0d1a';
    ctx.fillRect(rackX, rackY, rackW, rackH);
    ctx.fillStyle = '#1a1a2e';
    ctx.fillRect(rackX + 2, rackY + 2, rackW - 4, rackH - 4);
    for (let u = 0; u < 8; u++) {
        const uy = rackY + 4 + u * (rackH / 8);
        ctx.fillStyle = '#252540';
        ctx.fillRect(rackX + 4, uy, rackW - 8, rackH / 8 - 3);
        const ledOn = (frame + u * 17) % 60 < 40;
        ctx.fillStyle = ledOn ? '#00ff41' : '#0a2a0a';
        ctx.fillRect(rackX + 6, uy + 3, 3, 3);
        const led2On = (frame + u * 23 + 10) % 90 < 50;
        ctx.fillStyle = led2On ? '#ff6600' : '#2a1a0a';
        ctx.fillRect(rackX + 11, uy + 3, 3, 3);
    }

    // Keyboard
    const kbX = w * 0.38;
    const kbY = deskY + 1;
    const kbW = w * 0.24;
    const kbH = deskH - 2;
    ctx.fillStyle = '#2a2a3a';
    ctx.fillRect(kbX, kbY, kbW, kbH);
    for (let kr = 0; kr < 3; kr++) {
        for (let kc = 0; kc < 12; kc++) {
            const kx = kbX + 2 + kc * (kbW / 12);
            const ky = kbY + 1 + kr * (kbH / 3);
            const isPressed = (frame % 8 < 2) && (kc === (Math.floor(frame / 8) + kr) % 12);
            ctx.fillStyle = isPressed ? '#5a5a7a' : '#3a3a4a';
            ctx.fillRect(kx, ky, kbW / 12 - 1, kbH / 3 - 1);
        }
    }

    // Alert light
    const rxCR = state.reaction;
    const rxCRActive = rxCR && rxCR.startFrame !== -1 && (frame - rxCR.startFrame) < rxCR.duration;
    if (rxCRActive && rxCR.type === 'error') {
        const alertAlpha = Math.sin(frame * 0.5) * 0.3 + 0.3;
        ctx.fillStyle = `rgba(255, 0, 0, ${alertAlpha})`;
        ctx.fillRect(w * 0.45, 0, w * 0.1, px * 2);
        ctx.fillStyle = `rgba(255, 0, 0, ${alertAlpha * 0.3})`;
        ctx.fillRect(w * 0.3, 0, w * 0.4, px * 4);
    }

    // Manager monkey
    const charX = w * 0.44;
    const charY = deskY + deskH + px * 14;
    const mFur = '#6B4226';
    const mFace = '#C4956A';

    ctx.fillStyle = '#1a1a3a';
    ctx.fillRect(charX - px * 4, charY - px * 5, px * 18, px * 9);
    ctx.fillStyle = '#252550';
    ctx.fillRect(charX - px * 3, charY - px * 4, px * 16, px * 7);

    const mTailSwing = Math.sin(frame * 0.05) * px;
    ctx.fillStyle = mFur;
    ctx.fillRect(charX + px * 10 + mTailSwing, charY - px * 2, px, px * 3);
    ctx.fillRect(charX + px * 11 + mTailSwing, charY - px * 3, px, px * 2);

    ctx.fillStyle = mFur;
    ctx.fillRect(charX + px * 1.5, charY - px * 6, px * 7, px * 5);
    ctx.fillStyle = '#9146ff';
    ctx.fillRect(charX + px * 2, charY - px * 5.5, px * 6, px * 4);
    ctx.fillStyle = mFace;
    ctx.fillRect(charX + px * 3.5, charY - px * 5, px * 3, px * 3);

    const scanPhase = Math.sin(frame * 0.03) * px * 2;
    const mhx = charX + px * 3 + scanPhase;
    const mhy = charY - px * 11;

    ctx.fillStyle = mFur;
    ctx.fillRect(mhx, mhy, px * 4, px * 4);
    ctx.fillRect(mhx - px * 0.5, mhy + px * 0.5, px * 5, px * 3);
    ctx.fillRect(mhx + px, mhy - px, px * 2, px);
    ctx.fillRect(mhx - px * 1.5, mhy + px * 0.5, px * 2, px * 2);
    ctx.fillRect(mhx + px * 3.5, mhy + px * 0.5, px * 2, px * 2);
    ctx.fillStyle = mFace;
    ctx.fillRect(mhx - px, mhy + px, px, px);
    ctx.fillRect(mhx + px * 4, mhy + px, px, px);
    ctx.fillRect(mhx + px * 0.5, mhy + px * 1.5, px * 3, px * 2.5);
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(mhx + px * 0.8, mhy + px * 1.8, px, px);
    ctx.fillRect(mhx + px * 2.8, mhy + px * 1.8, px, px);
    ctx.fillStyle = '#331100';
    ctx.fillRect(mhx + px * 0.8, mhy + px * 2, px * 0.5, px * 0.5);
    ctx.fillRect(mhx + px * 2.8, mhy + px * 2, px * 0.5, px * 0.5);
    ctx.fillStyle = mFace;
    ctx.fillRect(mhx + px, mhy + px * 3, px * 2, px * 1.5);
    ctx.fillStyle = '#3a2010';
    ctx.fillRect(mhx + px * 1.2, mhy + px * 3.3, px * 0.4, px * 0.3);
    ctx.fillRect(mhx + px * 2.2, mhy + px * 3.3, px * 0.4, px * 0.3);

    // Banana
    const banX = w * 0.70;
    const banY = deskY - px;
    ctx.fillStyle = '#FFD700';
    ctx.fillRect(banX, banY + px, px * 3, px);
    ctx.fillRect(banX + px * 0.5, banY, px * 2, px);
    ctx.fillStyle = '#8B6914';
    ctx.fillRect(banX + px * 2.5, banY - px * 0.5, px * 0.5, px * 0.5);

    // Coffee mug
    const mugX = w * 0.25;
    const mugY = deskY;
    ctx.fillStyle = '#e0e0e0';
    ctx.fillRect(mugX, mugY - px * 3, px * 2, px * 2);
    ctx.fillStyle = '#8b4513';
    ctx.fillRect(mugX + px * 0.3, mugY - px * 2.5, px * 1.4, px * 1.2);
    ctx.fillStyle = '#e0e0e0';
    ctx.fillRect(mugX + px * 2, mugY - px * 2.5, px * 0.5, px);
    for (let s = 0; s < 2; s++) {
        const stCy = ((frame * 0.7 + s * 20) % 30) / 30;
        ctx.fillStyle = `rgba(200,200,200,${0.25 * (1 - stCy)})`;
        ctx.fillRect(mugX + px * 0.5 + Math.sin(frame * 0.1 + s) * 2, mugY - px * 4 - stCy * px * 3, 2, 2);
    }

    // Arms
    const phonePhase = frame % 600;
    const onPhone = phonePhase < 80;
    ctx.fillStyle = mFur;
    if (onPhone) {
        ctx.fillRect(charX - px, charY - px * 3, px * 2, px * 3);
        ctx.fillRect(charX + px * 7 + scanPhase, charY - px * 10, px * 2, px * 3);
        ctx.fillStyle = mFace;
        ctx.fillRect(charX - px, charY - px * 3, px * 1.5, px * 1.5);
        ctx.fillRect(charX + px * 7 + scanPhase, charY - px * 10, px * 1.5, px * 1.5);
        ctx.fillStyle = '#333344';
        ctx.fillRect(charX + px * 7 + scanPhase, charY - px * 11, px * 2, px * 3);
    } else {
        ctx.fillRect(charX - px, charY - px * 3, px * 2, px * 3);
        ctx.fillRect(charX + px * 9, charY - px * 3, px * 2, px * 3);
        ctx.fillStyle = mFace;
        ctx.fillRect(charX - px, charY - px * 3, px * 1.5, px * 1.5);
        ctx.fillRect(charX + px * 9.5, charY - px * 3, px * 1.5, px * 1.5);
    }

    // Reaction overlays
    const rx = state.reaction;
    const rxActive = rx && rx.startFrame !== -1 && (frame - rx.startFrame) < rx.duration;
    if (rxActive && rx.type === 'error') {
        const p = (frame - rx.startFrame) / rx.duration;
        if (p < 0.3) {
            ctx.fillStyle = `rgba(255, 0, 0, ${0.15 * Math.sin(p * Math.PI / 0.3)})`;
            ctx.fillRect(0, 0, w, h);
        }
    }
    if (rxActive && rx.type === 'complete') {
        drawCelebration(ctx, w, h, px, frame, rx.startFrame);
    }

    ctx.fillStyle = 'rgba(100, 130, 255, 0.03)';
    ctx.fillRect(0, 0, w, h * 0.7);
}

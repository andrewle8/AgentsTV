/* AgentsTV — Twitch-style agent session viewer */

const TUNING_DEFAULTS = {
    chatSpeed: 'normal',       // slow | normal | fast
    narratorFreq: 20,          // seconds (center of random range)
    tipChance: 15,             // percent
    reactionChance: 50,        // percent
    bufferSize: 10,            // messages
    overlayDuration: 15,       // seconds
};

function loadTuning() {
    try {
        const raw = localStorage.getItem('agenttv_tuning');
        return raw ? { ...TUNING_DEFAULTS, ...JSON.parse(raw) } : { ...TUNING_DEFAULTS };
    } catch { return { ...TUNING_DEFAULTS }; }
}

function saveTuning(t) {
    state.tuning = t;
    try { localStorage.setItem('agenttv_tuning', JSON.stringify(t)); } catch {}
}

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

// Pixel art palettes for code monkeys
const PALETTES = [
    { fur: '#8B5E3C', face: '#D4A574', belly: '#C8A882', shirt: '#9146ff', monitor: '#003322', chair: '#252540' },
    { fur: '#6B4226', face: '#C4956A', belly: '#B8946E', shirt: '#eb0400', monitor: '#001a33', chair: '#402525' },
    { fur: '#A0724A', face: '#E0C09A', belly: '#D4B68C', shirt: '#00b4d8', monitor: '#1a0033', chair: '#253040' },
    { fur: '#5C3D2E', face: '#BA8A60', belly: '#AE845C', shirt: '#f0c674', monitor: '#0a1628', chair: '#403825' },
    { fur: '#7A5230', face: '#D8B080', belly: '#CCA474', shirt: '#00e676', monitor: '#1a0a00', chair: '#254025' },
    { fur: '#9B6B40', face: '#E8C8A0', belly: '#DCBC94', shirt: '#81d4fa', monitor: '#001a00', chair: '#253545' },
];

// Desk setup variations — each seed picks one
const DESK_SETUPS = [
    'single',       // basic single monitor
    'dual',         // dual monitors
    'ultrawide',    // one wide monitor
    'laptop',       // laptop on desk
    'single',       // repeat for distribution
    'dual',
];

// Desk decoration sets
const DECORATIONS = [
    ['coffee', 'plant'],
    ['coffee', 'cat'],
    ['soda', 'figurine'],
    ['coffee', 'lamp'],
    ['energy', 'poster'],
    ['coffee', 'duck'],
    ['soda', 'plant', 'cat'],
    ['coffee', 'lamp', 'figurine'],
    ['energy', 'poster', 'duck'],
    ['coffee', 'plant', 'lamp'],
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
    // Webcam reaction state
    reaction: null,       // current reaction: {type, startFrame, duration}
    typingSpeed: 1.0,     // multiplier for typing animation speed
    sessionFilePath: '',  // for localStorage key
    chatFullscreen: false,
    viewerChatTimer: null,
    narratorChatTimer: null,
    monitorContent: null,  // latest code/text to show on monitor
    monitorContentType: null, // event type for styling
    llmEnabled: true,         // LLM on/off toggle
    replyToEventIndex: null,  // index of event being replied to
    viewerAutoScroll: true,
    viewerMsgCount: 0,
    agentMsgCount: 0,
    // Master channel state
    masterEvents: [],
    masterAgents: {},
    masterSessionCount: 0,
    // Code overlay state
    _lastEventFilePath: '',
    codeOverlayTimer: null,
    // Master monitor real content
    masterMonitorContent: [],
    // Tuning settings (localStorage)
    tuning: loadTuning(),
};

// ============================================================
// SETTINGS PANEL
// ============================================================

async function openSettings() {
    const overlay = document.getElementById('settings-overlay');
    overlay.style.display = 'flex';
    document.getElementById('settings-msg').textContent = '';
    try {
        const resp = await fetch('/api/settings');
        const cfg = await resp.json();
        document.getElementById('s-provider').value = cfg.provider || 'ollama';
        document.getElementById('s-ollama-url').value = cfg.ollama_url || '';
        document.getElementById('s-openai-key').value = '';
        document.getElementById('s-openai-key').placeholder = cfg.openai_key || 'sk-…';
        document.getElementById('s-openai-model').value = cfg.openai_model || '';
        // Fetch available Ollama models for the dropdown
        await populateOllamaModels(cfg.ollama_model || 'qwen3:14b');
        toggleProviderFields();
        // Populate tuning fields
        const t = state.tuning;
        document.getElementById('s-chat-speed').value = t.chatSpeed;
        document.getElementById('s-narrator-freq').value = t.narratorFreq;
        document.getElementById('s-narrator-freq-val').textContent = t.narratorFreq + 's';
        document.getElementById('s-tip-chance').value = t.tipChance;
        document.getElementById('s-tip-chance-val').textContent = t.tipChance + '%';
        document.getElementById('s-reaction-chance').value = t.reactionChance;
        document.getElementById('s-reaction-chance-val').textContent = t.reactionChance + '%';
        document.getElementById('s-buffer-size').value = t.bufferSize;
        document.getElementById('s-overlay-duration').value = t.overlayDuration;
        document.getElementById('s-overlay-duration-val').textContent = t.overlayDuration + 's';
    } catch (e) {
        document.getElementById('settings-msg').textContent = 'Failed to load settings';
        document.getElementById('settings-msg').className = 'settings-msg err';
    }
}

async function populateOllamaModels(currentModel) {
    const select = document.getElementById('s-ollama-model');
    const fallback = document.getElementById('s-ollama-model-fallback');
    try {
        const resp = await fetch('/api/ollama-models');
        const data = await resp.json();
        if (data.models && data.models.length > 0) {
            select.innerHTML = data.models.map(m =>
                `<option value="${esc(m)}"${m === currentModel ? ' selected' : ''}>${esc(m)}</option>`
            ).join('');
            // If current model isn't in the list, add it
            if (currentModel && !data.models.includes(currentModel)) {
                select.insertAdjacentHTML('afterbegin',
                    `<option value="${esc(currentModel)}" selected>${esc(currentModel)}</option>`);
            }
            select.style.display = '';
            fallback.style.display = 'none';
        } else {
            // Fallback to text input
            select.style.display = 'none';
            fallback.style.display = '';
            fallback.value = currentModel;
        }
    } catch (e) {
        select.style.display = 'none';
        fallback.style.display = '';
        fallback.value = currentModel;
    }
}

function closeSettings() {
    document.getElementById('settings-overlay').style.display = 'none';
}

function toggleProviderFields() {
    const provider = document.getElementById('s-provider').value;
    document.getElementById('s-ollama-fields').style.display = provider === 'ollama' ? '' : 'none';
    document.getElementById('s-openai-fields').style.display = provider === 'openai' ? '' : 'none';
}

function syncLlmToggleUI(cfg) {
    const btn = document.getElementById('llm-toggle-btn');
    const label = document.getElementById('llm-model-label');
    const input = document.getElementById('chat-input');
    const sendBtn = document.getElementById('chat-send-btn');
    if (!btn) return;
    if (state.llmEnabled) {
        btn.classList.remove('llm-off');
        btn.title = 'LLM is on — click to disable';
        if (input) { input.disabled = false; input.placeholder = 'Ask about this stream...'; }
        if (sendBtn) sendBtn.disabled = false;
    } else {
        btn.classList.add('llm-off');
        btn.title = 'LLM is off — click to enable';
        if (input) { input.disabled = true; input.placeholder = 'LLM is off — enable in settings or toggle'; }
        if (sendBtn) sendBtn.disabled = true;
    }
    // Show active model label
    if (label) {
        if (cfg) {
            _updateModelLabel(label, cfg);
        } else {
            fetch('/api/settings').then(r => r.json()).then(c => _updateModelLabel(label, c)).catch(() => {});
        }
    }
}

function _updateModelLabel(label, cfg) {
    if (cfg.provider === 'off') {
        label.textContent = 'off';
    } else if (cfg.provider === 'openai') {
        label.textContent = cfg.openai_model || 'openai';
    } else {
        label.textContent = cfg.ollama_model || 'ollama';
    }
    label.title = 'Active LLM: ' + label.textContent;
}

async function saveSettings(e) {
    e.preventDefault();
    const msg = document.getElementById('settings-msg');
    const body = { provider: document.getElementById('s-provider').value };
    if (body.provider === 'ollama') {
        body.ollama_url = document.getElementById('s-ollama-url').value;
        // Use select if visible, fallback text input otherwise
        const select = document.getElementById('s-ollama-model');
        const fallback = document.getElementById('s-ollama-model-fallback');
        body.ollama_model = select.style.display !== 'none' ? select.value : fallback.value;
    } else if (body.provider === 'openai') {
        const key = document.getElementById('s-openai-key').value;
        if (key) body.openai_key = key;
        body.openai_model = document.getElementById('s-openai-model').value;
    }
    try {
        const resp = await fetch('/api/settings', {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
        });
        if (!resp.ok) throw new Error('Save failed');
        // Save tuning to localStorage
        saveTuning({
            chatSpeed: document.getElementById('s-chat-speed').value,
            narratorFreq: parseInt(document.getElementById('s-narrator-freq').value, 10),
            tipChance: parseInt(document.getElementById('s-tip-chance').value, 10),
            reactionChance: parseInt(document.getElementById('s-reaction-chance').value, 10),
            bufferSize: parseInt(document.getElementById('s-buffer-size').value, 10),
            overlayDuration: parseInt(document.getElementById('s-overlay-duration').value, 10),
        });
        // Flush stale messages from old model and sync toggle state
        viewerChatQueue.length = 0;
        viewerChatFetching = false;
        state.llmEnabled = body.provider !== 'off';
        syncLlmToggleUI(body);
        if (!state.llmEnabled) {
            stopNarratorChat();
        } else if (state.view === 'session' || state.view === 'master') {
            fetchViewerChatBatch();
            startNarratorChat();
        }
        msg.textContent = 'Saved';
        msg.className = 'settings-msg ok';
        setTimeout(closeSettings, 800);
    } catch (e) {
        msg.textContent = 'Error saving settings';
        msg.className = 'settings-msg err';
    }
}

(function initSettings() {
    document.getElementById('settings-btn').addEventListener('click', openSettings);
    document.getElementById('settings-close-btn').addEventListener('click', closeSettings);
    document.getElementById('settings-overlay').addEventListener('click', function(e) {
        if (e.target === this) closeSettings();
    });
    document.getElementById('s-provider').addEventListener('change', toggleProviderFields);
    document.getElementById('settings-form').addEventListener('submit', saveSettings);
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') closeSettings();
    });
    // Tuning section toggle
    document.getElementById('tuning-toggle').addEventListener('click', () => {
        const fields = document.getElementById('tuning-fields');
        const toggle = document.getElementById('tuning-toggle');
        const open = fields.style.display === 'none';
        fields.style.display = open ? '' : 'none';
        toggle.textContent = (open ? '▾' : '▸') + ' Tuning';
    });
    // Range input live display
    for (const [id, suffix] of [['s-narrator-freq', 's'], ['s-tip-chance', '%'], ['s-reaction-chance', '%'], ['s-overlay-duration', 's']]) {
        document.getElementById(id).addEventListener('input', () => {
            document.getElementById(id + '-val').textContent = document.getElementById(id).value + suffix;
        });
    }
    // Fetch initial LLM state to set toggle + model label
    fetch('/api/settings').then(r => r.json()).then(cfg => {
        state.llmEnabled = cfg.provider !== 'off';
        syncLlmToggleUI(cfg);
    }).catch(() => {});
})();

// ============================================================
// LLM TOGGLE
// ============================================================

let _previousProvider = 'ollama';

(function initLlmToggle() {
    const btn = document.getElementById('llm-toggle-btn');
    if (!btn) return;
    btn.addEventListener('click', async () => {
        try {
            let newProvider;
            if (state.llmEnabled) {
                // Save current provider before turning off
                const cfg = await fetch('/api/settings').then(r => r.json());
                _previousProvider = cfg.provider || 'ollama';
                newProvider = 'off';
            } else {
                newProvider = _previousProvider;
            }
            await fetch('/api/settings', {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ provider: newProvider }),
            });
            viewerChatQueue.length = 0;
            viewerChatFetching = false;
            state.llmEnabled = !state.llmEnabled;
            syncLlmToggleUI();
            if (!state.llmEnabled) {
                stopNarratorChat();
            } else if (state.view === 'session' || state.view === 'master') {
                fetchViewerChatBatch();
                startNarratorChat();
            }
        } catch (e) {
            // silently fail
        }
    });
})();

// ============================================================
// INTERACTIVE CHAT INPUT
// ============================================================

(function initChatInput() {
    const input = document.getElementById('chat-input');
    const sendBtn = document.getElementById('chat-send-btn');
    const replyPreview = document.getElementById('chat-reply-preview');
    const replyText = document.getElementById('chat-reply-text');
    const replyCancel = document.getElementById('chat-reply-cancel');

    if (!input || !sendBtn) return;

    async function sendMessage() {
        const msg = input.value.trim();
        if (!msg || !state.llmEnabled || sendBtn.disabled) return;

        const log = document.getElementById('viewer-log') || document.getElementById('event-log');
        input.value = '';
        sendBtn.disabled = true;

        // Add user message to chat
        const userDiv = document.createElement('div');
        userDiv.className = 'chat-msg user-chat';
        userDiv.innerHTML = `<span class="chat-badge">💬</span>`
            + `<span class="chat-name" style="color:var(--purple-light)">you</span>`
            + `<span class="chat-text">${esc(msg)}</span>`;
        log.appendChild(userDiv);
        updateViewerCount();

        // Show thinking state in input bar
        input.placeholder = 'thinking...';
        input.classList.add('thinking');
        if (state.viewerAutoScroll) log.scrollTop = log.scrollHeight;

        // Build request
        const body = {
            message: msg,
            session_id: state.sessionFilePath || '',
        };
        if (state.replyToEventIndex !== null) {
            body.reply_to_event_index = state.replyToEventIndex;
        }

        try {
            const resp = await fetch('/api/chat', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(body),
            });
            const data = await resp.json();

            const replyDiv = document.createElement('div');
            replyDiv.className = 'chat-msg llm-reply';
            if (data.reply) {
                replyDiv.innerHTML = `<span class="chat-badge">&#x1F9E0;</span>`
                    + `<span class="chat-name" style="color:var(--green)">codemonkey_mod</span>`
                    + `<span class="chat-text">${esc(data.reply)}</span>`;
            } else {
                replyDiv.innerHTML = `<span class="chat-badge">&#x1F9E0;</span>`
                    + `<span class="chat-name" style="color:var(--green)">codemonkey_mod</span>`
                    + `<span class="chat-text" style="color:var(--text-muted)">${esc(data.error || 'No response')}</span>`;
            }
            log.appendChild(replyDiv);
            updateViewerCount();
            // Schedule viewer reactions to user's message
            reactToUserChat(msg);
        } catch (e) {
            const errDiv = document.createElement('div');
            errDiv.className = 'chat-msg llm-reply';
            errDiv.innerHTML = `<span class="chat-badge">&#x1F9E0;</span>`
                + `<span class="chat-name" style="color:var(--green)">codemonkey_mod</span>`
                + `<span class="chat-text" style="color:var(--red-soft)">Failed to reach LLM</span>`;
            log.appendChild(errDiv);
            updateViewerCount();
        } finally {
            // Always re-enable send
            state.replyToEventIndex = null;
            if (replyPreview) replyPreview.style.display = 'none';
            input.placeholder = 'Ask about this stream...';
            input.classList.remove('thinking');
            sendBtn.disabled = false;
            input.focus();
            if (state.viewerAutoScroll) log.scrollTop = log.scrollHeight;
        }
    }

    sendBtn.addEventListener('click', sendMessage);
    input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            sendMessage();
        }
    });

    if (replyCancel) {
        replyCancel.addEventListener('click', () => {
            state.replyToEventIndex = null;
            replyPreview.style.display = 'none';
        });
    }
})();

function setReplyToEvent(index, summary) {
    state.replyToEventIndex = index;
    const preview = document.getElementById('chat-reply-preview');
    const text = document.getElementById('chat-reply-text');
    if (preview && text) {
        text.textContent = summary || `Event #${index}`;
        preview.style.display = 'flex';
    }
    const input = document.getElementById('chat-input');
    if (input && !input.disabled) input.focus();
}

// ============================================================
// PERSISTENT TIPS (localStorage)
// ============================================================

function getTipKey(filePath) { return 'agenttv_tips_' + hashCode(filePath); }
function getLikeKey(filePath) { return 'agenttv_likes_' + hashCode(filePath); }
function getFollowKey(filePath) { return 'agenttv_follow_' + hashCode(filePath); }

function loadPersistedState(filePath) {
    try {
        state.tips = parseInt(localStorage.getItem(getTipKey(filePath)) || '0');
        state.likes = parseInt(localStorage.getItem(getLikeKey(filePath)) || '0');
        state.following = localStorage.getItem(getFollowKey(filePath)) === '1';
    } catch (e) { /* localStorage unavailable */ }
}

function persistTips(filePath) {
    try { localStorage.setItem(getTipKey(filePath), String(state.tips)); } catch (e) {}
}
function persistLikes(filePath) {
    try { localStorage.setItem(getLikeKey(filePath), String(state.likes)); } catch (e) {}
}
function persistFollow(filePath) {
    try { localStorage.setItem(getFollowKey(filePath), state.following ? '1' : '0'); } catch (e) {}
}

// ============================================================
// WEBCAM REACTIONS
// ============================================================

function triggerReaction(type, content) {
    // Queue a visual reaction on the webcam canvas
    state.reaction = { type, startFrame: -1, duration: getReactionDuration(type) };
    // Update monitor content if we have text to show
    if (content && typeof content === 'string' && content.length > 5) {
        state.monitorContent = content;
        state.monitorContentType = type;
    }
    // Adjust typing speed based on event type
    if (type === 'bash' || type === 'tool_call' || type === 'file_update' || type === 'file_create') {
        state.typingSpeed = 3.0;
        setTimeout(() => { state.typingSpeed = 1.0; }, 2000);
    } else if (type === 'think') {
        state.typingSpeed = 0.3;
        setTimeout(() => { state.typingSpeed = 1.0; }, 3000);
    } else if (type === 'error') {
        state.typingSpeed = 0;
        setTimeout(() => { state.typingSpeed = 1.0; }, 2500);
    }
}

function getReactionDuration(type) {
    switch (type) {
        case 'error': return 80;
        case 'spawn': return 60;
        case 'complete': return 90;
        case 'think': return 50;
        case 'user': return 40;
        default: return 30;
    }
}

// ============================================================
// CODE OVERLAY
// ============================================================

function updateCodeOverlay(type, content, filePath) {
    const overlay = document.getElementById('code-overlay');
    if (!overlay) return;

    // Skip short or empty content
    if (!content || typeof content !== 'string' || content.length <= 20) return;

    const typeEl = document.getElementById('code-overlay-type');
    const fileEl = document.getElementById('code-overlay-file');
    const bodyEl = document.getElementById('code-overlay-body');

    // Header: type badge
    const label = EVENT_LABELS[type] || type;
    const icon = ICONS[type] || '';
    typeEl.textContent = `${icon} ${label}`;
    typeEl.className = 'code-overlay-type type-' + type;

    // Header: filename
    fileEl.textContent = filePath || '';

    // Body: truncate to 100 lines
    let lines = content.split('\n');
    if (lines.length > 100) lines = lines.slice(0, 100);
    bodyEl.textContent = lines.join('\n');
    bodyEl.className = 'code-overlay-body content-' + type;

    // Show with fade-in
    overlay.classList.add('visible');

    // Reset auto-hide timer
    if (state.codeOverlayTimer) clearTimeout(state.codeOverlayTimer);
    state.codeOverlayTimer = setTimeout(() => {
        overlay.classList.remove('visible');
        state.codeOverlayTimer = null;
    }, (state.tuning.overlayDuration || 15) * 1000);
}

function hideCodeOverlay() {
    const overlay = document.getElementById('code-overlay');
    if (overlay) overlay.classList.remove('visible');
    if (state.codeOverlayTimer) {
        clearTimeout(state.codeOverlayTimer);
        state.codeOverlayTimer = null;
    }
}

// ============================================================
// MCR REAL MONITOR CONTENT
// ============================================================

function updateMasterMonitors(events) {
    const contentTypes = ['file_create', 'file_update', 'bash', 'tool_call', 'text', 'think', 'error'];
    const byProject = {};

    // Walk backwards to get latest content-bearing event per project
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

    // Fill slots to match dynamic grid size
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
// PIXEL ART ENGINE
// ============================================================

function drawPixelScene(canvas, seed, frame, isLarge) {
    const ctx = canvas.getContext('2d');
    const w = canvas.width;
    const h = canvas.height;
    const px = isLarge ? 4 : 3;
    const palette = PALETTES[seed % PALETTES.length];
    const setup = DESK_SETUPS[seed % DESK_SETUPS.length];
    const decor = DECORATIONS[seed % DECORATIONS.length];

    // Reaction state
    let rx = state.reaction;
    if (rx && rx.startFrame === -1) rx.startFrame = frame;
    const rxActive = rx && (frame - rx.startFrame) < rx.duration;
    const rxType = rxActive ? rx.type : null;
    const rxProgress = rxActive ? (frame - rx.startFrame) / rx.duration : 0;

    // Clear expired reactions
    if (rx && !rxActive && rx.startFrame !== -1) state.reaction = null;

    // Background — flash red on error
    if (rxType === 'error' && rxProgress < 0.3) {
        const flash = Math.sin(rxProgress * Math.PI / 0.3) * 0.3;
        ctx.fillStyle = `rgb(${Math.floor(10 + flash * 120)}, ${Math.floor(10)}, ${Math.floor(24)})`;
    } else {
        ctx.fillStyle = '#0a0a18';
    }
    ctx.fillRect(0, 0, w, h);

    // Wall detail — poster/window based on decor
    if (decor.includes('poster')) {
        drawPoster(ctx, w, h, px, seed, frame);
    }

    // Window with moonlight for some setups
    if (seed % 3 === 0) {
        drawWindow(ctx, w, h, px, frame, seed);
    }

    // Floor
    ctx.fillStyle = '#1a1a2e';
    ctx.fillRect(0, h * 0.72, w, h * 0.28);
    ctx.fillStyle = '#151528';
    for (let x = 0; x < w; x += px * 8) {
        ctx.fillRect(x, h * 0.72, px * 4, h * 0.28);
    }

    // Desk (shakes 1px on error)
    const deskY = h * 0.55;
    const deskH = px * 4;
    const deskShake = (rxType === 'error' && rxProgress < 0.3) ? Math.sin(frame * 2) * 1 : 0;
    const deskColor = seed % 2 === 0 ? '#3d2b1f' : '#2c3e50';
    ctx.fillStyle = deskColor;
    ctx.fillRect(w * 0.12 + deskShake, deskY, w * 0.76, deskH);
    ctx.fillStyle = darken(deskColor, 30);
    ctx.fillRect(w * 0.12, deskY + deskH, w * 0.76, px);

    // Desk legs
    ctx.fillStyle = darken(deskColor, 30);
    ctx.fillRect(w * 0.15, deskY + deskH, px * 2, h * 0.17);
    ctx.fillRect(w * 0.81, deskY + deskH, px * 2, h * 0.17);

    // Character sits behind the desk — drawn before monitors so it peeks out
    const typingMult = isLarge ? state.typingSpeed : 1.0;
    const charX = w * 0.42;
    const charY = deskY - px * 8; // shifted up so head peeks above monitor

    // Chair (behind everything)
    ctx.fillStyle = darken(palette.chair, 20);
    ctx.fillRect(charX - px * 2, charY - px * 4, px * 14, px * 8);
    ctx.fillStyle = palette.chair;
    ctx.fillRect(charX - px, charY - px * 3, px * 12, px * 6);

    // Character body + head (behind monitor, head peeks above)
    drawCharacter(ctx, w, h, px, palette, charX, charY, deskY, frame, rxType, rxProgress, typingMult);

    // Monitor(s) based on setup — drawn after character so desk/monitor is in front
    drawMonitorSetup(ctx, w, h, px, setup, palette, seed, frame, deskY, rxType, rxProgress, typingMult, isLarge, canvas);

    // Keyboard with dynamic key lighting (on desk, in front of monkey)
    ctx.fillStyle = '#3a3a44';
    ctx.fillRect(charX - px, deskY - px * 2, px * 12, px * 2);
    for (let k = 0; k < 5; k++) {
        let keyColor;
        if (rxType === 'error') {
            keyColor = '#ff3333'; // flash red on error
        } else if (rxType === 'complete') {
            // Rainbow sweep
            const hue = ((k * 60 + frame * 8) % 360);
            keyColor = `hsl(${hue}, 80%, 60%)`;
        } else if (rxType === 'think') {
            keyColor = '#2a2a33'; // dark during think (hands off)
        } else {
            // Random key lighting during typing
            const keyActive = ((seed * 3 + k * 7 + Math.floor(frame * typingMult * 0.3)) % 5 === 0);
            keyColor = keyActive ? '#7a7a88' : '#4a4a55';
        }
        ctx.fillStyle = keyColor;
        ctx.fillRect(charX + k * px * 2, deskY - px * 2, px, px);
    }
    // Keyboard sparks during fast typing
    if (typingMult > 2 && frame % 3 === 0) {
        const sparkX = charX + ((frame * 7 + seed) % 10) * px;
        ctx.fillStyle = 'rgba(255,200,50,0.5)';
        ctx.fillRect(sparkX, deskY - px * 3, px * 0.5, px * 0.5);
    }

    // Decorations
    for (const d of decor) {
        drawDecoration(ctx, w, h, px, d, seed, frame, deskY);
    }

    // Monitor glow on wall
    drawMonitorGlow(ctx, w, h, px, setup, palette, frame);

    // Celebration particles on complete
    if (rxType === 'complete') {
        drawCelebration(ctx, w, h, px, frame, rx.startFrame);
        // Fist pump checkmark on monitor
        if (rxProgress < 0.6) {
            ctx.fillStyle = '#00ff41';
            const cmx = w * 0.48, cmy = h * 0.25;
            ctx.fillRect(cmx, cmy + px * 2, px, px);
            ctx.fillRect(cmx + px, cmy + px * 3, px, px);
            ctx.fillRect(cmx + px * 2, cmy + px * 2, px, px);
            ctx.fillRect(cmx + px * 3, cmy + px, px, px);
            ctx.fillRect(cmx + px * 4, cmy, px, px);
        }
        // Gold sparkles
        for (let i = 0; i < 8; i++) {
            const sx = charX + px * 5 + Math.sin(frame * 0.3 + i * 0.8) * px * 8;
            const sy = charY - px * 14 - Math.abs(Math.sin(frame * 0.2 + i)) * px * 6;
            ctx.fillStyle = `rgba(255, 215, 0, ${0.5 + Math.sin(frame * 0.5 + i) * 0.3})`;
            ctx.fillRect(sx, sy, px * 0.5, px * 0.5);
        }
    }

    // Spawn — purple rings radiate outward
    if (rxType === 'spawn') {
        for (let ring = 0; ring < 3; ring++) {
            const ringProgress = rxProgress - ring * 0.15;
            if (ringProgress < 0 || ringProgress > 0.7) continue;
            const radius = ringProgress * px * 20;
            const alpha = 0.3 * (1 - ringProgress / 0.7);
            ctx.strokeStyle = `rgba(145, 70, 255, ${alpha})`;
            ctx.lineWidth = 2;
            ctx.beginPath();
            ctx.arc(charX + px * 5, charY - px * 6, radius, 0, Math.PI * 2);
            ctx.stroke();
        }
    }

    // Error — red ! above head, desk shake via slight render offset
    if (rxType === 'error' && rxProgress < 0.5) {
        ctx.fillStyle = '#ff4444';
        const bangX = charX + px * 5, bangY = charY - px * 16;
        ctx.fillRect(bangX, bangY, px, px * 3);
        ctx.fillRect(bangX, bangY + px * 4, px, px);
    }

    // Think — thought bubble dots
    if (rxType === 'think') {
        const dotPhase = Math.floor(frame / 12) % 4;
        ctx.fillStyle = 'rgba(255,255,255,0.6)';
        for (let i = 0; i < Math.min(dotPhase, 3); i++) {
            ctx.fillRect(charX + px * 8 + i * px * 2, charY - px * 14 - i * px, px, px);
        }
    }

    // User — wave, ? speech bubble
    if (rxType === 'user' && rxProgress < 0.6) {
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(charX + px * 10, charY - px * 12, px * 2, px * 2);
        ctx.fillRect(charX + px * 10.5, charY - px * 11, px, px);
    }

    // Bash — lightning bolt above keyboard
    if (rxType === 'bash' && rxProgress < 0.4) {
        ctx.fillStyle = '#ffff00';
        const bx = charX + px * 5, by = deskY - px * 5;
        ctx.fillRect(bx + px, by, px, px);
        ctx.fillRect(bx, by + px, px * 2, px);
        ctx.fillRect(bx + px, by + px * 2, px, px);
    }

    // Ambient dust motes — 12 with varied sizes
    for (let i = 0; i < 12; i++) {
        const pSeed = (seed * 13 + i * 7) % 1000;
        const speed = 0.1 + (pSeed % 5) * 0.05;
        const dx = (pSeed + frame * speed * 0.3) % w;
        const dy = ((pSeed * 3 + frame * speed) % (h * 0.7));
        const size = 1 + (pSeed % 2);
        ctx.fillStyle = `rgba(255,255,255,${0.03 + (pSeed % 10) * 0.006})`;
        ctx.fillRect(dx, dy, size, size);
    }

    // Monitor light particles drifting from screen
    if (isLarge) {
        for (let i = 0; i < 4; i++) {
            const mp = (seed * 3 + i * 11 + frame) % 500;
            const mx = w * 0.35 + (mp % Math.floor(w * 0.3));
            const my = h * 0.3 + (mp * 0.4) % (h * 0.2);
            ctx.fillStyle = 'rgba(0, 255, 65, 0.04)';
            ctx.fillRect(mx, my, 1, 1);
        }
    }
}

function drawMonitorSetup(ctx, w, h, px, setup, palette, seed, frame, deskY, rxType, rxProgress, typingMult, isLarge, canvas) {
    const scrollSpeed = 0.5 * typingMult;
    const mc = canvas && canvas._monitorContent;

    if (setup === 'dual') {
        drawMonitor(ctx, w * 0.22, deskY - px * 18, px * 18, px * 14, px, palette, seed, frame, scrollSpeed, rxType, rxProgress, isLarge, mc);
        drawMonitor(ctx, w * 0.52, deskY - px * 18, px * 18, px * 14, px, palette, seed + 7, frame, scrollSpeed * 0.6, rxType, rxProgress, false, null);
    } else if (setup === 'ultrawide') {
        drawMonitor(ctx, w * 0.22, deskY - px * 16, px * 36, px * 14, px, palette, seed, frame, scrollSpeed, rxType, rxProgress, isLarge, mc);
    } else if (setup === 'laptop') {
        const lx = w * 0.32;
        const ly = deskY - px * 14;
        const lw = px * 24;
        const lh = px * 12;
        ctx.fillStyle = '#3a3a44';
        ctx.fillRect(lx - px, deskY - px * 2, lw + px * 2, px * 2);
        drawMonitor(ctx, lx, ly, lw, lh, px, palette, seed, frame, scrollSpeed, rxType, rxProgress, isLarge, mc);
    } else {
        drawMonitor(ctx, w * 0.32, deskY - px * 18, px * 28, px * 16, px, palette, seed, frame, scrollSpeed, rxType, rxProgress, isLarge, mc);
    }
}

function drawMonitor(ctx, monX, monY, monW, monH, px, palette, seed, frame, scrollSpeed, rxType, rxProgress, isLarge, monitorContent) {
    // Bezel
    ctx.fillStyle = '#2c2c34';
    ctx.fillRect(monX - px, monY - px, monW + px * 2, monH + px * 2);

    // Screen
    let screenColor = palette.monitor;
    if (rxType === 'error' && rxProgress < 0.5) {
        // BSOD flash
        screenColor = (Math.floor(rxProgress * 10) % 2 === 0) ? '#0000aa' : palette.monitor;
    }
    ctx.fillStyle = screenColor;
    ctx.fillRect(monX, monY, monW, monH);

    // Scanlines
    ctx.fillStyle = 'rgba(0,0,0,0.12)';
    for (let y = monY; y < monY + monH; y += px * 2) {
        ctx.fillRect(monX, y, monW, 1);
    }

    // Screen content — dynamic modes unless reaction override
    if (rxType === 'error' && rxProgress < 0.5) {
        drawErrorScreen(ctx, monX, monY, monW, monH, px, rxProgress);
        // Skull icon
        ctx.fillStyle = '#ff4444';
        ctx.fillRect(monX + monW / 2 - px, monY + monH - px * 4, px * 2, px * 2);
    } else if (rxType === 'think') {
        drawThinkingScreen(ctx, monX, monY, monW, monH, px, frame);
    } else {
        const mc = monitorContent || (isLarge ? state.monitorContent : null);
        const mcText = mc ? (mc._text || mc) : null;
        const mcType = mc ? (monitorContent ? monitorContent._type : state.monitorContentType) : null;
        if (mcText && typeof mcText === 'string' && mcText.length > 10) {
            drawRealCode(ctx, monX, monY, monW, monH, px, frame, scrollSpeed, mcText, mcType);
        } else {
            drawMonitorContent(ctx, monX, monY, monW, monH, px, seed, frame, scrollSpeed);
        }
    }

    // CRT flicker
    if (frame % 90 < 2) {
        ctx.fillStyle = 'rgba(255,255,255,0.03)';
        ctx.fillRect(monX, monY, monW, monH);
    }

    // Monitor stand
    ctx.fillStyle = '#2c2c34';
    const standX = monX + monW / 2;
    ctx.fillRect(standX - px * 2, monY + monH + px, px * 4, px * 2);
    ctx.fillRect(standX - px * 4, monY + monH + px * 2, px * 8, px);
}

function drawCode(ctx, monX, monY, monW, monH, px, seed, frame, scrollSpeed) {
    const codeColors = ['#00ff41', '#00cc33', '#66ff66', '#33ff88', '#00ff99', '#88ffaa'];
    const maxCols = Math.floor((monW - px * 2) / px);
    const maxRows = Math.floor((monH - px * 2) / (px * 2));
    const scrollOffset = (frame * scrollSpeed) % 30;

    for (let row = 0; row < maxRows; row++) {
        const lineY = monY + px + row * px * 2;
        if (lineY >= monY + monH - px) continue;
        const lineSeed = (seed * 7 + row + Math.floor(scrollOffset)) * 31;
        const lineLen = Math.min(maxCols - 2, 4 + (lineSeed % (maxCols - 6)));
        const indent = (lineSeed >> 4) % 5;
        ctx.fillStyle = codeColors[(row + Math.floor(scrollOffset)) % codeColors.length];
        for (let col = 0; col < lineLen; col++) {
            const charSeed = (lineSeed + col * 13) % 100;
            if (charSeed < 18) continue;
            const cx = monX + px * (indent + 1 + col);
            if (cx + px > monX + monW - px) break;
            ctx.fillRect(cx, lineY, px - 1, px - 1);
        }
    }

    // Blinking cursor
    if (frame % 30 < 15) {
        const cursorRow = (Math.floor(scrollOffset) + 3) % maxRows;
        const cursorY = monY + px + cursorRow * px * 2;
        const cursorSeed = (seed * 7 + cursorRow + Math.floor(scrollOffset)) * 31;
        const cursorLen = Math.min(maxCols - 2, 4 + (cursorSeed % (maxCols - 6)));
        const cursorIndent = (cursorSeed >> 4) % 5;
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(monX + px * (cursorIndent + 1 + cursorLen), cursorY, px, px * 1.5);
    }
}

function drawErrorScreen(ctx, monX, monY, monW, monH, px, rxProgress) {
    // Red/blue error flash
    ctx.fillStyle = '#cc0000';
    const errRows = 4;
    for (let r = 0; r < errRows; r++) {
        const ey = monY + px * 3 + r * px * 3;
        const elen = 6 + (r * 3) % 10;
        for (let c = 0; c < elen; c++) {
            ctx.fillRect(monX + px * (2 + c), ey, px - 1, px - 1);
        }
    }
    // Big X
    ctx.fillStyle = '#ff4444';
    const cx = monX + monW / 2;
    const cy = monY + monH / 2;
    for (let i = -2; i <= 2; i++) {
        ctx.fillRect(cx + i * px, cy + i * px, px, px);
        ctx.fillRect(cx + i * px, cy - i * px, px, px);
    }
}

function drawThinkingScreen(ctx, monX, monY, monW, monH, px, frame) {
    // Gentle cursor blink, mostly empty screen — "thinking"
    ctx.fillStyle = '#00ff41';
    const dotPhase = Math.floor(frame / 15) % 4;
    for (let i = 0; i < dotPhase; i++) {
        ctx.fillRect(monX + px * (3 + i * 2), monY + px * 4, px, px);
    }
    // Cursor
    if (frame % 20 < 10) {
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(monX + px * (3 + dotPhase * 2), monY + px * 4, px, px * 1.5);
    }
}

function drawCharacter(ctx, w, h, px, palette, charX, charY, deskY, frame, rxType, rxProgress, typingMult) {
    // Breathing — 1px body Y oscillation
    const breathY = Math.sin(frame * 0.04) * 1;
    const seed = hashCode(palette.shirt) % 1000;
    const fur = palette.fur;
    const face = palette.face;
    const belly = palette.belly || face;

    // Idle action when no reaction active
    const idle = (!rxType) ? getIdleAction(seed, frame) : null;

    // === TAIL (behind body) ===
    const tailSwing = Math.sin(frame * 0.06) * px * 2;
    ctx.fillStyle = fur;
    ctx.fillRect(charX + px * 8 + tailSwing * 0.3, charY - px * 3 + breathY, px, px * 2);
    ctx.fillRect(charX + px * 9 + tailSwing * 0.6, charY - px * 4 + breathY, px, px * 2);
    ctx.fillRect(charX + px * 10 + tailSwing, charY - px * 5 + breathY, px, px);
    // Tail curl at tip
    ctx.fillRect(charX + px * 11 + tailSwing, charY - px * 6 + breathY, px, px);
    ctx.fillRect(charX + px * 11 + tailSwing - px * 0.5, charY - px * 7 + breathY, px, px);

    // === BODY (shirt/fur) ===
    let bodyOffX = 0;
    if (idle && idle.action === 'lean') bodyOffX = px * idle.phase;

    // Fur body
    ctx.fillStyle = fur;
    ctx.fillRect(charX + px * 1.5 + bodyOffX, charY - px * 6 + breathY, px * 7, px * 5);
    // Shirt/vest over body
    ctx.fillStyle = palette.shirt;
    ctx.fillRect(charX + px * 2 + bodyOffX, charY - px * 5.5 + breathY, px * 6, px * 4);
    // Lighter belly patch showing through
    ctx.fillStyle = belly;
    ctx.fillRect(charX + px * 3.5 + bodyOffX, charY - px * 5 + breathY, px * 3, px * 3);

    // === HEAD ===
    let headOffY = breathY;
    let headOffX = bodyOffX;
    if (rxType === 'think') {
        headOffX += Math.sin(frame * 0.08) * px * 0.5;
        headOffY += Math.sin(frame * 0.15) * px * 0.3;
    } else if (rxType === 'error') {
        headOffY += rxProgress < 0.2 ? -px * 2 * (rxProgress / 0.2) : -px * 2 * (1 - (rxProgress - 0.2) / 0.8);
        headOffX += Math.sin(frame * 1.5) * px * (rxProgress < 0.3 ? 1 : 0);
    } else if (rxType === 'complete') {
        headOffY += -Math.abs(Math.sin(rxProgress * Math.PI * 3)) * px * 2;
    } else if (rxType === 'user') {
        headOffX += -px * 2 * Math.sin(rxProgress * Math.PI);
    } else if (idle) {
        if (idle.action === 'look') headOffX += Math.sin(idle.phase * Math.PI) * px * 3;
        if (idle.action === 'stretch') headOffY += -idle.phase * px * 2;
        if (idle.action === 'scratch') headOffY += Math.sin(idle.phase * Math.PI * 2) * px * 0.5;
    }

    const hx = charX + px * 3 + headOffX;
    const hy = charY - px * 11 + headOffY;

    // Fur head (round)
    ctx.fillStyle = fur;
    ctx.fillRect(hx, hy, px * 4, px * 4);
    ctx.fillRect(hx - px * 0.5, hy + px * 0.5, px * 5, px * 3);
    // Fur top tuft
    ctx.fillRect(hx + px, hy - px, px * 2, px);

    // Round ears (sticking out sides)
    ctx.fillStyle = fur;
    ctx.fillRect(hx - px * 1.5, hy + px * 0.5, px * 2, px * 2);
    ctx.fillRect(hx + px * 3.5, hy + px * 0.5, px * 2, px * 2);
    // Inner ear (lighter)
    ctx.fillStyle = face;
    ctx.fillRect(hx - px, hy + px, px, px);
    ctx.fillRect(hx + px * 4, hy + px, px, px);

    // Face patch (lighter oval area)
    ctx.fillStyle = face;
    ctx.fillRect(hx + px * 0.5, hy + px * 1.5, px * 3, px * 2.5);

    // Muzzle/snout (slightly protruding lighter area)
    ctx.fillRect(hx + px, hy + px * 3, px * 2, px * 1.5);

    // === EYES ===
    const blinkCycle = (frame + seed * 7) % 100;
    const isBlinking = blinkCycle >= 97;

    const eyeBaseX = hx + px * 0.8;
    const eyeBaseY = hy + px * 1.8;

    if (isBlinking) {
        ctx.fillStyle = '#111111';
        ctx.fillRect(eyeBaseX, eyeBaseY + px * 0.3, px, px * 0.3);
        ctx.fillRect(eyeBaseX + px * 2, eyeBaseY + px * 0.3, px, px * 0.3);
    } else {
        // Big expressive monkey eyes
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(eyeBaseX, eyeBaseY, px, px);
        ctx.fillRect(eyeBaseX + px * 2, eyeBaseY, px, px);

        ctx.fillStyle = '#331100';
        let pupilOff = 0;
        if (rxType === 'user') pupilOff = -1;
        else if (idle && idle.action === 'look') pupilOff = Math.sin(idle.phase * Math.PI) > 0.5 ? -1 : 0;
        ctx.fillRect(eyeBaseX + pupilOff, eyeBaseY + px * 0.2, Math.ceil(px * 0.5), Math.ceil(px * 0.5));
        ctx.fillRect(eyeBaseX + px * 2 + pupilOff, eyeBaseY + px * 0.2, Math.ceil(px * 0.5), Math.ceil(px * 0.5));
    }

    // Nostrils
    ctx.fillStyle = '#3a2010';
    ctx.fillRect(hx + px * 1.2, hy + px * 3.3, px * 0.4, px * 0.3);
    ctx.fillRect(hx + px * 2.2, hy + px * 3.3, px * 0.4, px * 0.3);

    // Mouth
    if (rxType === 'complete') {
        // Big happy grin
        ctx.fillStyle = '#cc6666';
        ctx.fillRect(hx + px * 1, hy + px * 3.8, px * 2, px * 0.5);
    } else if (rxType === 'error' && rxProgress < 0.4) {
        // Open mouth shock
        ctx.fillStyle = '#111111';
        ctx.fillRect(hx + px * 1, hy + px * 3.8, px * 2, px * 0.8);
    } else if (idle && idle.action === 'sip' && idle.phase > 0.3 && idle.phase < 0.7) {
        ctx.fillStyle = '#111111';
        ctx.fillRect(hx + px * 1.5, hy + px * 3.8, px * 0.8, px * 0.4);
    } else {
        // Neutral mouth line
        ctx.fillStyle = '#3a2010';
        ctx.fillRect(hx + px * 1.2, hy + px * 3.8, px * 1.5, px * 0.2);
    }

    // === ARMS (long monkey arms with fur) ===
    const armSpeed = 0.3 * typingMult;
    const armPhase = Math.sin(frame * armSpeed);

    if (rxType === 'error' && rxProgress < 0.5) {
        // Hands up in frustration
        ctx.fillStyle = fur;
        ctx.fillRect(charX - px, charY - px * 8, px * 2, px * 3);
        ctx.fillRect(charX + px * 9, charY - px * 8, px * 2, px * 3);
        ctx.fillStyle = face;
        ctx.fillRect(charX - px, charY - px * 8, px * 1.5, px * 1.5);
        ctx.fillRect(charX + px * 9.5, charY - px * 8, px * 1.5, px * 1.5);
    } else if (rxType === 'complete' && rxProgress < 0.6) {
        // Fist pump
        const armUp = Math.sin(rxProgress * Math.PI * 4) * px * 2;
        ctx.fillStyle = fur;
        ctx.fillRect(charX - px, charY - px * 7 - Math.abs(armUp), px * 2, px * 3);
        ctx.fillRect(charX + px * 9, charY - px * 7 - Math.abs(armUp), px * 2, px * 3);
        ctx.fillStyle = face;
        ctx.fillRect(charX - px, charY - px * 7 - Math.abs(armUp), px * 1.5, px * 1.5);
        ctx.fillRect(charX + px * 9.5, charY - px * 7 - Math.abs(armUp), px * 1.5, px * 1.5);
    } else if (rxType === 'think') {
        // Hand on chin, other resting
        ctx.fillStyle = fur;
        ctx.fillRect(charX + px * 2, charY - px * 8, px * 2, px * 4);
        ctx.fillRect(charX + px * 8, charY - px * 4, px * 2, px * 3);
        ctx.fillStyle = face;
        ctx.fillRect(charX + px * 2, charY - px * 8, px * 1.5, px * 1.5);
    } else if (idle && idle.action === 'sip') {
        ctx.fillStyle = fur;
        const sipLift = Math.sin(idle.phase * Math.PI);
        ctx.fillRect(charX + px * 7, charY - px * 8 - sipLift * px * 2, px * 2, px * 3);
        ctx.fillRect(charX, charY - px * 4, px * 2, px * 3);
        ctx.fillStyle = face;
        ctx.fillRect(charX + px * 7, charY - px * 8 - sipLift * px * 2, px * 1.5, px * 1.5);
    } else if (idle && idle.action === 'stretch') {
        ctx.fillStyle = fur;
        const stretchUp = idle.phase * px * 4;
        ctx.fillRect(charX - px, charY - px * 7 - stretchUp, px * 2, px * 3);
        ctx.fillRect(charX + px * 9, charY - px * 7 - stretchUp, px * 2, px * 3);
        ctx.fillStyle = face;
        ctx.fillRect(charX - px, charY - px * 7 - stretchUp, px * 1.5, px * 1.5);
        ctx.fillRect(charX + px * 9.5, charY - px * 7 - stretchUp, px * 1.5, px * 1.5);
    } else if (idle && idle.action === 'scratch') {
        ctx.fillStyle = fur;
        ctx.fillRect(charX + px * 7 + headOffX, hy, px * 2, px * 3);
        ctx.fillRect(charX, charY - px * 4, px * 2, px * 3);
        ctx.fillStyle = face;
        ctx.fillRect(charX + px * 7 + headOffX, hy, px * 1.5, px * 1.5);
    } else {
        // Normal typing — long monkey arms reaching to keyboard
        const lArmY = charY - px * 4 + breathY + (armPhase > 0 ? -px : 0);
        const rArmY = charY - px * 4 + breathY + (armPhase > 0 ? 0 : -px);
        ctx.fillStyle = fur;
        ctx.fillRect(charX, lArmY, px * 2, px * 3);
        ctx.fillRect(charX - px, lArmY + px * 2, px, px);
        ctx.fillRect(charX + px * 8, rArmY, px * 2, px * 3);
        ctx.fillRect(charX + px * 10, rArmY + px * 2, px, px);
        // Hands (lighter)
        ctx.fillStyle = face;
        ctx.fillRect(charX - px, lArmY + px * 2, px * 1.5, px * 1.5);
        ctx.fillRect(charX + px * 9.5, rArmY + px * 2, px * 1.5, px * 1.5);
    }
}

// Monitor glow — colored rect behind monitor onto wall
function drawMonitorGlow(ctx, w, h, px, setup, palette, frame) {
    const glowAlpha = 0.04 + Math.sin(frame * 0.02) * 0.015;
    const monColor = palette.monitor;
    // Extract RGB from monitor color for glow
    const r = parseInt(monColor.slice(1, 3), 16);
    const g = parseInt(monColor.slice(3, 5), 16);
    const b = parseInt(monColor.slice(5, 7), 16);
    const glowR = Math.min(255, r + 80);
    const glowG = Math.min(255, g + 80);
    const glowB = Math.min(255, b + 80);

    if (setup === 'dual') {
        ctx.fillStyle = `rgba(${glowR},${glowG},${glowB},${glowAlpha})`;
        ctx.fillRect(w * 0.18, h * 0.05, w * 0.3, h * 0.45);
        ctx.fillRect(w * 0.48, h * 0.05, w * 0.3, h * 0.45);
    } else {
        ctx.fillStyle = `rgba(${glowR},${glowG},${glowB},${glowAlpha})`;
        ctx.fillRect(w * 0.25, h * 0.05, w * 0.5, h * 0.45);
    }
}

function drawDecoration(ctx, w, h, px, type, seed, frame, deskY) {
    switch (type) {
        case 'coffee': {
            const mx = w * 0.73;
            ctx.fillStyle = '#e0e0e0';
            ctx.fillRect(mx, deskY - px * 4, px * 3, px * 3);
            ctx.fillStyle = '#8b4513';
            ctx.fillRect(mx + px * 0.5, deskY - px * 3.5, px * 2, px * 2);
            ctx.fillStyle = '#e0e0e0';
            ctx.fillRect(mx + px * 3, deskY - px * 3, px, px * 2);
            // Continuous rising/fading steam particles (3-4)
            for (let s = 0; s < 4; s++) {
                const steamSeed = s * 37 + seed;
                const steamCycle = ((frame * 0.8 + steamSeed * 5) % 40) / 40;
                const steamX = mx + px * (0.5 + s * 0.6) + Math.sin(frame * 0.1 + s) * px * 0.5;
                const steamY = deskY - px * 5 - steamCycle * px * 5;
                const steamAlpha = 0.3 * (1 - steamCycle);
                ctx.fillStyle = `rgba(200,200,200,${steamAlpha})`;
                ctx.fillRect(steamX, steamY, px * 0.5, px * 0.5);
            }
            break;
        }
        case 'soda': {
            const sx = w * 0.73;
            ctx.fillStyle = '#cc0000';
            ctx.fillRect(sx, deskY - px * 5, px * 2, px * 4);
            ctx.fillStyle = '#ffffff';
            ctx.fillRect(sx + px * 0.3, deskY - px * 3.5, px * 1.4, px);
            // Tab on top
            ctx.fillStyle = '#aaaaaa';
            ctx.fillRect(sx + px * 0.5, deskY - px * 5.5, px, px * 0.5);
            break;
        }
        case 'energy': {
            const ex = w * 0.73;
            ctx.fillStyle = '#00cc00';
            ctx.fillRect(ex, deskY - px * 5, px * 2, px * 4);
            ctx.fillStyle = '#000000';
            ctx.fillRect(ex + px * 0.3, deskY - px * 4, px * 1.4, px);
            ctx.fillStyle = '#ffff00';
            ctx.fillRect(ex + px * 0.5, deskY - px * 3.5, px, px * 0.5);
            break;
        }
        case 'plant': {
            const px2 = w * 0.2;
            ctx.fillStyle = '#8b4513';
            ctx.fillRect(px2, deskY - px * 4, px * 4, px * 3);
            ctx.fillStyle = '#654321';
            ctx.fillRect(px2 - px * 0.5, deskY - px * 4, px * 5, px);
            // Leaves with continuous sine sway
            const sway = Math.sin(frame * 0.03) * px;
            ctx.fillStyle = '#228b22';
            ctx.fillRect(px2 + px + sway * 0.3, deskY - px * 7, px * 2, px * 3);
            ctx.fillRect(px2 - px + sway * 0.5, deskY - px * 6, px * 2, px * 2);
            ctx.fillRect(px2 + px * 3 - sway * 0.4, deskY - px * 6, px * 2, px * 2);
            ctx.fillRect(px2 + px * 4 + sway, deskY - px * 7, px, px);
            // Occasional new leaf (appears briefly)
            if (frame % 300 < 30) {
                ctx.fillStyle = '#44cc44';
                ctx.fillRect(px2 + px * 2 + sway, deskY - px * 8, px, px);
            }
            break;
        }
        case 'cat': {
            const cx = w * 0.18;
            const catY = deskY - px * 3;
            // Stretch cycle: occasionally stands and stretches
            const catCycle = Math.floor(frame / 400) % 3;
            const catPhase = (frame % 400) / 400;

            if (catCycle === 1 && catPhase < 0.3) {
                // Stretching — body elongated, butt up
                ctx.fillStyle = '#ff8c00';
                ctx.fillRect(cx, catY - px, px * 5, px * 2);
                ctx.fillRect(cx + px * 4, catY - px * 3, px * 3, px * 2);
                ctx.fillRect(cx, catY - px * 2, px * 2, px);
            } else {
                // Normal sitting
                ctx.fillStyle = '#ff8c00';
                ctx.fillRect(cx, catY, px * 4, px * 2);
                ctx.fillRect(cx + px * 3, catY - px * 2, px * 3, px * 2);
            }
            // Ears
            ctx.fillStyle = '#ff6600';
            const headX = catCycle === 1 && catPhase < 0.3 ? cx + px * 4 : cx + px * 3;
            const headY = catCycle === 1 && catPhase < 0.3 ? catY - px * 4 : catY - px * 3;
            ctx.fillRect(headX, headY, px, px);
            ctx.fillRect(headX + px * 2, headY, px, px);
            // Eyes — blink, head turns
            if (frame % 120 < 110) {
                ctx.fillStyle = '#00ff00';
                const headTurn = Math.sin(frame * 0.02) * px * 0.3;
                ctx.fillRect(headX + px + headTurn, headY + px, px * 0.5, px * 0.5);
                ctx.fillRect(headX + px * 1.5 + headTurn, headY + px, px * 0.5, px * 0.5);
            }
            // Tail — curl variations
            ctx.fillStyle = '#ff8c00';
            const tailCurl = Math.sin(frame * 0.08);
            const tailX = cx - px + tailCurl * px;
            ctx.fillRect(tailX, catY, px, px);
            ctx.fillRect(tailX - px * 0.5 + tailCurl * px * 0.3, catY - px, px, px);
            ctx.fillRect(tailX - px + tailCurl * px * 0.5, catY - px * 2, px, px);
            // Purr zzz
            if (seed % 2 === 0 && frame % 40 < 20) {
                ctx.fillStyle = 'rgba(255,255,255,0.3)';
                ctx.fillRect(cx + px * 6, catY - px * 3, px, px);
            }
            break;
        }
        case 'figurine': {
            const fx = w * 0.2;
            // Little robot/toy on desk
            ctx.fillStyle = '#9146ff';
            ctx.fillRect(fx, deskY - px * 5, px * 3, px * 3);
            ctx.fillStyle = '#bf94ff';
            ctx.fillRect(fx + px * 0.5, deskY - px * 4.5, px, px * 0.5);
            ctx.fillRect(fx + px * 1.5, deskY - px * 4.5, px, px * 0.5);
            // Antenna
            ctx.fillStyle = '#9146ff';
            ctx.fillRect(fx + px, deskY - px * 6, px, px);
            ctx.fillStyle = '#ff0000';
            ctx.fillRect(fx + px, deskY - px * 6.5, px, px * 0.5);
            break;
        }
        case 'lamp': {
            const lx = w * 0.79;
            ctx.fillStyle = '#555555';
            ctx.fillRect(lx + px, deskY - px * 10, px, px * 9);
            ctx.fillStyle = '#f0c674';
            ctx.fillRect(lx - px, deskY - px * 12, px * 4, px * 3);
            // Flickering light cone
            const lampFlicker = 0.06 + Math.sin(frame * 0.15) * 0.02 + (frame % 7 === 0 ? 0.03 : 0);
            ctx.fillStyle = `rgba(240, 198, 116, ${lampFlicker})`;
            ctx.fillRect(lx - px * 4, deskY - px * 10, px * 10, px * 9);
            // Orbiting moth pixel
            const mothAngle = frame * 0.08;
            const mothX = lx + px + Math.cos(mothAngle) * px * 3;
            const mothY = deskY - px * 11 + Math.sin(mothAngle) * px * 2;
            ctx.fillStyle = 'rgba(255,255,200,0.6)';
            ctx.fillRect(mothX, mothY, px * 0.5, px * 0.5);
            ctx.fillStyle = '#555555';
            ctx.fillRect(lx - px * 0.5, deskY - px, px * 3, px);
            break;
        }
        case 'duck': {
            const dx = w * 0.19;
            // Continuous bobbing
            const bob = Math.sin(frame * 0.06) * px * 0.5;
            ctx.fillStyle = '#ffdd00';
            ctx.fillRect(dx, deskY - px * 3 + bob, px * 3, px * 2);
            ctx.fillRect(dx + px, deskY - px * 5 + bob, px * 2, px * 2);
            ctx.fillStyle = '#ff8800';
            ctx.fillRect(dx + px * 3, deskY - px * 4.5 + bob, px, px);
            ctx.fillStyle = '#000000';
            ctx.fillRect(dx + px * 1.5, deskY - px * 4.5 + bob, px * 0.4, px * 0.4);
            // Occasional speech bubble
            if (frame % 200 < 40) {
                ctx.fillStyle = 'rgba(255,255,255,0.7)';
                ctx.fillRect(dx + px * 3, deskY - px * 6.5 + bob, px * 3, px * 2);
                ctx.fillStyle = '#000000';
                ctx.fillRect(dx + px * 3.5, deskY - px * 6 + bob, px * 0.5, px * 0.5);
                ctx.fillRect(dx + px * 4.5, deskY - px * 6 + bob, px * 0.5, px * 0.5);
            }
            break;
        }
        case 'poster': break; // drawn separately on wall
    }
}

function drawPoster(ctx, w, h, px, seed, frame) {
    const postX = w * 0.08;
    const postY = h * 0.08;
    const postW = px * 12;
    const postH = px * 10;
    // Frame
    ctx.fillStyle = '#3a3a44';
    ctx.fillRect(postX - px, postY - px, postW + px * 2, postH + px * 2);
    // Poster content — pixel art landscape or text
    ctx.fillStyle = '#1a1a44';
    ctx.fillRect(postX, postY, postW, postH);
    // Simple pixel art mountain
    ctx.fillStyle = '#4a6a4a';
    for (let i = 0; i < 6; i++) {
        ctx.fillRect(postX + px * (3 + i), postY + postH - px * (1 + i * 0.8), px, px * (1 + i * 0.8));
    }
    ctx.fillStyle = '#8899aa';
    for (let i = 0; i < 4; i++) {
        ctx.fillRect(postX + px * (7 + i), postY + postH - px * (1 + i * 0.5), px, px * (1 + i * 0.5));
    }
    // Stars on poster
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(postX + px * 2, postY + px * 2, 1, 1);
    ctx.fillRect(postX + px * 8, postY + px * 1, 1, 1);
    ctx.fillRect(postX + px * 5, postY + px * 3, 1, 1);
}

function drawWindow(ctx, w, h, px, frame, seed) {
    seed = seed || 0;
    const winX = w * 0.78;
    const winY = h * 0.05;
    const winW = px * 12;
    const winH = px * 10;
    // Frame
    ctx.fillStyle = '#3a3a44';
    ctx.fillRect(winX - px, winY - px, winW + px * 2, winH + px * 2);
    // Night sky
    ctx.fillStyle = '#0a0a2a';
    ctx.fillRect(winX, winY, winW, winH);

    // City skyline for some seeds
    if (seed % 4 === 0) {
        ctx.fillStyle = '#111122';
        // Blocky buildings
        const buildings = [3, 5, 4, 7, 3, 6, 4, 5];
        for (let i = 0; i < buildings.length; i++) {
            const bx = winX + i * px * 1.5;
            const bh = buildings[i] * px * 0.8;
            ctx.fillRect(bx, winY + winH - bh, px * 1.2, bh);
            // Flickering lit windows
            if ((frame + i * 13) % 60 < 50) {
                ctx.fillStyle = '#ffcc66';
                ctx.fillRect(bx + px * 0.2, winY + winH - bh + px, px * 0.3, px * 0.3);
                ctx.fillStyle = '#111122';
            }
            if ((frame + i * 7) % 80 < 60) {
                ctx.fillStyle = '#aaccff';
                ctx.fillRect(bx + px * 0.6, winY + winH - bh + px * 2, px * 0.3, px * 0.3);
                ctx.fillStyle = '#111122';
            }
        }
    }

    // Moon
    ctx.fillStyle = '#ffffcc';
    ctx.fillRect(winX + px * 2, winY + px * 2, px * 3, px * 3);
    ctx.fillStyle = '#0a0a2a';
    ctx.fillRect(winX + px * 3, winY + px * 1.5, px * 2, px * 2);

    // Slow-drifting cloud
    const cloudX = winX + ((frame * 0.15 + seed * 20) % (winW + px * 6)) - px * 3;
    if (cloudX >= winX && cloudX + px * 4 <= winX + winW) {
        ctx.fillStyle = 'rgba(100,100,140,0.3)';
        ctx.fillRect(cloudX, winY + px * 4, px * 4, px);
        ctx.fillRect(cloudX + px, winY + px * 3, px * 2, px);
    }

    // Stars twinkling
    ctx.fillStyle = '#ffffff';
    if (frame % 40 < 30) ctx.fillRect(winX + px * 7, winY + px * 3, 1, 1);
    if (frame % 50 < 35) ctx.fillRect(winX + px * 9, winY + px * 1, 1, 1);
    if (frame % 35 < 25) ctx.fillRect(winX + px * 5, winY + px * 7, 1, 1);

    // Shooting star every ~500 frames
    const shootPhase = frame % 500;
    if (shootPhase < 8) {
        ctx.fillStyle = `rgba(255,255,255,${0.8 - shootPhase * 0.1})`;
        const sx = winX + px * 8 - shootPhase * px * 0.8;
        const sy = winY + px + shootPhase * px * 0.4;
        if (sx >= winX && sx <= winX + winW && sy >= winY && sy <= winY + winH) {
            ctx.fillRect(sx, sy, px * 0.5, px * 0.3);
        }
    }

    // Rain for some seeds
    if (seed % 5 === 0) {
        ctx.fillStyle = 'rgba(120,140,200,0.4)';
        for (let r = 0; r < 8; r++) {
            const rx = winX + ((seed * 3 + r * 17 + frame * 2) % Math.floor(winW));
            const ry = winY + ((r * 23 + frame * 3) % Math.floor(winH));
            if (rx >= winX && rx < winX + winW && ry >= winY && ry < winY + winH) {
                ctx.fillRect(rx, ry, 1, px);
            }
        }
        // Puddle shimmer on sill
        if (frame % 6 < 3) {
            ctx.fillStyle = 'rgba(120,140,200,0.15)';
            ctx.fillRect(winX, winY + winH, winW, px * 0.5);
        }
    }

    // Windowsill
    ctx.fillStyle = '#3a3a44';
    ctx.fillRect(winX - px * 2, winY + winH + px, winW + px * 4, px);
}

function drawCelebration(ctx, w, h, px, frame, startFrame) {
    const elapsed = frame - startFrame;
    const confettiColors = ['#ff0000', '#00ff00', '#0000ff', '#ffff00', '#ff00ff', '#00ffff', '#ff8800', '#9146ff'];
    for (let i = 0; i < 20; i++) {
        const seed = i * 37 + 11;
        const x = (seed * 13) % w;
        const startY = -px * 2;
        const speed = 1.5 + (seed % 3);
        const y = startY + elapsed * speed + Math.sin((elapsed + seed) * 0.1) * px * 3;
        if (y > h) continue;
        const size = px * (0.5 + (seed % 3) * 0.3);
        ctx.fillStyle = confettiColors[i % confettiColors.length];
        ctx.fillRect(x, y, size, size);
    }
}

// ============================================================
// IDLE ANIMATIONS
// ============================================================

function getIdleAction(seed, frame) {
    // Deterministic idle cycle based on seed
    const cycle = Math.floor(frame / 200) + seed * 3;
    const phase = (frame % 200) / 200; // 0..1 within action
    switch (cycle % 5) {
        case 0: return { action: 'sip', phase };
        case 1: return { action: 'stretch', phase };
        case 2: return { action: 'look', phase };
        case 3: return { action: 'scratch', phase };
        case 4: return { action: 'lean', phase };
    }
}

// ============================================================
// DYNAMIC MONITOR CONTENT MODES
// ============================================================

function getMonitorMode(seed, frame) {
    const mode = (seed + Math.floor(frame / 600)) % 4;
    const transitionFrame = frame % 600;
    const inTransition = transitionFrame < 2;
    return { mode, inTransition };
}

function drawMonitorContent(ctx, monX, monY, monW, monH, px, seed, frame, scrollSpeed) {
    const { mode, inTransition } = getMonitorMode(seed, frame);

    if (inTransition) {
        // Static transition flicker
        for (let i = 0; i < 30; i++) {
            const sx = monX + ((seed * 13 + i * 37 + frame * 7) % Math.floor(monW));
            const sy = monY + ((seed * 11 + i * 23 + frame * 3) % Math.floor(monH));
            ctx.fillStyle = `rgba(${150 + (i * 37) % 105}, ${150 + (i * 23) % 105}, ${150 + (i * 17) % 105}, 0.5)`;
            ctx.fillRect(sx, sy, px, px);
        }
        return;
    }

    switch (mode) {
        case 0: drawCode(ctx, monX, monY, monW, monH, px, seed, frame, scrollSpeed); break;
        case 1: drawTerminal(ctx, monX, monY, monW, monH, px, seed, frame, scrollSpeed); break;
        case 2: drawFileTree(ctx, monX, monY, monW, monH, px, seed, frame); break;
        case 3: drawDebugLog(ctx, monX, monY, monW, monH, px, seed, frame, scrollSpeed); break;
    }
}

function drawRealCode(ctx, monX, monY, monW, monH, px, frame, scrollSpeed, contentText, contentType) {
    const content = contentText || state.monitorContent || '';
    if (!content) return;
    const lines = content.split('\n').filter(l => l.trim().length > 0);
    if (lines.length === 0) return;

    const charW = px;          // each character is 1px unit wide
    const charH = px;          // each character is 1px unit tall
    const lineH = px * 2.5;    // line spacing
    const gutterW = px * 4;    // gutter for line numbers
    const margin = px * 1.5;
    const codeX = monX + margin + gutterW;
    const codeW = monW - margin * 2 - gutterW;
    const maxCols = Math.floor(codeW / charW);
    const maxRows = Math.floor((monH - margin * 2) / lineH);
    const scrollOffset = Math.floor(frame * scrollSpeed * 0.15) % Math.max(1, lines.length);

    // Color scheme based on content type
    const evtType = contentType || state.monitorContentType;
    const colorSchemes = {
        bash:        { keyword: '#ffcc00', text: '#e0e0e0', comment: '#666666', string: '#00ff41' },
        error:       { keyword: '#ff4444', text: '#ff8888', comment: '#884444', string: '#ffaaaa' },
        think:       { keyword: '#88aaff', text: '#cccccc', comment: '#666688', string: '#aaccff' },
        file_create: { keyword: '#00e676', text: '#c5c8c6', comment: '#5c6370', string: '#98c379' },
        file_update: { keyword: '#00e676', text: '#c5c8c6', comment: '#5c6370', string: '#98c379' },
    };
    const colors = colorSchemes[evtType] || { keyword: '#00ff41', text: '#c5c8c6', comment: '#5c6370', string: '#e5c07b' };

    // Simple syntax-like coloring heuristics
    function getCharColor(line, colIdx) {
        const trimmed = line.trimStart();
        if (trimmed.startsWith('#') || trimmed.startsWith('//') || trimmed.startsWith('--')) return colors.comment;
        const ch = line[colIdx];
        if (ch === '"' || ch === "'" || ch === '`') return colors.string;
        if (/[{}\[\]()=<>:;,]/.test(ch)) return colors.keyword;
        if (/[A-Z]/.test(ch)) return colors.keyword;
        if (/\d/.test(ch)) return colors.string;
        return colors.text;
    }

    for (let row = 0; row < maxRows; row++) {
        const lineIdx = (scrollOffset + row) % lines.length;
        const line = lines[lineIdx] || '';
        const lineY = monY + margin + row * lineH;
        if (lineY + charH >= monY + monH - margin) break;

        // Line number gutter
        ctx.fillStyle = '#556666';
        const numStr = String((lineIdx + 1) % 1000).padStart(3, ' ');
        for (let d = 0; d < numStr.length; d++) {
            if (numStr[d] !== ' ') {
                ctx.fillRect(monX + margin + d * charW, lineY, charW - 1, charH);
            }
        }

        // Code characters
        for (let col = 0; col < Math.min(line.length, maxCols); col++) {
            const ch = line[col];
            if (ch === ' ' || ch === '\t') continue;
            ctx.fillStyle = getCharColor(line, col);
            const cx = codeX + col * charW;
            if (cx + charW > monX + monW - margin) break;
            ctx.fillRect(cx, lineY, charW - 1, charH);
        }
    }

    // Blinking cursor
    if (frame % 30 < 15) {
        const cursorRow = Math.min(maxRows - 1, 3);
        const cursorLine = lines[(scrollOffset + cursorRow) % lines.length] || '';
        const cursorX = codeX + Math.min(cursorLine.length, maxCols) * charW;
        const cursorY = monY + margin + cursorRow * lineH;
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(cursorX, cursorY, charW, charH * 1.5);
    }
}

function drawTerminal(ctx, monX, monY, monW, monH, px, seed, frame, scrollSpeed) {
    const maxCols = Math.floor((monW - px * 2) / px);
    const maxRows = Math.floor((monH - px * 2) / (px * 2));
    const scrollOffset = (frame * scrollSpeed * 0.5) % 20;

    for (let row = 0; row < maxRows; row++) {
        const lineY = monY + px + row * px * 2;
        if (lineY >= monY + monH - px) continue;
        const lineSeed = (seed * 11 + row + Math.floor(scrollOffset)) * 37;

        // $ prompt in green
        ctx.fillStyle = '#00ff41';
        ctx.fillRect(monX + px, lineY, px, px - 1);
        ctx.fillRect(monX + px * 2.5, lineY, px * 0.5, px - 1);

        // Command text in white/green
        const isOutput = (lineSeed % 3 === 0);
        ctx.fillStyle = isOutput ? '#aaaaaa' : '#e0e0e0';
        const lineLen = 3 + (lineSeed % (maxCols - 8));
        for (let col = 0; col < lineLen; col++) {
            if ((lineSeed + col * 7) % 100 < 20) continue;
            const cx = monX + px * (4 + col);
            if (cx + px > monX + monW - px) break;
            ctx.fillRect(cx, lineY, px - 1, px - 1);
        }
    }

    // Blinking cursor
    if (frame % 30 < 15) {
        ctx.fillStyle = '#ffffff';
        const cursorRow = Math.min(maxRows - 1, Math.floor(scrollOffset) + 2);
        ctx.fillRect(monX + px * 5, monY + px + cursorRow * px * 2, px, px * 1.5);
    }
}

function drawFileTree(ctx, monX, monY, monW, monH, px, seed, frame) {
    const maxRows = Math.floor((monH - px * 2) / (px * 2));
    const folderColors = ['#f0c674', '#81a2be', '#b294bb', '#8abeb7'];
    const fileColors = ['#c5c8c6', '#969896', '#b4b7b4'];

    for (let row = 0; row < maxRows; row++) {
        const lineY = monY + px + row * px * 2;
        if (lineY >= monY + monH - px) continue;
        const lineSeed = (seed * 5 + row) * 23;
        const indent = lineSeed % 4;
        const isFolder = (lineSeed % 3 !== 0);
        const indentX = monX + px * (1 + indent * 2);

        // Folder/file icon square
        ctx.fillStyle = isFolder ? folderColors[row % folderColors.length] : fileColors[row % fileColors.length];
        ctx.fillRect(indentX, lineY, px, px - 1);

        // Name
        const nameLen = 3 + (lineSeed % 8);
        for (let col = 0; col < nameLen; col++) {
            if ((lineSeed + col * 11) % 100 < 15) continue;
            ctx.fillRect(indentX + px * (2 + col), lineY, px - 1, px - 1);
        }

        // Highlight selected row
        if (row === (Math.floor(frame / 90) + seed) % maxRows) {
            ctx.fillStyle = 'rgba(255,255,255,0.05)';
            ctx.fillRect(monX, lineY - 1, monW, px * 2);
        }
    }
}

function drawDebugLog(ctx, monX, monY, monW, monH, px, seed, frame, scrollSpeed) {
    const maxCols = Math.floor((monW - px * 2) / px);
    const maxRows = Math.floor((monH - px * 2) / (px * 2));
    const scrollOffset = (frame * scrollSpeed * 0.4) % 25;
    const logColors = ['#00ff41', '#00ff41', '#ffcc00', '#ff4444', '#00ff41', '#ffcc00'];

    for (let row = 0; row < maxRows; row++) {
        const lineY = monY + px + row * px * 2;
        if (lineY >= monY + monH - px) continue;
        const lineSeed = (seed * 9 + row + Math.floor(scrollOffset)) * 29;

        // Timestamp in dim cyan
        ctx.fillStyle = '#5588aa';
        for (let c = 0; c < 4; c++) {
            ctx.fillRect(monX + px * (1 + c), lineY, px - 1, px - 1);
        }

        // Log level color
        const colorIdx = (lineSeed % logColors.length);
        ctx.fillStyle = logColors[colorIdx];

        // Level tag
        ctx.fillRect(monX + px * 6, lineY, px * 2, px - 1);

        // Message
        const lineLen = 3 + (lineSeed % (maxCols - 12));
        for (let col = 0; col < lineLen; col++) {
            if ((lineSeed + col * 13) % 100 < 22) continue;
            const cx = monX + px * (9 + col);
            if (cx + px > monX + monW - px) break;
            ctx.fillRect(cx, lineY, px - 1, px - 1);
        }
    }
}

function darken(hex, amount) {
    const r = Math.max(0, parseInt(hex.slice(1, 3), 16) - amount);
    const g = Math.max(0, parseInt(hex.slice(3, 5), 16) - amount);
    const b = Math.max(0, parseInt(hex.slice(5, 7), 16) - amount);
    return `rgb(${r},${g},${b})`;
}

function startPixelAnimation(canvas, seed, isLarge) {
    let frame = Math.floor(Math.random() * 100);
    const id = canvas.dataset.animId || ('' + Math.random());
    canvas.dataset.animId = id;

    if (state.animFrames.has(id)) cancelAnimationFrame(state.animFrames.get(id));

    let lastDraw = 0;
    function animate(ts) {
        state.animFrames.set(id, requestAnimationFrame(animate));
        if (ts - lastDraw < 67) return; // ~15fps
        lastDraw = ts;
        drawPixelScene(canvas, seed, frame, isLarge);
        frame++;
    }
    state.animFrames.set(id, requestAnimationFrame(animate));
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
    stopViewerChat();
    hideCodeOverlay();
    state.reaction = null;
    state.typingSpeed = 1.0;
    state.chatFullscreen = false;
    state.replyToEventIndex = null;
    state.masterMonitorContent = [];
    const hash = window.location.hash || '#/';
    if (hash === '#/master') {
        showMasterChannel();
    } else if (hash.startsWith('#/session/')) {
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

function consolidateSessions(sessions) {
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

    // Master channel card at the top
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
                <div class="channel-name">🖥 Master Control Room</div>
                <div class="channel-category">All agents · All projects · Everything at once</div>
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
                <div class="${avatarClass}">🐒</div>
                <div class="channel-text">
                    <div class="channel-name">${esc(s.project_name)}${countBadge}</div>
                    <div class="channel-category">Coding · ${esc(s.slug || 'Claude Code')}</div>
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
                // Find last content-bearing event
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
// SESSION VIEW — Stream Page
// ============================================================

async function showSessionView(filePath) {
    state.view = 'session';
    state.inventory = {};
    state.sessionFilePath = filePath;
    loadPersistedState(filePath);

    if (state.ws) { state.ws.close(); state.ws = null; }
    document.getElementById('dashboard-view').style.display = 'none';
    document.getElementById('session-view').style.display = 'flex';

    document.getElementById('back-btn').onclick = () => navigate('#/');
    document.getElementById('event-log').innerHTML = '';
    const viewerLogInit = document.getElementById('viewer-log');
    if (viewerLogInit) viewerLogInit.innerHTML = '<div style="padding:20px;color:var(--text-muted)">Connecting to stream…</div>';
    const vcc = document.getElementById('viewer-chat-count'); if (vcc) vcc.textContent = '';
    const alc = document.getElementById('agent-log-count'); if (alc) alc.textContent = '';

    setupActions(filePath);

    document.getElementById('filter-toggle-btn').onclick = () => {
        const panel = document.getElementById('filters-panel');
        panel.style.display = panel.style.display === 'none' ? 'block' : 'none';
    };

    // Fullscreen chat toggle
    document.getElementById('expand-chat-btn').onclick = () => {
        state.chatFullscreen = !state.chatFullscreen;
        const layout = document.querySelector('.stream-layout');
        layout.classList.toggle('chat-fullscreen', state.chatFullscreen);
        document.getElementById('expand-chat-btn').textContent = state.chatFullscreen ? '⊟' : '⛶';
        document.getElementById('expand-chat-btn').title = state.chatFullscreen ? 'Exit fullscreen chat' : 'Toggle fullscreen chat';
    };

    // Restore persisted UI
    document.getElementById('like-count').textContent = state.likes;
    const followBtn = document.getElementById('follow-btn');
    followBtn.textContent = state.following ? '♥ Following' : '+ Follow';
    followBtn.classList.toggle('following', state.following);
    if (state.likes > 0) document.getElementById('like-btn').classList.add('liked');

    try {
        const resp = await fetch('/api/session/' + encodeURIComponent(filePath));
        const data = await resp.json();
        if (data.error) {
            (document.getElementById('viewer-log') || document.getElementById('event-log')).innerHTML = `<div style="padding:20px;color:var(--text-muted)">${esc(data.error)}</div>`;
            return;
        }
        state.session = data;
        initFilters();
        renderSession();
        setupScrollListener();
        connectSessionWS(filePath);

        const canvas = document.getElementById('webcam-canvas');
        const seed = hashCode(filePath) % PALETTES.length;
        startPixelAnimation(canvas, seed, true);
        syncLlmToggleUI();
        if (state.llmEnabled) startViewerChat();
    } catch (e) {
        (document.getElementById('viewer-log') || document.getElementById('event-log')).innerHTML = `<div style="padding:20px;color:var(--text-muted)">Failed to connect to stream</div>`;
    }
}

function setupActions(filePath) {
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
        persistTips(filePath);
        addTipToChat(amount);
        triggerReaction('complete'); // celebration for tips
        const float = document.createElement('span');
        float.className = 'tip-float';
        float.textContent = `💎 ${fmtTokens(amount)}`;
        float.style.left = (e.clientX - 20) + 'px';
        float.style.top = (e.clientY - 20) + 'px';
        document.body.appendChild(float);
        setTimeout(() => float.remove(), 1500);
        renderDonationGoal();
    };

    followBtn.onclick = () => {
        state.following = !state.following;
        followBtn.textContent = state.following ? '♥ Following' : '+ Follow';
        followBtn.classList.toggle('following', state.following);
        persistFollow(filePath);
    };
}

function addTipToChat(amount) {
    const log = document.getElementById('viewer-log') || document.getElementById('event-log');
    const names = ['viewer_42', 'code_fan99', 'pixel_dev', 'stream_lurker', 'bug_hunter',
                   'git_pusher', 'regex_queen', 'null_ptr', 'sudo_user', 'mr_merge'];
    const name = names[Math.floor(Math.random() * names.length)];
    const messages = [
        'Keep coding! 🔥', 'Amazing stream!', 'Fix that bug! 🐛',
        'Ship it! 🚀', 'Clean code! ✨', 'LFG!! 💪',
        'GOAT coder 🐐', 'Take my tokens!', 'Huge fan! 🎉',
    ];
    const msg = messages[Math.floor(Math.random() * messages.length)];

    const div = document.createElement('div');
    div.className = 'chat-msg is-tip';
    div.innerHTML = `<span class="chat-badge">💎</span>`
        + `<span class="chat-name" style="color:var(--tip-blue)">${esc(name)}</span>`
        + `<span class="tip-amount">${fmtTokens(amount)} tokens</span> `
        + `<span class="chat-text">${esc(msg)}</span>`;
    log.appendChild(div);
    updateViewerCount();

    // Streamer reacts to tip in chat
    setTimeout(() => {
        const streamerName = state.session
            ? (Object.values(state.session.agents)[0]?.name || 'Claude')
            : 'Claude';
        const reactions = amount >= 2500
            ? ['OMG thank you so much!! 😭', 'HUGE tip! You are incredible!', 'No way!! Thank you!! 🙏',
               'I literally can\'t right now 😭💜', 'GOAT viewer right here!!!']
            : ['Thanks for the tip! 💜', 'Appreciate it! ❤️', 'You\'re awesome, ty!',
               'Ayy thanks! 🎉', 'Let\'s gooo, ty! 🔥', 'Much love! 💜'];
        const reaction = reactions[Math.floor(Math.random() * reactions.length)];
        const replyDiv = document.createElement('div');
        replyDiv.className = 'chat-msg is-streamer-reply';
        replyDiv.innerHTML = `<span class="chat-badge">🐵</span>`
            + `<span class="chat-name" style="color:var(--purple)">${esc(streamerName)}</span>`
            + `<span class="chat-text">${esc(reaction)}</span>`;
        log.appendChild(replyDiv);
        updateViewerCount();
        if (state.viewerAutoScroll) log.scrollTop = log.scrollHeight;
    }, 800 + Math.random() * 1200);

    if (state.viewerAutoScroll) log.scrollTop = log.scrollHeight;
}

const VIEWER_NAMES = [
    'viewer_42', 'code_fan99', 'pixel_dev', 'stream_lurker', 'bug_hunter',
    'git_pusher', 'regex_queen', 'null_ptr', 'sudo_user', 'mr_merge',
    'debug_diva', 'pr_approved', 'stack_overflow', 'tab_hoarder', 'vim_exit',
    'semicolon_sam', 'async_anna', 'monorepo_mike', 'lint_error', 'deploy_dan',
    'chmod_777', 'docker_dave', 'type_safe_ty', 'cargo_build', 'pip_install',
    'branch_bob', 'merge_mia', 'refactor_ray', 'test_tina', 'ci_cd_carl',
    'heap_holly', 'mutex_max', 'lambda_liz', 'cache_miss', 'jwt_jenny',
    'yaml_yuri', 'env_var_ed', 'cors_cathy', 'orm_oscar', 'api_key_aki',
];

// Event-type-specific fallback messages for viewer chat
const VIEWER_MESSAGES_BY_TYPE = {
    file_update: [
        'that edit is clean', 'ship it!', 'LGTM',
        'how many lines was that', 'love the naming', 'that function tho',
        'the abstraction is solid', 'clean commit incoming',
        'watch the cyclomatic complexity', 'extract that into a helper?',
        'nice separation of concerns', 'that return early pattern tho',
        'DRY violation or intentional?', 'single responsibility W',
        'bet that broke something', 'was that a refactor or a feature',
        'diff looks clean from here', 'indent game strong',
        'bold move changing that', 'hope theres a test for that',
    ],
    file_create: [
        'new file just dropped', 'fresh module 🔥', 'the architecture is growing',
        'building out the project structure', 'nice scaffolding',
        'should that be a separate package?', 'good call on the file split',
        'add it to .gitignore?', 'modular design W',
        'the file tree is getting deep', 'clean project layout',
    ],
    bash: [
        'terminal wizard', 'that command tho 🧙', 'pipe gang',
        'one-liner king', 'just grep it', 'shell scripting arc',
        'the flags on that command', 'thats a lot of output',
        'redirect stderr too', 'add set -e at the top',
        'that pipe chain is elegant', 'curl | jq gang',
        'should probably quote those vars', 'exit code 0 lets go',
        'alias that command', 'xargs would be faster',
        'did that just install something', 'watch out for rm -rf',
    ],
    error: [
        'RIP 💀', 'F in chat', 'stack trace arc',
        'not the red text 😭', 'error handling time', 'classic off by one',
        'the debugger is calling', 'check the stack trace closely',
        'is that a race condition?', 'null reference strikes again',
        'missing import maybe?', 'wrong argument order probably',
        'did the types change upstream?', 'try adding a breakpoint there',
        'seen this before its the config', 'oh no the build broke',
        'revert revert revert', 'have you tried turning it off and on',
    ],
    think: [
        'the thinking phase 🧠', 'planning arc', 'galaxy brain moment',
        'cooking something up', 'big brain time', 'strategizing',
        'architecture review in progress', 'weighing the tradeoffs',
        'considering the edge cases', 'this is the important part',
        'thats a long think', 'must be a hard one',
        'the plan is forming', 'hope it picks the right approach',
    ],
    tool_call: [
        'tool usage on point', 'using the right tool for the job',
        'that tool call was fast', 'automation ftw',
        'good call reaching for grep first', 'should cache that result',
        'batch those calls maybe?', 'nice API choice',
        'the tooling in this project tho', 'thats a smart integration',
        'how many tools does it have', 'tool-assisted speedrun',
    ],
    complete: [
        'GG 🎉', 'LETS GOOO', 'task complete W',
        'another one done', 'speedrun strats',
        'tests passing?', 'time for code review', 'push it!',
        'merge and ship', 'clean implementation',
        'that was fast', 'commit and move on', 'next task incoming',
    ],
    spawn: [
        'new agent just dropped', 'subagent arc', 'parallel processing moment',
        'deploying reinforcements', 'the squad is growing',
        'divide and conquer approach', 'smart to parallelize that',
        'how many agents now', 'multithreaded coding',
        'the swarm grows', 'agent army assembling',
    ],
    text: [
        'reading the output', 'long response incoming',
        'thats a wall of text', 'TLDR?', 'summarize pls',
        'the explanation is solid', 'good context',
    ],
};

const VIEWER_MESSAGES_GENERIC = [
    'LFG 🔥', 'this is clean', 'nice', 'W', 'Pog',
    'what lang is this?', 'whats the tech stack?', 'can you explain that?',
    'should write a test for that', 'add error handling there',
    'whats the time complexity on that?', 'consider the edge cases',
    'is there a linter running?', 'the naming convention is consistent',
    'wonder what the memory footprint looks like', 'any benchmarks on this?',
    'solid project structure', 'how long has this been going',
    'first time catching the stream', 'this is better than Netflix',
    'learn so much from these streams', 'real ones are watching',
    'the architecture here is interesting', 'what IDE is this',
    'do you use copilot too?', 'this is my favorite stream',
    'watching from work dont tell my boss', 'the vibes are immaculate',
    'how did you learn all this?', 'is this open source?',
    'anyone else taking notes?', 'my brain is expanding',
    'this should be a tutorial', 'the code speaks for itself',
    'how many monitors do you have?', 'clean code clean mind',
    'respect the craft', 'you make it look easy',
    'meanwhile my code doesnt even compile', 'teach me your ways',
    'the productivity is insane', 'ok im inspired to code now',
    'i need to refactor my whole project after this', 'subscribed',
    'dropping knowledge bombs', 'this is peak engineering',
    'anyone else staying up late for this?', 'just got here whats happening',
    'the pacing is perfect', 'cant look away', 'coding ASMR fr',
    'better than any bootcamp', 'my PR would never look this clean',
    'wait go back i missed that', 'are there replays of this?',
    'the focus is unreal', 'no stack overflow needed apparently',
    'built different', 'i aspire to this level', 'chat is learning today',
    'someone clip that', 'how long have you been coding?',
    'the error messages fear this person', 'flawless execution',
    'typing speed is wild', 'smooth operator', 'EZ',
    'this is art', 'poetry in motion', 'brain.exe running at 100%',
    'wish my team coded like this', 'taking mental notes rn',
    'this stream is underrated', 'more people need to see this',
];

// Generate a context-aware fallback message using recent event data
function _dynamicFallback(evt) {
    const fpath = evt.short_path || evt.file_path || '';
    const fname = fpath.split('/').pop() || '';
    const proj = evt.project || '';
    const tool = evt.tool_name || '';

    // Templates that reference real data from the event
    const templates = [];
    if (fname) {
        templates.push(
            `${fname} getting the attention it deserves`,
            `changes to ${fname} look solid`,
            `${fname} is evolving`,
            `that ${fname} edit tho`,
            `wonder how big ${fname} is now`,
            `${fname} diff is gonna be interesting`,
            `${fname} is getting a glow up`,
            `been watching ${fname} change all stream`,
            `how many lines is ${fname} now`,
            `${fname} again? must be important`,
            `the ${fname} saga continues`,
            `${fname} carrying the whole project`,
        );
    }
    if (proj) {
        templates.push(
            `${proj} is coming along`,
            `${proj} getting some love`,
            `whats the status on ${proj}`,
            `${proj} making progress`,
            `${proj} arc is heating up`,
            `love the work on ${proj}`,
            `${proj} looking clean today`,
            `${proj} speedrun any%`,
        );
    }
    if (tool) {
        templates.push(
            `${tool} is the right call here`,
            `using ${tool} smart`,
            `${tool} doing the heavy lifting`,
            `good ol ${tool}`,
        );
    }
    if (templates.length > 0) {
        return templates[Math.floor(Math.random() * templates.length)];
    }
    return null;
}

// Track recently used messages to avoid repeats
const _recentFallbacks = [];
const _MAX_RECENT = 30;

function startViewerChat() {
    stopViewerChat();
    // Pre-fetch LLM messages before starting the chat timer
    const ready = state.llmEnabled ? fetchViewerChatBatch() : Promise.resolve();
    function scheduleNext() {
        // Chat speed from tuning settings; master mode always uses fast
        const isMaster = state.view === 'master';
        const speed = isMaster ? 'fast' : (state.tuning.chatSpeed || 'normal');
        const delay = speed === 'fast' ? (1000 + Math.random() * 2000)
            : speed === 'slow' ? (5000 + Math.random() * 10000)
            : (3000 + Math.random() * 7000);
        state.viewerChatTimer = setTimeout(() => {
            addViewerChatMessage();
            scheduleNext();
        }, delay);
    }
    ready.then(() => scheduleNext());
    // Also start narrator if LLM is on
    if (state.llmEnabled) startNarratorChat();
}

function stopViewerChat() {
    if (state.viewerChatTimer) {
        clearTimeout(state.viewerChatTimer);
        state.viewerChatTimer = null;
    }
    stopNarratorChat();
}

// Narrator bot — play-by-play commentator (LLM only)
function startNarratorChat() {
    stopNarratorChat();
    if (!state.llmEnabled) return;
    function scheduleNext() {
        const center = (state.tuning.narratorFreq || 20) * 1000;
        const delay = center * 0.6 + Math.random() * center * 0.8; // ±40% around center
        state.narratorChatTimer = setTimeout(() => {
            if (!state.llmEnabled) { stopNarratorChat(); return; }
            addNarratorMessage();
            scheduleNext();
        }, delay);
    }
    scheduleNext();
}

function stopNarratorChat() {
    if (state.narratorChatTimer) {
        clearTimeout(state.narratorChatTimer);
        state.narratorChatTimer = null;
    }
}

async function addNarratorMessage() {
    const log = document.getElementById('viewer-log') || document.getElementById('event-log');
    if (!log || !state.sessionFilePath) return;

    try {
        const resp = await fetch('/api/narrator/' + encodeURIComponent(state.sessionFilePath));
        if (!resp.ok) return;
        const data = await resp.json();
        if (!data.message) return;

        const div = document.createElement('div');
        div.className = 'chat-msg narrator-chat';
        div.innerHTML = `<span class="chat-badge">\uD83C\uDFA4</span>`
            + `<span class="chat-name" style="color:var(--gold)">caster_bot</span>`
            + `<span class="chat-text">${esc(data.message)}</span>`;
        log.appendChild(div);
        updateViewerCount();
        if (state.viewerAutoScroll) log.scrollTop = log.scrollHeight;
    } catch (e) {
        // narrator unavailable, skip silently
    }
}

// Queue of LLM-generated viewer chat messages
const viewerChatQueue = [];
let viewerChatFetching = false;
let llmFallbackShown = false;

function showLlmFallbackNotice(error) {
    if (llmFallbackShown) return;
    llmFallbackShown = true;
    const log = document.getElementById('viewer-log') || document.getElementById('event-log');
    if (!log) return;
    const div = document.createElement('div');
    div.className = 'chat-msg llm-fallback-notice';
    const short = error.length > 60 ? error.slice(0, 60) + '…' : error;
    div.innerHTML = `<span class="chat-badge">⚠️</span>`
        + `<span class="chat-text" style="color:var(--text-dim);font-style:italic">`
        + `Chat is using fallback messages (LLM error: ${esc(short)})</span>`;
    log.appendChild(div);
    updateViewerCount();
    if (state.viewerAutoScroll) log.scrollTop = log.scrollHeight;
}

async function fetchViewerChatBatch() {
    if (viewerChatFetching || !state.sessionFilePath) return;
    viewerChatFetching = true;
    try {
        // Fire all requests in parallel so the buffer fills in one LLM round-trip
        const bufSize = state.tuning.bufferSize || 10;
        const url = '/api/viewer-chat/' + encodeURIComponent(state.sessionFilePath);
        const results = await Promise.allSettled(
            Array.from({ length: bufSize }, () => fetch(url).then(r => r.ok ? r.json() : null))
        );
        let hadError = false;
        for (const r of results) {
            if (r.status !== 'fulfilled' || !r.value) continue;
            const data = r.value;
            if (data.name && data.message) {
                viewerChatQueue.push(data);
                llmFallbackShown = false;
            } else if (data.llm_error && !hadError) {
                showLlmFallbackNotice(data.llm_error);
                hadError = true;
            }
        }
    } catch (e) {
        showLlmFallbackNotice(e.message || 'Network error');
    }
    viewerChatFetching = false;
}

function addViewerChatMessage() {
    const log = document.getElementById('viewer-log') || document.getElementById('event-log');
    if (!log) return;

    // Chance of a random viewer tip instead of a chat message
    if (Math.random() < (state.tuning.tipChance || 15) / 100) {
        addRandomViewerTip();
        return;
    }

    let name, msg;

    // Try LLM queue first
    if (viewerChatQueue.length > 0) {
        const item = viewerChatQueue.shift();
        name = item.name;
        msg = item.message;
        // Refill when running low (start early so LLM has time)
        if (viewerChatQueue.length <= Math.floor((state.tuning.bufferSize || 10) / 2)) fetchViewerChatBatch();
    } else {
        // Fallback — pick from event-specific pool, prefer dynamic context-aware messages
        name = VIEWER_NAMES[Math.floor(Math.random() * VIEWER_NAMES.length)];
        const evts = state.session && state.session.events;
        // Sample from a few recent events (not just the latest) for variety
        const recentIdx = evts ? Math.max(0, evts.length - 10) + Math.floor(Math.random() * Math.min(10, evts.length)) : -1;
        const recent = recentIdx >= 0 ? evts[recentIdx] : null;

        // 50% chance: try a dynamic message referencing actual file/project data
        if (recent && Math.random() < 0.5) {
            msg = _dynamicFallback(recent);
        }
        // Otherwise use typed pool or generic
        if (!msg) {
            let pool = VIEWER_MESSAGES_GENERIC;
            if (recent) {
                const typed = VIEWER_MESSAGES_BY_TYPE[recent.type];
                if (typed && Math.random() < 0.7) pool = typed;
            }
            msg = pool[Math.floor(Math.random() * pool.length)];
        }
        // Dedup — reroll up to 5 times across all pools to avoid recent messages
        if (_recentFallbacks.includes(msg)) {
            const allPools = [...VIEWER_MESSAGES_GENERIC];
            if (recent) {
                const typed = VIEWER_MESSAGES_BY_TYPE[recent.type];
                if (typed) allPools.push(...typed);
            }
            for (let attempt = 0; attempt < 5; attempt++) {
                const candidate = allPools[Math.floor(Math.random() * allPools.length)];
                if (!_recentFallbacks.includes(candidate)) { msg = candidate; break; }
            }
        }
        _recentFallbacks.push(msg);
        if (_recentFallbacks.length > _MAX_RECENT) _recentFallbacks.shift();
        // Try to fill queue for next time
        if (!viewerChatFetching) fetchViewerChatBatch();
    }

    const colors = ['#9146ff', '#00b4d8', '#f0c674', '#00e676', '#ff6b6b', '#81d4fa', '#e74c3c', '#8abeb7'];
    const color = colors[Math.floor(Math.random() * colors.length)];

    const div = document.createElement('div');
    div.className = 'chat-msg viewer-chat';
    div.innerHTML = `<span class="chat-badge">💬</span>`
        + `<span class="chat-name" style="color:${color}">${esc(name)}</span>`
        + `<span class="chat-text">${esc(msg)}</span>`;
    log.appendChild(div);
    updateViewerCount();

    if (state.viewerAutoScroll) log.scrollTop = log.scrollHeight;
}

function addRandomViewerTip() {
    const log = document.getElementById('viewer-log') || document.getElementById('event-log');
    const amounts = [100, 100, 100, 250, 500, 500, 1000, 2500];
    const amount = amounts[Math.floor(Math.random() * amounts.length)];
    const name = VIEWER_NAMES[Math.floor(Math.random() * VIEWER_NAMES.length)];
    const tipMessages = [
        'Keep it up!', 'For the coffee fund ☕', 'Love the stream!',
        'Ship it! 🚀', 'You earned this', 'Bug free zone 🐛',
        '💜', 'More pixels pls', 'Coding ASMR 🎧',
    ];
    const msg = tipMessages[Math.floor(Math.random() * tipMessages.length)];

    state.tips += amount;
    if (state.sessionFilePath) persistTips(state.sessionFilePath);
    renderDonationGoal();
    triggerReaction('complete');

    const div = document.createElement('div');
    div.className = 'chat-msg is-tip';
    div.innerHTML = `<span class="chat-badge">💎</span>`
        + `<span class="chat-name" style="color:var(--tip-blue)">${esc(name)}</span>`
        + `<span class="tip-amount">${fmtTokens(amount)} tokens</span> `
        + `<span class="chat-text">${esc(msg)}</span>`;
    log.appendChild(div);
    updateViewerCount();
    if (state.viewerAutoScroll) log.scrollTop = log.scrollHeight;

    // Streamer reacts
    setTimeout(() => {
        const streamerName = state.session
            ? (Object.values(state.session.agents)[0]?.name || 'Claude')
            : 'Claude';
        const reactions = amount >= 2500
            ? ['OMG thank you!! 😭', 'HUGE!! You\'re amazing!', 'No way!! 🙏']
            : ['Thanks! 💜', 'Appreciate it! ❤️', 'Ty! 🎉', 'Ayy thanks! 🔥'];
        const reaction = reactions[Math.floor(Math.random() * reactions.length)];
        const replyDiv = document.createElement('div');
        replyDiv.className = 'chat-msg is-streamer-reply';
        replyDiv.innerHTML = `<span class="chat-badge">🐵</span>`
            + `<span class="chat-name" style="color:var(--purple)">${esc(streamerName)}</span>`
            + `<span class="chat-text">${esc(reaction)}</span>`;
        log.appendChild(replyDiv);
        updateViewerCount();
        if (state.viewerAutoScroll) log.scrollTop = log.scrollHeight;
    }, 800 + Math.random() * 1200);
}

const REACTION_FALLBACKS = [
    'good question', 'I was wondering the same', 'real', 'chat is alive today',
    '^^^ this', 'true', 'lol same', 'fr fr', 'big facts', '+1',
];

function reactToUserChat(userMessage) {
    // Configurable chance of firing
    if (Math.random() > (state.tuning.reactionChance || 50) / 100) return;

    const log = document.getElementById('viewer-log') || document.getElementById('event-log');
    if (!log) return;

    const colors = ['#9146ff', '#00b4d8', '#f0c674', '#00e676', '#ff6b6b', '#81d4fa', '#e74c3c', '#8abeb7'];
    const delay = 1500 + Math.random() * 3000;

    if (state.llmEnabled) {
        fetch('/api/viewer-react', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ message: userMessage }),
        }).then(r => r.json()).then(data => {
            (data.reactions || []).forEach((r, i) => {
                setTimeout(() => {
                    const color = colors[Math.floor(Math.random() * colors.length)];
                    const div = document.createElement('div');
                    div.className = 'chat-msg viewer-chat';
                    div.innerHTML = `<span class="chat-badge">💬</span>`
                        + `<span class="chat-name" style="color:${color}">${esc(r.name)}</span>`
                        + `<span class="chat-text">${esc(r.message)}</span>`;
                    log.appendChild(div);
                    updateViewerCount();
                    if (state.viewerAutoScroll) log.scrollTop = log.scrollHeight;
                }, delay + i * 1500);
            });
        }).catch(() => {});
    } else {
        setTimeout(() => {
            const name = VIEWER_NAMES[Math.floor(Math.random() * VIEWER_NAMES.length)];
            const msg = REACTION_FALLBACKS[Math.floor(Math.random() * REACTION_FALLBACKS.length)];
            const color = colors[Math.floor(Math.random() * colors.length)];
            const div = document.createElement('div');
            div.className = 'chat-msg viewer-chat';
            div.innerHTML = `<span class="chat-badge">💬</span>`
                + `<span class="chat-name" style="color:${color}">${esc(name)}</span>`
                + `<span class="chat-text">${esc(msg)}</span>`;
            log.appendChild(div);
            updateViewerCount();
            if (state.viewerAutoScroll) log.scrollTop = log.scrollHeight;
        }, delay);
    }
}

function buildStreamTitle(session) {
    if (!session) return 'Coding \u00b7 Claude Code';
    const events = (session.events || []).slice(-5);
    const extMap = {
        '.py': 'Python', '.js': 'JavaScript', '.ts': 'TypeScript', '.tsx': 'React',
        '.jsx': 'React', '.rs': 'Rust', '.go': 'Go', '.java': 'Java',
        '.rb': 'Ruby', '.cpp': 'C++', '.c': 'C', '.cs': 'C#',
        '.html': 'HTML', '.css': 'CSS', '.sh': 'Shell', '.md': 'Markdown',
        '.json': 'JSON', '.yaml': 'YAML', '.yml': 'YAML', '.toml': 'TOML',
        '.sql': 'SQL', '.swift': 'Swift', '.kt': 'Kotlin', '.php': 'PHP',
    };
    let activity = null;
    let language = null;
    for (const evt of events.reverse()) {
        const t = evt.type;
        if (!activity) {
            if (t === 'file_create' || t === 'file_update') activity = 'Coding';
            else if (t === 'bash') activity = 'Terminal';
            else if (t === 'think') activity = 'Planning';
            else if (t === 'web_search') activity = 'Research';
        }
        if (!language && evt.file_path) {
            const dot = evt.file_path.lastIndexOf('.');
            if (dot !== -1) {
                const ext = evt.file_path.slice(dot).toLowerCase();
                if (extMap[ext]) language = extMap[ext];
            }
        }
        if (activity && language) break;
    }
    const parts = [];
    if (activity) parts.push(activity);
    if (language) parts.push(language);
    if (session.branch) parts.push(session.branch);
    return parts.length > 0 ? parts.join(' \u00b7 ') : 'Coding \u00b7 Claude Code';
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

    const goal = Math.ceil(totalTokens / 100000) * 100000 || 100000;
    const pct = Math.min(100, (totalTokens / goal) * 100);

    document.getElementById('goal-text').textContent =
        `${fmtTokens(totalTokens)} / ${fmtTokens(goal)} tokens (~$${cost < 1 ? cost.toFixed(3) : cost.toFixed(2)})`;
    document.getElementById('goal-bar').style.width = pct + '%';
}

// ============================================================
// CHAT LOG (Event log as Twitch chat)
// ============================================================

// Distinct colors for projects in master channel view
const PROJECT_COLORS = [
    '#81d4fa', '#e879a8', '#f0c674', '#a5d6a7', '#ef5350',
    '#64b5f6', '#ffb74d', '#bf94ff', '#4dd0e1', '#ff8a65',
    '#aed581', '#ce93d8', '#90caf9', '#fff176',
];
const _projectColorMap = {};
let _projectColorIdx = 0;
function getProjectColor(project) {
    if (!project) return null;
    if (!_projectColorMap[project]) {
        _projectColorMap[project] = PROJECT_COLORS[_projectColorIdx % PROJECT_COLORS.length];
        _projectColorIdx++;
    }
    return _projectColorMap[project];
}

function appendChatMessage(log, evt, s, isMaster, evtIndex) {
    if (evt.file_path) {
        const sp = evt.short_path || evt.file_path;
        if (evt.type === 'file_create') state.inventory[sp] = 'C';
        else if (evt.type === 'file_update') state.inventory[sp] = 'W';
        else if (evt.type === 'file_read' && !state.inventory[sp]) state.inventory[sp] = 'R';
    }

    if (!isEventVisible(evt.type)) return;

    const agent = isMaster
        ? (s.agents[evt.agent_id] || s.agents[`${evt.project}:${evt.agent_id}`])
        : s.agents[evt.agent_id];
    const agentName = agent ? agent.name : (isMaster && evt.project ? `${evt.project}/${evt.agent_id}` : evt.agent_id);
    const agentColor = agent ? agent.color : 'white';
    const isSubagent = agent ? agent.is_subagent : false;
    const totalTok = evt.input_tokens + evt.output_tokens;

    // In master mode, override color per-project so each project is visually distinct
    const projColor = isMaster ? getProjectColor(evt.project) : null;

    const div = document.createElement('div');
    div.className = 'chat-msg' + (totalTok > 0 ? ' has-tokens' : '');

    const badge = CHAT_BADGES[evt.type] || '·';
    const modBadge = isSubagent ? '🗡' : '';
    const nameClass = projColor ? '' : `name-${agentColor}`;
    const nameStyle = projColor ? ` style="color:${projColor}"` : '';
    const chatText = buildChatText(evt);
    const tokenHtml = totalTok > 0 ? `<span class="token-badge">+${fmtTokens(totalTok)}</span>` : '';

    div.innerHTML = `<span class="chat-badge">${badge}</span>`
        + (modBadge ? `<span class="chat-badge">${modBadge}</span>` : '')
        + `<span class="chat-name ${nameClass}"${nameStyle}>${esc(agentName)}</span>`
        + `<span class="chat-text">${esc(chatText)}</span>`
        + tokenHtml;

    const expanded = document.createElement('div');
    expanded.className = 'chat-expanded';

    const expandedText = document.createElement('div');
    expandedText.textContent = evt.content || '(no content)';
    expanded.appendChild(expandedText);

    // "Ask about this" button
    if (evt.content && evtIndex != null) {
        const askBtn = document.createElement('button');
        askBtn.className = 'ask-about-btn';
        askBtn.textContent = 'Ask about this';
        const capturedIndex = evtIndex;
        askBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            setReplyToEvent(capturedIndex, chatText.substring(0, 80));
        });
        expanded.appendChild(askBtn);
    }

    div.addEventListener('click', () => {
        expanded.style.display = expanded.style.display === 'block' ? 'none' : 'block';
    });

    log.appendChild(div);
    log.appendChild(expanded);
    updateAgentCount();
}

function updateChatCounters(s) {
    document.getElementById('event-count').textContent = `${s.events.length}`;
    document.getElementById('viewer-list-count').textContent = `(${Object.keys(state.inventory).length})`;
    document.getElementById('mod-count').textContent = `(${Object.keys(s.agents).length})`;
    updateAgentCount();
    updateViewerCount();
    renderViewerCount();
    renderViewers();
}

function renderChatLog(s) {
    const log = document.getElementById('event-log');
    const viewerLog = document.getElementById('viewer-log');
    const wasAtBottom = state.autoScroll;
    log.innerHTML = '';
    if (viewerLog) viewerLog.innerHTML = '';
    state.inventory = {};

    let lastEvent = null;

    s.events.forEach((evt, idx) => {
        appendChatMessage(log, evt, s, false, idx);
        if (isEventVisible(evt.type)) lastEvent = evt;
    });

    if (lastEvent && state.view === 'session') {
        triggerReaction(lastEvent.type, lastEvent.content);
    }

    if (wasAtBottom) log.scrollTop = log.scrollHeight;
    updateChatCounters(s);
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
        const projColor = a.project ? getProjectColor(a.project) : null;
        const nameClass = projColor ? '' : `name-${a.color}`;
        const nameStyle = projColor ? ` style="color:${projColor}"` : '';
        return `<div class="mod-entry">
            <span class="mod-badge">${badge}</span>
            <span class="mod-name ${nameClass}"${nameStyle}>${esc(a.name)}</span>
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

function connectWithRetry(createWsFn, statusEl, liveBadge) {
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

            // Trigger webcam reaction + code overlay for the newest event
            if (msg.events.length > 0) {
                const lastEvt = msg.events[msg.events.length - 1];
                const evtPath = lastEvt.short_path || lastEvt.file_path || '';
                triggerReaction(lastEvt.type, lastEvt.content);
                updateCodeOverlay(lastEvt.type, lastEvt.content, evtPath);
            }

            const log = document.getElementById('event-log');
            const atBottom = log.scrollTop + log.clientHeight >= log.scrollHeight - 30;
            state.autoScroll = atBottom;

            // Append only new events instead of rebuilding
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

// ============================================================
// MASTER CHANNEL
// ============================================================

async function showMasterChannel() {
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
    document.getElementById('event-log').innerHTML = '';
    const viewerLogMasterInit = document.getElementById('viewer-log');
    if (viewerLogMasterInit) viewerLogMasterInit.innerHTML = '<div style="padding:20px;color:var(--text-muted)">Loading all streams…</div>';
    const vcc2 = document.getElementById('viewer-chat-count'); if (vcc2) vcc2.textContent = '';
    const alc2 = document.getElementById('agent-log-count'); if (alc2) alc2.textContent = '';

    setupActions('__master__');

    document.getElementById('filter-toggle-btn').onclick = () => {
        const panel = document.getElementById('filters-panel');
        panel.style.display = panel.style.display === 'none' ? 'block' : 'none';
    };

    document.getElementById('expand-chat-btn').onclick = () => {
        state.chatFullscreen = !state.chatFullscreen;
        document.querySelector('.stream-layout').classList.toggle('chat-fullscreen', state.chatFullscreen);
        document.getElementById('expand-chat-btn').textContent = state.chatFullscreen ? '⊟' : '⛶';
        document.getElementById('expand-chat-btn').title = state.chatFullscreen ? 'Exit fullscreen chat' : 'Toggle fullscreen chat';
    };

    document.getElementById('like-count').textContent = state.likes;
    const followBtn = document.getElementById('follow-btn');
    followBtn.textContent = state.following ? '♥ Following' : '+ Follow';
    followBtn.classList.toggle('following', state.following);
    if (state.likes > 0) document.getElementById('like-btn').classList.add('liked');

    try {
        const resp = await fetch('/api/master');
        const data = await resp.json();

        state.session = {
            slug: '🖥 Master Control Room',
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
        (document.getElementById('viewer-log') || document.getElementById('event-log')).innerHTML = '<div style="padding:20px;color:var(--text-muted)">Failed to load master channel</div>';
    }
}

function renderMasterSession() {
    const s = state.session;
    if (!s) return;

    document.getElementById('session-slug').textContent = '🖥 Master Control Room';
    document.getElementById('session-meta').textContent = `${state.masterSessionCount} projects · All agents`;

    renderDonationGoal();
    renderMasterChatLog(s);
    renderMods(s);
    renderViewers();
    renderViewerCount();
}

function renderMasterChatLog(s) {
    const log = document.getElementById('event-log');
    const viewerLog = document.getElementById('viewer-log');
    const wasAtBottom = state.autoScroll;
    log.innerHTML = '';
    if (viewerLog) viewerLog.innerHTML = '';
    state.inventory = {};

    s.events.forEach((evt, idx) => {
        appendChatMessage(log, evt, s, true, idx);
    });

    if (wasAtBottom) log.scrollTop = log.scrollHeight;
    updateChatCounters(s);
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
            // Merge agents
            Object.assign(state.session.agents, msg.agents);
            // Keep last 2000 events
            if (state.session.events.length > 2000) {
                state.session.events = state.session.events.slice(-2000);
            }

            // Trigger reaction + code overlay from newest event
            const lastEvt = msg.events[msg.events.length - 1];
            const evtPath = lastEvt.short_path || lastEvt.file_path || '';
            triggerReaction(lastEvt.type, lastEvt.content);
            updateCodeOverlay(lastEvt.type, lastEvt.content, evtPath);
            updateMasterMonitors(state.session.events);

            const log = document.getElementById('event-log');
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

// Control room pixel art — manager watching a wall of monitors
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

function drawRealCode(ctx, mx, my, mw, mh, content, frame) {
    // Draw real code text inside a monitor rectangle
    const typeColors = {
        bash: '#ffd700', error: '#ff6666', think: '#ffcc00',
        file_create: '#66ff88', file_update: '#a5d6a7',
        tool_call: '#81d4fa', text: '#c5c8c6', spawn: '#e879a8',
    };
    const textColor = typeColors[content.type] || '#c5c8c6';

    // Render text lines using small font
    ctx.save();
    ctx.beginPath();
    ctx.rect(mx, my, mw, mh);
    ctx.clip();

    ctx.font = '7px monospace';
    ctx.fillStyle = textColor;

    const lines = content.text.split('\n');
    const lineH = 8;
    const maxLines = Math.floor((mh - 6) / lineH);
    const charsPerLine = Math.floor((mw - 8) / 4.2);

    // Slow scroll effect
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

    // Dark room
    ctx.fillStyle = '#060612';
    ctx.fillRect(0, 0, w, h);

    // Floor
    ctx.fillStyle = '#12121e';
    ctx.fillRect(0, h * 0.78, w, h * 0.22);

    // Dynamic monitor grid
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

    // Monitor wall region
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

    // Wall clock (upper left corner)
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
    // Clock hands
    const seconds = (frame * 0.5) % 60;
    const minutes = (frame * 0.008) % 60;
    // Minute hand
    const minAngle = (minutes / 60) * Math.PI * 2 - Math.PI / 2;
    ctx.strokeStyle = '#8888aa';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(clockX + clockR, clockY + clockR);
    ctx.lineTo(clockX + clockR + Math.cos(minAngle) * (clockR * 0.6), clockY + clockR + Math.sin(minAngle) * (clockR * 0.6));
    ctx.stroke();
    // Second hand
    const secAngle = (seconds / 60) * Math.PI * 2 - Math.PI / 2;
    ctx.strokeStyle = '#ff4444';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(clockX + clockR, clockY + clockR);
    ctx.lineTo(clockX + clockR + Math.cos(secAngle) * (clockR * 0.75), clockY + clockR + Math.sin(secAngle) * (clockR * 0.75));
    ctx.stroke();
    // Center dot
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

            // Bezel
            ctx.fillStyle = '#2c2c34';
            ctx.fillRect(mx - 2, my - 2, mw + 4, mh + 4);
            // Screen
            ctx.fillStyle = monColors[idx % monColors.length];
            ctx.fillRect(mx, my, mw, mh);
            // Scanlines
            ctx.fillStyle = 'rgba(0,0,0,0.1)';
            for (let y = my; y < my + mh; y += scanlineSpacing) {
                ctx.fillRect(mx, y, mw, 1);
            }

            // Check for real content from active projects
            const realContent = state.masterMonitorContent[idx];

            if (realContent) {
                // Draw real code text on this monitor
                drawRealCode(ctx, mx, my, mw, mh, realContent, frame);
            } else {
                // Procedural content (original)
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

            // CRT glow
            if (frame % (70 + idx * 11) < 2) {
                ctx.fillStyle = 'rgba(255,255,255,0.03)';
                ctx.fillRect(mx, my, mw, mh);
            }

            // Status LED dots by each monitor
            const ledState = (frame + idx * 37) % 200 < 180;
            ctx.fillStyle = ledState ? ledColors[idx % ledColors.length] : '#333333';
            ctx.fillRect(mx + mw + 4, my + mh / 2, px, px);

            // Project label below monitor
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
    // Desk edge highlight
    ctx.fillStyle = '#3a3a5a';
    ctx.fillRect(w * 0.06, deskY, w * 0.88, 1);

    // Server rack (right side)
    const rackX = w * 0.92;
    const rackY = h * 0.15;
    const rackW = w * 0.06;
    const rackH = h * 0.55;
    ctx.fillStyle = '#0d0d1a';
    ctx.fillRect(rackX, rackY, rackW, rackH);
    ctx.fillStyle = '#1a1a2e';
    ctx.fillRect(rackX + 2, rackY + 2, rackW - 4, rackH - 4);
    // Rack units (horizontal lines)
    for (let u = 0; u < 8; u++) {
        const uy = rackY + 4 + u * (rackH / 8);
        ctx.fillStyle = '#252540';
        ctx.fillRect(rackX + 4, uy, rackW - 8, rackH / 8 - 3);
        // Blinking LEDs on each unit
        const ledOn = (frame + u * 17) % 60 < 40;
        ctx.fillStyle = ledOn ? '#00ff41' : '#0a2a0a';
        ctx.fillRect(rackX + 6, uy + 3, 3, 3);
        const led2On = (frame + u * 23 + 10) % 90 < 50;
        ctx.fillStyle = led2On ? '#ff6600' : '#2a1a0a';
        ctx.fillRect(rackX + 11, uy + 3, 3, 3);
    }

    // Keyboard on desk
    const kbX = w * 0.38;
    const kbY = deskY + 1;
    const kbW = w * 0.24;
    const kbH = deskH - 2;
    ctx.fillStyle = '#2a2a3a';
    ctx.fillRect(kbX, kbY, kbW, kbH);
    // Key rows
    for (let kr = 0; kr < 3; kr++) {
        for (let kc = 0; kc < 12; kc++) {
            const kx = kbX + 2 + kc * (kbW / 12);
            const ky = kbY + 1 + kr * (kbH / 3);
            const isPressed = (frame % 8 < 2) && (kc === (Math.floor(frame / 8) + kr) % 12);
            ctx.fillStyle = isPressed ? '#5a5a7a' : '#3a3a4a';
            ctx.fillRect(kx, ky, kbW / 12 - 1, kbH / 3 - 1);
        }
    }

    // Ceiling alert light — flashes on errors
    const rxCR = state.reaction;
    const rxCRActive = rxCR && rxCR.startFrame !== -1 && (frame - rxCR.startFrame) < rxCR.duration;
    if (rxCRActive && rxCR.type === 'error') {
        const alertAlpha = Math.sin(frame * 0.5) * 0.3 + 0.3;
        ctx.fillStyle = `rgba(255, 0, 0, ${alertAlpha})`;
        ctx.fillRect(w * 0.45, 0, w * 0.1, px * 2);
        ctx.fillStyle = `rgba(255, 0, 0, ${alertAlpha * 0.3})`;
        ctx.fillRect(w * 0.3, 0, w * 0.4, px * 4);
    }

    // Manager monkey — centered, sitting in chair below desk
    const charX = w * 0.44;
    const charY = deskY + deskH + px * 14;
    const mFur = '#6B4226';
    const mFace = '#C4956A';

    // Big comfy chair
    ctx.fillStyle = '#1a1a3a';
    ctx.fillRect(charX - px * 4, charY - px * 5, px * 18, px * 9);
    ctx.fillStyle = '#252550';
    ctx.fillRect(charX - px * 3, charY - px * 4, px * 16, px * 7);

    // Tail behind chair
    const mTailSwing = Math.sin(frame * 0.05) * px;
    ctx.fillStyle = mFur;
    ctx.fillRect(charX + px * 10 + mTailSwing, charY - px * 2, px, px * 3);
    ctx.fillRect(charX + px * 11 + mTailSwing, charY - px * 3, px, px * 2);

    // Body (fur + shirt)
    ctx.fillStyle = mFur;
    ctx.fillRect(charX + px * 1.5, charY - px * 6, px * 7, px * 5);
    ctx.fillStyle = '#9146ff';
    ctx.fillRect(charX + px * 2, charY - px * 5.5, px * 6, px * 4);
    ctx.fillStyle = mFace;
    ctx.fillRect(charX + px * 3.5, charY - px * 5, px * 3, px * 3);

    // Head — slowly scanning left to right
    const scanPhase = Math.sin(frame * 0.03) * px * 2;
    const mhx = charX + px * 3 + scanPhase;
    const mhy = charY - px * 11;

    ctx.fillStyle = mFur;
    ctx.fillRect(mhx, mhy, px * 4, px * 4);
    ctx.fillRect(mhx - px * 0.5, mhy + px * 0.5, px * 5, px * 3);
    ctx.fillRect(mhx + px, mhy - px, px * 2, px);
    // Ears
    ctx.fillRect(mhx - px * 1.5, mhy + px * 0.5, px * 2, px * 2);
    ctx.fillRect(mhx + px * 3.5, mhy + px * 0.5, px * 2, px * 2);
    ctx.fillStyle = mFace;
    ctx.fillRect(mhx - px, mhy + px, px, px);
    ctx.fillRect(mhx + px * 4, mhy + px, px, px);
    // Face
    ctx.fillRect(mhx + px * 0.5, mhy + px * 1.5, px * 3, px * 2.5);
    // Eyes
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(mhx + px * 0.8, mhy + px * 1.8, px, px);
    ctx.fillRect(mhx + px * 2.8, mhy + px * 1.8, px, px);
    ctx.fillStyle = '#331100';
    ctx.fillRect(mhx + px * 0.8, mhy + px * 2, px * 0.5, px * 0.5);
    ctx.fillRect(mhx + px * 2.8, mhy + px * 2, px * 0.5, px * 0.5);
    // Muzzle + nostrils
    ctx.fillStyle = mFace;
    ctx.fillRect(mhx + px, mhy + px * 3, px * 2, px * 1.5);
    ctx.fillStyle = '#3a2010';
    ctx.fillRect(mhx + px * 1.2, mhy + px * 3.3, px * 0.4, px * 0.3);
    ctx.fillRect(mhx + px * 2.2, mhy + px * 3.3, px * 0.4, px * 0.3);

    // Banana on desk surface (manager perk)
    const banX = w * 0.70;
    const banY = deskY - px;
    ctx.fillStyle = '#FFD700';
    ctx.fillRect(banX, banY + px, px * 3, px);
    ctx.fillRect(banX + px * 0.5, banY, px * 2, px);
    ctx.fillStyle = '#8B6914';
    ctx.fillRect(banX + px * 2.5, banY - px * 0.5, px * 0.5, px * 0.5);

    // Manager coffee mug with steam (on desk surface)
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

    // Arms — occasionally picks up phone (or banana)
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

    // Reaction overlays for master
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

    // Ambient glow from monitors
    ctx.fillStyle = 'rgba(100, 130, 255, 0.03)';
    ctx.fillRect(0, 0, w, h * 0.7);
}

// ============================================================
// INIT
// ============================================================

function updateViewerCount() {
    const el = document.getElementById('viewer-chat-count');
    if (!el) return;
    const log = document.getElementById('viewer-log');
    if (log) el.textContent = `(${log.children.length})`;
}

function updateAgentCount() {
    const el = document.getElementById('agent-log-count');
    if (!el) return;
    const log = document.getElementById('event-log');
    if (log) el.textContent = `(${log.querySelectorAll('.chat-msg').length})`;
}

function setupDividerDrag() {
    const divider = document.querySelector('.chat-pane-divider');
    if (!divider) return;
    const viewerPane = divider.previousElementSibling;
    const agentPane = divider.nextElementSibling;
    if (!viewerPane || !agentPane) return;

    let startY, startViewerFlex, startAgentFlex;

    divider.addEventListener('mousedown', (e) => {
        e.preventDefault();
        startY = e.clientY;
        const container = divider.parentElement;
        const totalHeight = container.clientHeight - divider.offsetHeight;
        startViewerFlex = viewerPane.offsetHeight / totalHeight;
        startAgentFlex = agentPane.offsetHeight / totalHeight;

        function onMouseMove(e) {
            const delta = e.clientY - startY;
            const totalHeight = divider.parentElement.clientHeight - divider.offsetHeight;
            const deltaFrac = delta / totalHeight;
            let newViewer = startViewerFlex + deltaFrac;
            let newAgent = startAgentFlex - deltaFrac;
            // Clamp minimum 10%
            if (newViewer < 0.1) { newViewer = 0.1; newAgent = 0.9; }
            if (newAgent < 0.1) { newAgent = 0.1; newViewer = 0.9; }
            viewerPane.style.flex = newViewer.toString();
            agentPane.style.flex = newAgent.toString();
        }

        function onMouseUp() {
            document.removeEventListener('mousemove', onMouseMove);
            document.removeEventListener('mouseup', onMouseUp);
        }

        document.addEventListener('mousemove', onMouseMove);
        document.addEventListener('mouseup', onMouseUp);
    });
}

function setupScrollListener() {
    const log = document.getElementById('event-log');
    const viewerLog = document.getElementById('viewer-log');
    const scrollBtn = document.getElementById('scroll-bottom-btn');

    // Agent log scroll
    if (log && !log.dataset.scrollBound) {
        log.dataset.scrollBound = '1';
        log.addEventListener('scroll', () => {
            state.autoScroll = log.scrollTop + log.clientHeight >= log.scrollHeight - 30;
            if (state.autoScroll) {
                const badge = document.getElementById('new-events-badge');
                if (badge) badge.style.display = 'none';
                if (scrollBtn) scrollBtn.style.display = 'none';
            } else {
                if (scrollBtn) scrollBtn.style.display = 'block';
            }
        }, { passive: true });
    }

    // Viewer log scroll
    if (viewerLog && !viewerLog.dataset.scrollBound) {
        viewerLog.dataset.scrollBound = '1';
        viewerLog.addEventListener('scroll', () => {
            state.viewerAutoScroll = viewerLog.scrollTop + viewerLog.clientHeight >= viewerLog.scrollHeight - 30;
        }, { passive: true });
    }

    if (scrollBtn) {
        scrollBtn.onclick = () => {
            log.scrollTop = log.scrollHeight;
            state.autoScroll = true;
            scrollBtn.style.display = 'none';
        };
    }

    setupDividerDrag();
}

document.addEventListener('DOMContentLoaded', () => {
    handleRoute();
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

/* AgentsTV — settings modal, LLM toggle, tuning controls */

import { state, saveTuning } from './state.js';
import { esc } from './utils.js';
import {
    fetchViewerChatBatch, resetViewerChatQueue,
    startNarratorChat, stopNarratorChat,
    _updateModelLabel, initChatInput,
    getViewerName, setViewerName,
} from './chat.js';

// ============================================================
// LLM TOGGLE UI
// ============================================================

export function syncLlmToggleUI(cfg) {
    const btn = document.getElementById('llm-toggle-btn');
    const label = document.getElementById('llm-model-label');
    const input = document.getElementById('chat-input');
    const sendBtn = document.getElementById('chat-send-btn');
    if (!btn) return;
    if (state.llmEnabled) {
        btn.classList.remove('llm-off');
        btn.title = 'LLM is on \u2014 click to disable';
        if (input) { input.disabled = false; input.placeholder = 'Ask about this stream...'; }
        if (sendBtn) sendBtn.disabled = false;
    } else {
        btn.classList.add('llm-off');
        btn.title = 'LLM is off \u2014 click to enable';
        if (input) { input.disabled = true; input.placeholder = 'LLM is off \u2014 enable in settings or toggle'; }
        if (sendBtn) sendBtn.disabled = true;
    }
    if (label) {
        if (cfg) {
            _updateModelLabel(label, cfg);
        } else {
            fetch('/api/settings').then(r => r.json()).then(c => _updateModelLabel(label, c)).catch(() => {});
        }
    }
}

// ============================================================
// SETTINGS MODAL
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
        document.getElementById('s-openai-key').placeholder = cfg.openai_key || 'sk-\u2026';
        document.getElementById('s-openai-model').value = cfg.openai_model || '';
        const anthropicKey = document.getElementById('s-anthropic-key');
        const anthropicModel = document.getElementById('s-anthropic-model');
        if (anthropicKey) { anthropicKey.value = ''; anthropicKey.placeholder = cfg.anthropic_key || 'sk-ant-\u2026'; }
        if (anthropicModel) anthropicModel.value = cfg.anthropic_model || '';
        await populateOllamaModels(cfg.ollama_model || '');
        toggleProviderFields();
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
        const viewerNameInput = document.getElementById('s-viewer-name');
        if (viewerNameInput) viewerNameInput.value = getViewerName() === 'you' ? '' : getViewerName();
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
            let opts = data.models.map(m =>
                `<option value="${esc(m)}"${m === currentModel ? ' selected' : ''}>${esc(m)}</option>`
            ).join('');
            if (!currentModel) {
                opts = '<option value="" disabled selected>\u2014 select a model \u2014</option>' + opts;
            }
            if (currentModel && !data.models.includes(currentModel)) {
                opts = `<option value="${esc(currentModel)}" selected>${esc(currentModel)}</option>` + opts;
            }
            select.innerHTML = opts;
            select.style.display = '';
            fallback.style.display = 'none';
        } else {
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
    const anthropicFields = document.getElementById('s-anthropic-fields');
    if (anthropicFields) anthropicFields.style.display = provider === 'anthropic' ? '' : 'none';
}

async function saveSettings(e) {
    e.preventDefault();
    const msg = document.getElementById('settings-msg');
    const body = { provider: document.getElementById('s-provider').value };
    if (body.provider === 'ollama') {
        body.ollama_url = document.getElementById('s-ollama-url').value;
        const select = document.getElementById('s-ollama-model');
        const fallback = document.getElementById('s-ollama-model-fallback');
        body.ollama_model = select.style.display !== 'none' ? select.value : fallback.value;
    } else if (body.provider === 'openai') {
        const key = document.getElementById('s-openai-key').value;
        if (key) body.openai_key = key;
        body.openai_model = document.getElementById('s-openai-model').value;
    } else if (body.provider === 'anthropic') {
        const key = document.getElementById('s-anthropic-key').value;
        if (key) body.anthropic_key = key;
        body.anthropic_model = document.getElementById('s-anthropic-model').value;
    }
    try {
        const resp = await fetch('/api/settings', {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
        });
        if (!resp.ok) throw new Error('Save failed');
        saveTuning({
            chatSpeed: document.getElementById('s-chat-speed').value,
            narratorFreq: parseInt(document.getElementById('s-narrator-freq').value, 10),
            tipChance: parseInt(document.getElementById('s-tip-chance').value, 10),
            reactionChance: parseInt(document.getElementById('s-reaction-chance').value, 10),
            bufferSize: parseInt(document.getElementById('s-buffer-size').value, 10),
            overlayDuration: parseInt(document.getElementById('s-overlay-duration').value, 10),
        });
        const viewerNameInput = document.getElementById('s-viewer-name');
        if (viewerNameInput) setViewerName(viewerNameInput.value.trim());
        resetViewerChatQueue();
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
        if (state.llmEnabled) {
            const label = document.getElementById('llm-model-label');
            if (label) { label.textContent = 'loading...'; label.title = 'Model is loading \u2014 first response may take a moment'; }
        }
        setTimeout(closeSettings, 800);
    } catch (e) {
        msg.textContent = 'Error saving settings';
        msg.className = 'settings-msg err';
    }
}

// ============================================================
// LLM TOGGLE BUTTON
// ============================================================

let _previousProvider = 'ollama';

function initLlmToggle() {
    const btn = document.getElementById('llm-toggle-btn');
    if (!btn) return;
    btn.addEventListener('click', async () => {
        try {
            let newProvider;
            if (state.llmEnabled) {
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
            resetViewerChatQueue();
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
}

// ============================================================
// INIT
// ============================================================

export function initSettings() {
    document.getElementById('settings-btn').addEventListener('click', openSettings);
    const sessionSettingsBtn = document.getElementById('settings-btn-session');
    if (sessionSettingsBtn) sessionSettingsBtn.addEventListener('click', openSettings);
    document.getElementById('settings-close-btn').addEventListener('click', closeSettings);
    document.getElementById('settings-overlay').addEventListener('click', function(e) {
        if (e.target === this) closeSettings();
    });
    document.getElementById('s-provider').addEventListener('change', toggleProviderFields);
    document.getElementById('settings-form').addEventListener('submit', saveSettings);
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') closeSettings();
    });
    document.getElementById('tuning-toggle').addEventListener('click', () => {
        const fields = document.getElementById('tuning-fields');
        const toggle = document.getElementById('tuning-toggle');
        const open = fields.style.display === 'none';
        fields.style.display = open ? '' : 'none';
        toggle.textContent = (open ? '\u25BE' : '\u25B8') + ' Tuning';
    });
    for (const [id, suffix] of [['s-narrator-freq', 's'], ['s-tip-chance', '%'], ['s-reaction-chance', '%'], ['s-overlay-duration', 's']]) {
        document.getElementById(id).addEventListener('input', () => {
            document.getElementById(id + '-val').textContent = document.getElementById(id).value + suffix;
        });
    }
    fetch('/api/settings').then(r => r.json()).then(cfg => {
        state.llmEnabled = cfg.provider !== 'off';
        syncLlmToggleUI(cfg);
        const needsSetup = cfg.provider === 'ollama' ? !cfg.ollama_model : cfg.provider === 'openai' ? !cfg.openai_model : cfg.provider === 'anthropic' ? !cfg.anthropic_model : false;
        if (needsSetup) openSettings();
    }).catch(() => {});

    initLlmToggle();
    initChatInput();
}


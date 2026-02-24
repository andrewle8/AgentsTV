/* AgentsTV — sound effects (Web Audio API) */

import { state, bus } from './state.js';

let audioCtx = null;

function getCtx() {
    if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    return audioCtx;
}

// Mute state persisted in localStorage
let muted = false;
try { muted = localStorage.getItem('agenttv_muted') === '1'; } catch {}

export function isMuted() { return muted; }

export function toggleMute() {
    muted = !muted;
    try { localStorage.setItem('agenttv_muted', muted ? '1' : '0'); } catch {}
    syncMuteButton();
    return muted;
}

function syncMuteButton() {
    const ids = ['mute-btn', 'mute-btn-session'];
    for (const id of ids) {
        const btn = document.getElementById(id);
        if (!btn) continue;
        btn.textContent = muted ? '\u{1F507}' : '\u{1F50A}';
        btn.title = muted ? 'Unmute sounds (M)' : 'Mute sounds (M)';
        btn.classList.toggle('muted', muted);
    }
}

// --- Sound generators ---

function playTone(freq, duration, type = 'sine', gain = 0.08) {
    if (muted) return;
    try {
        const ctx = getCtx();
        const osc = ctx.createOscillator();
        const g = ctx.createGain();
        osc.type = type;
        osc.frequency.value = freq;
        g.gain.setValueAtTime(gain, ctx.currentTime);
        g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + duration);
        osc.connect(g).connect(ctx.destination);
        osc.start();
        osc.stop(ctx.currentTime + duration);
    } catch {}
}

function playNoise(duration, gain = 0.03) {
    if (muted) return;
    try {
        const ctx = getCtx();
        const bufferSize = ctx.sampleRate * duration;
        const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
        const data = buffer.getChannelData(0);
        for (let i = 0; i < bufferSize; i++) data[i] = Math.random() * 2 - 1;
        const source = ctx.createBufferSource();
        source.buffer = buffer;
        const g = ctx.createGain();
        g.gain.setValueAtTime(gain, ctx.currentTime);
        g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + duration);
        const filter = ctx.createBiquadFilter();
        filter.type = 'highpass';
        filter.frequency.value = 3000;
        source.connect(filter).connect(g).connect(ctx.destination);
        source.start();
    } catch {}
}

export function playKeystroke() {
    playTone(800 + Math.random() * 400, 0.05, 'square', 0.03);
}

export function playErrorBuzz() {
    playTone(150, 0.3, 'sawtooth', 0.06);
}

export function playCompleteChime() {
    playTone(523, 0.15, 'sine', 0.08);
    setTimeout(() => playTone(659, 0.15, 'sine', 0.08), 100);
    setTimeout(() => playTone(784, 0.25, 'sine', 0.08), 200);
}

export function playChatPop() {
    playTone(1200, 0.08, 'sine', 0.05);
}

export function playSpawnWhoosh() {
    playNoise(0.3, 0.04);
    playTone(200, 0.3, 'sine', 0.04);
}

export function playTipSound() {
    playTone(880, 0.1, 'sine', 0.1);
    setTimeout(() => playTone(1100, 0.15, 'sine', 0.1), 80);
}

// Map event types to sounds
export function playSoundForEvent(type) {
    switch (type) {
        case 'file_create':
        case 'file_update':
            playKeystroke();
            break;
        case 'error':
            playErrorBuzz();
            break;
        case 'complete':
            playCompleteChime();
            break;
        case 'spawn':
            playSpawnWhoosh();
            break;
    }
}

export function initSound() {
    syncMuteButton();
    const ids = ['mute-btn', 'mute-btn-session'];
    for (const id of ids) {
        const btn = document.getElementById(id);
        if (!btn) continue;
        btn.addEventListener('click', () => {
            toggleMute();
            if (!muted && audioCtx && audioCtx.state === 'suspended') {
                audioCtx.resume();
            }
        });
    }
    // Hook into event bus for automatic sound effects
    bus.on('agent-event', (evt) => playSoundForEvent(evt.type));
    bus.on('viewer-chat', () => playChatPop());
    bus.on('tip', () => playTipSound());
}

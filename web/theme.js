/* AgentsTV — dark/light theme toggle */

import { state } from './state.js';

function applyTheme(theme) {
    state.theme = theme;
    if (theme === 'light') {
        document.documentElement.setAttribute('data-theme', 'light');
    } else {
        document.documentElement.removeAttribute('data-theme');
    }
    // Sync all theme toggle buttons
    for (const id of ['theme-toggle-btn', 'theme-toggle-btn-session']) {
        const btn = document.getElementById(id);
        if (btn) {
            btn.textContent = theme === 'light' ? '\u2600' : '\u{1F319}';
            btn.title = theme === 'light' ? 'Switch to dark theme (T)' : 'Switch to light theme (T)';
        }
    }
}

export function toggleTheme() {
    const next = state.theme === 'dark' ? 'light' : 'dark';
    applyTheme(next);
    try { localStorage.setItem('agenttv_theme', next); } catch {}
}

export function initTheme() {
    let saved = 'dark';
    try { saved = localStorage.getItem('agenttv_theme') || 'dark'; } catch {}
    applyTheme(saved);

    for (const id of ['theme-toggle-btn', 'theme-toggle-btn-session']) {
        const btn = document.getElementById(id);
        if (btn) btn.addEventListener('click', toggleTheme);
    }
}

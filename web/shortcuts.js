/* AgentsTV — keyboard shortcuts and overlay */

import { state } from './state.js';
import { toggleMute } from './sound.js';
import { navigate } from './dashboard.js';
import { toggleTheme } from './theme.js';
import { exportChatLog } from './chat.js';

const SHORTCUTS = [
    { key: '?', label: 'Show this help' },
    { key: 'Escape', label: 'Back to browse / close modal' },
    { key: 'F', label: 'Toggle fullscreen chat' },
    { key: 'M', label: 'Mute / unmute sounds' },
    { key: 'Space', label: 'Pause / resume chat auto-scroll' },
    { key: 'T', label: 'Toggle dark / light theme' },
    { key: 'E', label: 'Export chat log' },
    { key: 'S', label: 'Toggle split chat' },
];

function isInputFocused() {
    const el = document.activeElement;
    return el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT');
}

function showShortcutsOverlay() {
    let overlay = document.getElementById('shortcuts-overlay');
    if (overlay) {
        overlay.style.display = 'flex';
        return;
    }
    overlay = document.createElement('div');
    overlay.id = 'shortcuts-overlay';
    overlay.className = 'shortcuts-overlay';
    overlay.innerHTML = `
        <div class="shortcuts-modal">
            <div class="shortcuts-header">
                <span>Keyboard Shortcuts</span>
                <button class="shortcuts-close-btn">&times;</button>
            </div>
            <div class="shortcuts-body">
                ${SHORTCUTS.map(s => `
                    <div class="shortcut-row">
                        <kbd class="shortcut-key">${s.key === 'Space' ? 'Space' : s.key === 'Escape' ? 'Esc' : s.key}</kbd>
                        <span class="shortcut-label">${s.label}</span>
                    </div>
                `).join('')}
            </div>
        </div>
    `;
    document.body.appendChild(overlay);

    overlay.querySelector('.shortcuts-close-btn').addEventListener('click', () => {
        overlay.style.display = 'none';
    });
    overlay.addEventListener('click', (e) => {
        if (e.target === overlay) overlay.style.display = 'none';
    });
}

function hideShortcutsOverlay() {
    const overlay = document.getElementById('shortcuts-overlay');
    if (overlay) overlay.style.display = 'none';
}

export function initShortcuts() {
    document.addEventListener('keydown', (e) => {
        // Don't capture when typing in inputs
        if (isInputFocused()) return;

        const key = e.key;

        if (key === '?') {
            e.preventDefault();
            const overlay = document.getElementById('shortcuts-overlay');
            if (overlay && overlay.style.display === 'flex') {
                hideShortcutsOverlay();
            } else {
                showShortcutsOverlay();
            }
            return;
        }

        if (key === 'Escape') {
            // Close shortcuts overlay first
            const shortcutsOverlay = document.getElementById('shortcuts-overlay');
            if (shortcutsOverlay && shortcutsOverlay.style.display === 'flex') {
                hideShortcutsOverlay();
                return;
            }
            // Close settings overlay
            const settingsOverlay = document.getElementById('settings-overlay');
            if (settingsOverlay && settingsOverlay.style.display === 'flex') {
                settingsOverlay.style.display = 'none';
                return;
            }
            // Back to browse
            if (state.view !== 'dashboard') {
                navigate('#/');
            }
            return;
        }

        if (key === 'f' || key === 'F') {
            if (state.view === 'session' || state.view === 'master') {
                const expandBtn = document.getElementById('expand-chat-btn');
                if (expandBtn) expandBtn.click();
            }
            return;
        }

        if (key === 'm' || key === 'M') {
            toggleMute();
            return;
        }

        if (key === ' ') {
            if (state.view === 'session' || state.view === 'master') {
                e.preventDefault();
                state.autoScroll = !state.autoScroll;
                const scrollBtn = document.getElementById('scroll-bottom-btn');
                if (scrollBtn) {
                    scrollBtn.style.display = state.autoScroll ? 'none' : 'block';
                }
            }
            return;
        }

        if (key === 't' || key === 'T') {
            toggleTheme();
            return;
        }

        if (key === 'e' || key === 'E') {
            if (state.view === 'session' || state.view === 'master') {
                exportChatLog();
            }
            return;
        }

        if (key === 's' || key === 'S') {
            if (state.view === 'session' || state.view === 'master') {
                const btn = document.getElementById('split-chat-btn');
                if (btn) btn.click();
            }
            return;
        }
    });
}

/* AgentsTV — stream alert toasts */

import { bus } from './state.js';

const ALERT_MAP = {
    error: { icon: '\u{1F6A8}', text: 'Error detected!', color: 'var(--red-soft)' },
    complete: { icon: '\u2705', text: 'Task completed!', color: 'var(--green)' },
    spawn: { icon: '\u{1F31F}', text: 'New agent spawned!', color: 'var(--purple-light)' },
    file_create: { icon: '\u{1F4C4}', text: 'File created!', color: 'var(--green-dim)' },
};

const MAX_VISIBLE = 3;
let alertContainer = null;
let activeAlerts = [];

function getContainer() {
    if (alertContainer) return alertContainer;
    alertContainer = document.createElement('div');
    alertContainer.id = 'alert-container';
    alertContainer.className = 'alert-container';
    document.body.appendChild(alertContainer);
    return alertContainer;
}

export function showAlert(type) {
    const info = ALERT_MAP[type];
    if (!info) return;

    const container = getContainer();

    // Cap visible alerts
    while (activeAlerts.length >= MAX_VISIBLE) {
        const oldest = activeAlerts.shift();
        oldest.remove();
    }

    const toast = document.createElement('div');
    toast.className = 'alert-toast';
    toast.style.borderLeftColor = info.color;
    toast.innerHTML = `<span class="alert-icon">${info.icon}</span><span class="alert-text">${info.text}</span>`;

    container.appendChild(toast);
    activeAlerts.push(toast);

    // Trigger animation
    requestAnimationFrame(() => {
        toast.classList.add('visible');
    });

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

export function initAlerts() {
    bus.on('agent-event', (evt) => showAlert(evt.type));
}

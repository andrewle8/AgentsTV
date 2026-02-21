/* AgentsTV — URL hash routing */

import { state } from './state.js';
import { stopAllAnimations } from './pixelEngine.js';
import { stopViewerChat } from './chat.js';
import { showDashboard } from './dashboard.js';
import { showSessionView, hideCodeOverlay, stopUptimeTimer } from './session.js';
import { showMasterChannel } from './master.js';

export function handleRoute() {
    stopAllAnimations();
    stopViewerChat();
    hideCodeOverlay();
    stopUptimeTimer();
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

export function initRouter() {
    window.addEventListener('hashchange', handleRoute);
    // Modules with type="module" are deferred, so DOM is ready when this runs
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => handleRoute());
    } else {
        handleRoute();
    }
}

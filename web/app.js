/* AgentsTV — Twitch-style agent session viewer (entry point) */

import { initSettings } from './settings.js';
import { initRouter } from './router.js';
import { initSound } from './sound.js';
import { initShortcuts } from './shortcuts.js';
import { initAlerts } from './alerts.js';
import { initTheme } from './theme.js';

initSettings();
initSound();
initAlerts();
initShortcuts();
initTheme();
initRouter();

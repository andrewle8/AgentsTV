/* AgentsTV — shared state and event bus */

export const TUNING_DEFAULTS = {
    chatSpeed: 'normal',       // slow | normal | fast
    narratorFreq: 20,          // seconds (center of random range)
    tipChance: 15,             // percent
    reactionChance: 50,        // percent
    bufferSize: 10,            // messages
    overlayDuration: 15,       // seconds
};

export function loadTuning() {
    try {
        const raw = localStorage.getItem('agenttv_tuning');
        return raw ? { ...TUNING_DEFAULTS, ...JSON.parse(raw) } : { ...TUNING_DEFAULTS };
    } catch { return { ...TUNING_DEFAULTS }; }
}

export function saveTuning(t) {
    state.tuning = t;
    try { localStorage.setItem('agenttv_tuning', JSON.stringify(t)); } catch {}
}

export const ICONS = {
    spawn: '★', think: '◆', tool_call: '▸', tool_result: '◂',
    file_create: '+', file_update: '~', file_read: '○',
    bash: '$', web_search: '⌕', text: '│', error: '✖',
    complete: '✔', user: '▶',
};

export const EVENT_LABELS = {
    spawn: 'Spawn', think: 'Think', tool_call: 'Tool', tool_result: 'Result',
    file_create: 'Create', file_update: 'Edit', file_read: 'Read',
    bash: 'Bash', web_search: 'Web', text: 'Text', error: 'Error',
    complete: 'Done', user: 'User',
};

export const CHAT_BADGES = {
    spawn: '🟣', think: '🧠', bash: '⚡', error: '🔴',
    user: '👤', file_create: '📝', file_update: '✏️', file_read: '📖',
    web_search: '🌐', tool_call: '🔧', tool_result: '📨',
    text: '💬', complete: '✅',
};

// Pixel art palettes for code monkeys
export const PALETTES = [
    { fur: '#8B5E3C', face: '#D4A574', belly: '#C8A882', shirt: '#9146ff', monitor: '#003322', chair: '#252540' },
    { fur: '#6B4226', face: '#C4956A', belly: '#B8946E', shirt: '#eb0400', monitor: '#001a33', chair: '#402525' },
    { fur: '#A0724A', face: '#E0C09A', belly: '#D4B68C', shirt: '#00b4d8', monitor: '#1a0033', chair: '#253040' },
    { fur: '#5C3D2E', face: '#BA8A60', belly: '#AE845C', shirt: '#f0c674', monitor: '#0a1628', chair: '#403825' },
    { fur: '#7A5230', face: '#D8B080', belly: '#CCA474', shirt: '#00e676', monitor: '#1a0a00', chair: '#254025' },
    { fur: '#9B6B40', face: '#E8C8A0', belly: '#DCBC94', shirt: '#81d4fa', monitor: '#001a00', chair: '#253545' },
];

// Desk setup variations — each seed picks one
export const DESK_SETUPS = [
    'single',       // basic single monitor
    'dual',         // dual monitors
    'ultrawide',    // one wide monitor
    'laptop',       // laptop on desk
    'single',       // repeat for distribution
    'dual',
];

// Desk decoration sets
export const DECORATIONS = [
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

export let state = {
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
    chatSplit: false,
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
    // Uptime timer interval
    uptimeInterval: null,
    // Theme (dark/light)
    theme: 'dark',
};

// Simple event bus
export const bus = {
    _handlers: {},
    on(event, fn) {
        if (!this._handlers[event]) this._handlers[event] = [];
        this._handlers[event].push(fn);
    },
    off(event, fn) {
        const list = this._handlers[event];
        if (!list) return;
        this._handlers[event] = list.filter(f => f !== fn);
    },
    emit(event, data) {
        const list = this._handlers[event];
        if (!list) return;
        list.forEach(fn => fn(data));
    },
};

/* AgentTV — Twitch-style agent session viewer */

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

// Pixel art palettes for different "streamers"
const PALETTES = [
    { skin: '#ffcc99', hair: '#4a2800', shirt: '#9146ff', monitor: '#003322', chair: '#252540' },
    { skin: '#e8a87c', hair: '#2d132c', shirt: '#eb0400', monitor: '#001a33', chair: '#402525' },
    { skin: '#ffdab9', hair: '#c68642', shirt: '#00b4d8', monitor: '#1a0033', chair: '#253040' },
    { skin: '#d4a07a', hair: '#1a1a2e', shirt: '#f0c674', monitor: '#0a1628', chair: '#403825' },
    { skin: '#f5cba7', hair: '#6c3483', shirt: '#00e676', monitor: '#1a0a00', chair: '#254025' },
    { skin: '#ffdbac', hair: '#e74c3c', shirt: '#81d4fa', monitor: '#001a00', chair: '#253545' },
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
    // Master channel state
    masterEvents: [],
    masterAgents: {},
    masterSessionCount: 0,
};

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

function triggerReaction(type) {
    // Queue a visual reaction on the webcam canvas
    state.reaction = { type, startFrame: -1, duration: getReactionDuration(type) };
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
        drawWindow(ctx, w, h, px, frame);
    }

    // Floor
    ctx.fillStyle = '#1a1a2e';
    ctx.fillRect(0, h * 0.72, w, h * 0.28);
    ctx.fillStyle = '#151528';
    for (let x = 0; x < w; x += px * 8) {
        ctx.fillRect(x, h * 0.72, px * 4, h * 0.28);
    }

    // Desk
    const deskY = h * 0.55;
    const deskH = px * 4;
    const deskColor = seed % 2 === 0 ? '#3d2b1f' : '#2c3e50';
    ctx.fillStyle = deskColor;
    ctx.fillRect(w * 0.12, deskY, w * 0.76, deskH);
    ctx.fillStyle = darken(deskColor, 30);
    ctx.fillRect(w * 0.12, deskY + deskH, w * 0.76, px);

    // Desk legs
    ctx.fillStyle = darken(deskColor, 30);
    ctx.fillRect(w * 0.15, deskY + deskH, px * 2, h * 0.17);
    ctx.fillRect(w * 0.81, deskY + deskH, px * 2, h * 0.17);

    // Monitor(s) based on setup
    const typingMult = isLarge ? state.typingSpeed : 1.0;
    drawMonitorSetup(ctx, w, h, px, setup, palette, seed, frame, deskY, rxType, rxProgress, typingMult);

    // Chair
    const charX = w * 0.42;
    const charY = deskY - px * 2;
    ctx.fillStyle = darken(palette.chair, 20);
    ctx.fillRect(charX - px * 2, charY - px * 4, px * 14, px * 8);
    ctx.fillStyle = palette.chair;
    ctx.fillRect(charX - px, charY - px * 3, px * 12, px * 6);

    // Character
    drawCharacter(ctx, w, h, px, palette, charX, charY, deskY, frame, rxType, rxProgress, typingMult);

    // Keyboard
    ctx.fillStyle = '#3a3a44';
    ctx.fillRect(charX - px, deskY - px * 2, px * 12, px * 2);
    ctx.fillStyle = '#4a4a55';
    for (let k = 0; k < 5; k++) {
        ctx.fillRect(charX + k * px * 2, deskY - px * 2, px, px);
    }

    // Decorations
    for (const d of decor) {
        drawDecoration(ctx, w, h, px, d, seed, frame, deskY);
    }

    // Celebration particles on complete
    if (rxType === 'complete') {
        drawCelebration(ctx, w, h, px, frame, rx.startFrame);
    }

    // Spawn flash — purple glow
    if (rxType === 'spawn' && rxProgress < 0.4) {
        const alpha = Math.sin(rxProgress * Math.PI / 0.4) * 0.15;
        ctx.fillStyle = `rgba(145, 70, 255, ${alpha})`;
        ctx.fillRect(0, 0, w, h);
    }

    // Ambient dust
    for (let i = 0; i < 5; i++) {
        const pSeed = (seed * 13 + i * 7 + frame) % 1000;
        const dx = (pSeed % w);
        const dy = ((pSeed * 3 + frame * 0.2) % (h * 0.7));
        ctx.fillStyle = `rgba(255,255,255,${0.04 + (pSeed % 10) * 0.008})`;
        ctx.fillRect(dx, dy, 1, 1);
    }
}

function drawMonitorSetup(ctx, w, h, px, setup, palette, seed, frame, deskY, rxType, rxProgress, typingMult) {
    const scrollSpeed = 0.5 * typingMult;

    if (setup === 'dual') {
        // Two monitors side by side
        drawMonitor(ctx, w * 0.22, deskY - px * 18, px * 18, px * 14, px, palette, seed, frame, scrollSpeed, rxType, rxProgress);
        drawMonitor(ctx, w * 0.52, deskY - px * 18, px * 18, px * 14, px, palette, seed + 7, frame, scrollSpeed * 0.6, rxType, rxProgress);
    } else if (setup === 'ultrawide') {
        drawMonitor(ctx, w * 0.22, deskY - px * 16, px * 36, px * 14, px, palette, seed, frame, scrollSpeed, rxType, rxProgress);
    } else if (setup === 'laptop') {
        // Laptop — shorter, angled screen
        const lx = w * 0.32;
        const ly = deskY - px * 14;
        const lw = px * 24;
        const lh = px * 12;
        // Laptop base on desk
        ctx.fillStyle = '#3a3a44';
        ctx.fillRect(lx - px, deskY - px * 2, lw + px * 2, px * 2);
        drawMonitor(ctx, lx, ly, lw, lh, px, palette, seed, frame, scrollSpeed, rxType, rxProgress);
    } else {
        // Single monitor (default)
        drawMonitor(ctx, w * 0.32, deskY - px * 18, px * 28, px * 16, px, palette, seed, frame, scrollSpeed, rxType, rxProgress);
    }
}

function drawMonitor(ctx, monX, monY, monW, monH, px, palette, seed, frame, scrollSpeed, rxType, rxProgress) {
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

    // Code on screen
    if (rxType === 'error' && rxProgress < 0.5) {
        // Error text on screen
        drawErrorScreen(ctx, monX, monY, monW, monH, px, rxProgress);
    } else if (rxType === 'think') {
        // Thinking — show ellipsis/cursor blink
        drawThinkingScreen(ctx, monX, monY, monW, monH, px, frame);
    } else {
        drawCode(ctx, monX, monY, monW, monH, px, seed, frame, scrollSpeed);
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
    // Body
    ctx.fillStyle = palette.shirt;
    ctx.fillRect(charX + px * 2, charY - px * 6, px * 6, px * 5);

    // Head — slight bob when thinking, recoil on error
    let headOffY = 0;
    let headOffX = 0;
    if (rxType === 'think') {
        headOffX = Math.sin(frame * 0.08) * px * 0.5;
        headOffY = Math.sin(frame * 0.15) * px * 0.3;
    } else if (rxType === 'error') {
        headOffY = rxProgress < 0.2 ? -px * 2 * (rxProgress / 0.2) : -px * 2 * (1 - (rxProgress - 0.2) / 0.8);
        headOffX = Math.sin(frame * 1.5) * px * (rxProgress < 0.3 ? 1 : 0);
    } else if (rxType === 'complete') {
        headOffY = -Math.abs(Math.sin(rxProgress * Math.PI * 3)) * px * 2;
    } else if (rxType === 'user') {
        // Turn head slightly toward "camera"
        headOffX = -px * 2 * Math.sin(rxProgress * Math.PI);
    }

    ctx.fillStyle = palette.skin;
    ctx.fillRect(charX + px * 3 + headOffX, charY - px * 11 + headOffY, px * 4, px * 4);

    // Hair
    ctx.fillStyle = palette.hair;
    ctx.fillRect(charX + px * 3 + headOffX, charY - px * 12 + headOffY, px * 4, px * 2);
    ctx.fillRect(charX + px * 2 + headOffX, charY - px * 11 + headOffY, px, px * 2);

    // Eyes
    ctx.fillStyle = '#ffffff';
    const eyeBaseX = charX + px * 4 + headOffX;
    const eyeBaseY = charY - px * 9 + headOffY;
    ctx.fillRect(eyeBaseX, eyeBaseY, px, px);
    ctx.fillRect(eyeBaseX + px * 2, eyeBaseY, px, px);

    // Pupils — look at monitor normally, look at camera on user event
    ctx.fillStyle = '#111111';
    let pupilOff = 0;
    if (rxType === 'user') {
        pupilOff = -1; // look left toward camera
    }
    ctx.fillRect(eyeBaseX + pupilOff, eyeBaseY, Math.ceil(px * 0.5), Math.ceil(px * 0.5));
    ctx.fillRect(eyeBaseX + px * 2 + pupilOff, eyeBaseY, Math.ceil(px * 0.5), Math.ceil(px * 0.5));

    // Mouth — happy on complete, open on error
    if (rxType === 'complete') {
        ctx.fillStyle = palette.skin;
        ctx.fillRect(eyeBaseX, eyeBaseY + px * 2, px * 3, px * 0.5); // smile
        ctx.fillStyle = '#cc6666';
        ctx.fillRect(eyeBaseX + px * 0.5, eyeBaseY + px * 2, px * 2, px * 0.5);
    } else if (rxType === 'error' && rxProgress < 0.4) {
        ctx.fillStyle = '#111111';
        ctx.fillRect(eyeBaseX + px * 0.5, eyeBaseY + px * 2.5, px * 2, px);
    }

    // Arms — typing speed varies
    const armSpeed = 0.3 * typingMult;
    const armPhase = Math.sin(frame * armSpeed);

    // During error: hands up in frustration
    if (rxType === 'error' && rxProgress < 0.5) {
        ctx.fillStyle = palette.skin;
        ctx.fillRect(charX - px, charY - px * 8, px * 2, px * 2);
        ctx.fillRect(charX + px * 9, charY - px * 8, px * 2, px * 2);
    } else if (rxType === 'complete' && rxProgress < 0.6) {
        // Arms up celebration
        const armUp = Math.sin(rxProgress * Math.PI * 4) * px * 2;
        ctx.fillStyle = palette.skin;
        ctx.fillRect(charX - px, charY - px * 7 - Math.abs(armUp), px * 2, px * 2);
        ctx.fillRect(charX + px * 9, charY - px * 7 - Math.abs(armUp), px * 2, px * 2);
    } else if (rxType === 'think') {
        // One hand on chin
        ctx.fillStyle = palette.skin;
        ctx.fillRect(charX + px * 2, charY - px * 8, px * 2, px * 3);
        ctx.fillRect(charX + px * 8, charY - px * 4, px * 2, px * 2);
    } else {
        // Normal typing
        const lArmY = charY - px * 4 + (armPhase > 0 ? -px : 0);
        const rArmY = charY - px * 4 + (armPhase > 0 ? 0 : -px);
        ctx.fillStyle = palette.skin;
        ctx.fillRect(charX, lArmY, px * 2, px * 2);
        ctx.fillRect(charX - px, lArmY + px, px, px);
        ctx.fillRect(charX + px * 8, rArmY, px * 2, px * 2);
        ctx.fillRect(charX + px * 10, rArmY + px, px, px);
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
            // Handle
            ctx.fillStyle = '#e0e0e0';
            ctx.fillRect(mx + px * 3, deskY - px * 3, px, px * 2);
            // Steam
            if (frame % 8 < 4) {
                ctx.fillStyle = 'rgba(200,200,200,0.3)';
                ctx.fillRect(mx + px, deskY - px * 6, px, px);
                ctx.fillRect(mx + px * 0.5, deskY - px * 7, px, px);
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
            // Pot
            ctx.fillStyle = '#8b4513';
            ctx.fillRect(px2, deskY - px * 4, px * 4, px * 3);
            ctx.fillStyle = '#654321';
            ctx.fillRect(px2 - px * 0.5, deskY - px * 4, px * 5, px);
            // Leaves
            ctx.fillStyle = '#228b22';
            ctx.fillRect(px2 + px, deskY - px * 7, px * 2, px * 3);
            ctx.fillRect(px2 - px, deskY - px * 6, px * 2, px * 2);
            ctx.fillRect(px2 + px * 3, deskY - px * 6, px * 2, px * 2);
            // Leaf sway
            if (frame % 60 < 30) {
                ctx.fillRect(px2 + px * 4, deskY - px * 7, px, px);
            } else {
                ctx.fillRect(px2 - px * 2, deskY - px * 7, px, px);
            }
            break;
        }
        case 'cat': {
            const cx = w * 0.18;
            const catY = deskY - px * 3;
            // Body
            ctx.fillStyle = '#ff8c00';
            ctx.fillRect(cx, catY, px * 4, px * 2);
            // Head
            ctx.fillRect(cx + px * 3, catY - px * 2, px * 3, px * 2);
            // Ears
            ctx.fillStyle = '#ff6600';
            ctx.fillRect(cx + px * 3, catY - px * 3, px, px);
            ctx.fillRect(cx + px * 5, catY - px * 3, px, px);
            // Eyes — blink occasionally
            if (frame % 120 < 110) {
                ctx.fillStyle = '#00ff00';
                ctx.fillRect(cx + px * 4, catY - px * 1.5, px * 0.5, px * 0.5);
                ctx.fillRect(cx + px * 5, catY - px * 1.5, px * 0.5, px * 0.5);
            }
            // Tail — sway
            ctx.fillStyle = '#ff8c00';
            const tailX = cx - px + Math.sin(frame * 0.1) * px;
            ctx.fillRect(tailX, catY, px, px);
            ctx.fillRect(tailX - px * 0.5, catY - px, px, px);
            // Purr (zzz when sleeping based on seed)
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
            // Lamp post
            ctx.fillStyle = '#555555';
            ctx.fillRect(lx + px, deskY - px * 10, px, px * 9);
            // Shade
            ctx.fillStyle = '#f0c674';
            ctx.fillRect(lx - px, deskY - px * 12, px * 4, px * 3);
            // Light glow
            ctx.fillStyle = 'rgba(240, 198, 116, 0.08)';
            ctx.fillRect(lx - px * 3, deskY - px * 10, px * 8, px * 8);
            // Base
            ctx.fillStyle = '#555555';
            ctx.fillRect(lx - px * 0.5, deskY - px, px * 3, px);
            break;
        }
        case 'duck': {
            const dx = w * 0.19;
            // Rubber duck on desk
            ctx.fillStyle = '#ffdd00';
            ctx.fillRect(dx, deskY - px * 3, px * 3, px * 2);
            ctx.fillRect(dx + px, deskY - px * 5, px * 2, px * 2);
            // Beak
            ctx.fillStyle = '#ff8800';
            ctx.fillRect(dx + px * 3, deskY - px * 4.5, px, px);
            // Eye
            ctx.fillStyle = '#000000';
            ctx.fillRect(dx + px * 1.5, deskY - px * 4.5, px * 0.4, px * 0.4);
            // Bobble
            if (frame % 30 < 15) {
                ctx.fillStyle = '#ffdd00';
                ctx.fillRect(dx + px, deskY - px * 5.5, px * 2, px);
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

function drawWindow(ctx, w, h, px, frame) {
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
    // Moon
    ctx.fillStyle = '#ffffcc';
    ctx.fillRect(winX + px * 2, winY + px * 2, px * 3, px * 3);
    ctx.fillStyle = '#0a0a2a';
    ctx.fillRect(winX + px * 3, winY + px * 1.5, px * 2, px * 2);
    // Stars twinkling
    ctx.fillStyle = '#ffffff';
    if (frame % 40 < 30) ctx.fillRect(winX + px * 7, winY + px * 3, 1, 1);
    if (frame % 50 < 35) ctx.fillRect(winX + px * 9, winY + px * 1, 1, 1);
    if (frame % 35 < 25) ctx.fillRect(winX + px * 5, winY + px * 7, 1, 1);
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
    state.reaction = null;
    state.typingSpeed = 1.0;
    state.chatFullscreen = false;
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
                <div class="${avatarClass}">🤖</div>
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
            startPixelAnimation(canvas, 99, false); // special seed for control room
        } else {
            startPixelAnimation(canvas, parseInt(seed) || 0, false);
        }
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
    document.getElementById('event-log').innerHTML = '<div style="padding:20px;color:var(--text-muted)">Connecting to stream…</div>';

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
            document.getElementById('event-log').innerHTML = `<div style="padding:20px;color:var(--text-muted)">${esc(data.error)}</div>`;
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
    } catch (e) {
        document.getElementById('event-log').innerHTML = `<div style="padding:20px;color:var(--text-muted)">Failed to connect to stream</div>`;
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
    const log = document.getElementById('event-log');
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

    if (state.autoScroll) log.scrollTop = log.scrollHeight;
}

function renderSession() {
    const s = state.session;
    if (!s) return;

    document.getElementById('session-slug').textContent = s.slug || 'AgentTV Stream';
    const meta = [];
    if (s.version) meta.push(`v${s.version}`);
    if (s.branch) meta.push(`⎇ ${s.branch}`);
    document.getElementById('session-meta').textContent = meta.join(' · ') || 'Coding · Claude Code';

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

function appendChatMessage(log, evt, s, isMaster) {
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

    const div = document.createElement('div');
    div.className = 'chat-msg' + (totalTok > 0 ? ' has-tokens' : '');

    const badge = CHAT_BADGES[evt.type] || '·';
    const modBadge = isSubagent ? '🗡' : '';
    const nameClass = `name-${agentColor}`;
    const chatText = buildChatText(evt);
    const tokenHtml = totalTok > 0 ? `<span class="token-badge">+${fmtTokens(totalTok)}</span>` : '';
    const projectTag = (isMaster && evt.project) ? `<span class="project-tag">${esc(evt.project)}</span>` : '';

    div.innerHTML = `${projectTag}<span class="chat-badge">${badge}</span>`
        + (modBadge ? `<span class="chat-badge">${modBadge}</span>` : '')
        + `<span class="chat-name ${nameClass}">${esc(agentName)}</span>`
        + `<span class="chat-text">${esc(chatText)}</span>`
        + tokenHtml;

    const expanded = document.createElement('div');
    expanded.className = 'chat-expanded';
    expanded.textContent = evt.content || '(no content)';

    div.addEventListener('click', () => {
        expanded.style.display = expanded.style.display === 'block' ? 'none' : 'block';
    });

    log.appendChild(div);
    log.appendChild(expanded);
}

function updateChatCounters(s) {
    document.getElementById('event-count').textContent = `${s.events.length}`;
    document.getElementById('viewer-list-count').textContent = `(${Object.keys(state.inventory).length})`;
    document.getElementById('mod-count').textContent = `(${Object.keys(s.agents).length})`;
    renderViewerCount();
    renderViewers();
}

function renderChatLog(s) {
    const log = document.getElementById('event-log');
    const wasAtBottom = state.autoScroll;
    log.innerHTML = '';
    state.inventory = {};

    let lastEventType = null;

    s.events.forEach((evt) => {
        appendChatMessage(log, evt, s, false);
        if (isEventVisible(evt.type)) lastEventType = evt.type;
    });

    if (lastEventType && state.view === 'session') {
        triggerReaction(lastEventType);
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
        return `<div class="mod-entry">
            <span class="mod-badge">${badge}</span>
            <span class="mod-name name-${a.color}">${esc(a.name)}</span>
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

            // Trigger webcam reaction for the newest event
            if (msg.events.length > 0) {
                const lastEvt = msg.events[msg.events.length - 1];
                triggerReaction(lastEvt.type);
            }

            const log = document.getElementById('event-log');
            const atBottom = log.scrollTop + log.clientHeight >= log.scrollHeight - 30;
            state.autoScroll = atBottom;

            // Append only new events instead of rebuilding
            msg.events.forEach(evt => appendChatMessage(log, evt, state.session, false));
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
    document.getElementById('event-log').innerHTML = '<div style="padding:20px;color:var(--text-muted)">Loading all streams…</div>';

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
        connectMasterWS();

        const canvas = document.getElementById('webcam-canvas');
        startControlRoomAnimation(canvas);
    } catch (e) {
        document.getElementById('event-log').innerHTML = '<div style="padding:20px;color:var(--text-muted)">Failed to load master channel</div>';
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
    const wasAtBottom = state.autoScroll;
    log.innerHTML = '';
    state.inventory = {};

    s.events.forEach((evt) => {
        appendChatMessage(log, evt, s, true);
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

            // Trigger reaction from newest event
            const lastEvt = msg.events[msg.events.length - 1];
            triggerReaction(lastEvt.type);

            const log = document.getElementById('event-log');
            const atBottom = log.scrollTop + log.clientHeight >= log.scrollHeight - 30;
            state.autoScroll = atBottom;

            msg.events.forEach(evt => appendChatMessage(log, evt, state.session, true));
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
    ctx.fillRect(0, h * 0.75, w, h * 0.25);

    // Wall of monitors (3x2 grid)
    const monColors = ['#003322', '#001a33', '#1a0033', '#0a1628', '#1a0a00', '#001a00'];
    const codeColors = [
        ['#00ff41', '#00cc33'], ['#ff6666', '#ff4444'], ['#6699ff', '#4488ff'],
        ['#ffcc00', '#ff9900'], ['#ff66ff', '#ff44ff'], ['#66ffcc', '#44ffaa'],
    ];

    for (let row = 0; row < 2; row++) {
        for (let col = 0; col < 3; col++) {
            const mx = w * 0.08 + col * (w * 0.28);
            const my = h * 0.05 + row * (h * 0.33);
            const mw = w * 0.24;
            const mh = h * 0.28;
            const idx = row * 3 + col;

            // Bezel
            ctx.fillStyle = '#2c2c34';
            ctx.fillRect(mx - 2, my - 2, mw + 4, mh + 4);
            // Screen
            ctx.fillStyle = monColors[idx % monColors.length];
            ctx.fillRect(mx, my, mw, mh);
            // Scanlines
            ctx.fillStyle = 'rgba(0,0,0,0.1)';
            for (let y = my; y < my + mh; y += 4) {
                ctx.fillRect(mx, y, mw, 1);
            }
            // Code lines
            const cc = codeColors[idx % codeColors.length];
            const scroll = (frame * (0.3 + idx * 0.1)) % 20;
            for (let r = 0; r < 5; r++) {
                const ly = my + 4 + r * 6;
                if (ly >= my + mh - 4) continue;
                const lineSeed = (idx * 7 + r + Math.floor(scroll)) * 31;
                const lineLen = Math.floor(mw / px) - 4;
                ctx.fillStyle = cc[r % cc.length];
                for (let c = 0; c < lineLen; c++) {
                    if ((lineSeed + c * 13) % 100 < 25) continue;
                    const cx = mx + 4 + c * (px - 1);
                    if (cx + px > mx + mw - 4) break;
                    ctx.fillRect(cx, ly, px - 2, px - 2);
                }
            }
            // CRT glow
            if (frame % (70 + idx * 11) < 2) {
                ctx.fillStyle = 'rgba(255,255,255,0.03)';
                ctx.fillRect(mx, my, mw, mh);
            }
        }
    }

    // Manager character — centered, sitting in chair
    const charX = w * 0.44;
    const charY = h * 0.75 - px;
    const palette = { skin: '#ffcc99', hair: '#333355', shirt: '#9146ff', chair: '#252540' };

    // Big comfy chair
    ctx.fillStyle = '#1a1a3a';
    ctx.fillRect(charX - px * 4, charY - px * 5, px * 18, px * 9);
    ctx.fillStyle = '#252550';
    ctx.fillRect(charX - px * 3, charY - px * 4, px * 16, px * 7);

    // Body
    ctx.fillStyle = palette.shirt;
    ctx.fillRect(charX + px * 2, charY - px * 6, px * 6, px * 5);

    // Head — slowly scanning left to right
    const scanPhase = Math.sin(frame * 0.03) * px * 2;
    ctx.fillStyle = palette.skin;
    ctx.fillRect(charX + px * 3 + scanPhase, charY - px * 11, px * 4, px * 4);
    ctx.fillStyle = palette.hair;
    ctx.fillRect(charX + px * 3 + scanPhase, charY - px * 12, px * 4, px * 2);

    // Eyes — looking at monitors
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(charX + px * 4 + scanPhase, charY - px * 9, px, px);
    ctx.fillRect(charX + px * 6 + scanPhase, charY - px * 9, px, px);

    // Arms resting on armrests
    ctx.fillStyle = palette.skin;
    ctx.fillRect(charX - px, charY - px * 3, px * 2, px * 2);
    ctx.fillRect(charX + px * 9, charY - px * 3, px * 2, px * 2);

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

function setupScrollListener() {
    const log = document.getElementById('event-log');
    if (log && !log.dataset.scrollBound) {
        log.dataset.scrollBound = '1';
        log.addEventListener('scroll', () => {
            state.autoScroll = log.scrollTop + log.clientHeight >= log.scrollHeight - 30;
            if (state.autoScroll) {
                const badge = document.getElementById('new-events-badge');
                if (badge) badge.style.display = 'none';
            }
        }, { passive: true });
    }
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

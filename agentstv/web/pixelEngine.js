/* AgentsTV — pixel art rendering engine */

import { state, PALETTES, DESK_SETUPS, DECORATIONS } from './state.js';
import { darken, hashCode } from './utils.js';

// ============================================================
// WEBCAM REACTIONS
// ============================================================

export function triggerReaction(type, content) {
    state.reaction = { type, startFrame: -1, duration: getReactionDuration(type) };
    if (content && typeof content === 'string' && content.length > 5) {
        state.monitorContent = content;
        state.monitorContentType = type;
    }
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

export function getReactionDuration(type) {
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
// MAIN SCENE
// ============================================================

export function drawPixelScene(canvas, seed, frame, isLarge) {
    const ctx = canvas.getContext('2d');
    const w = canvas.width;
    const h = canvas.height;
    const px = isLarge ? 4 : 3;
    const palette = PALETTES[seed % PALETTES.length];
    const setup = DESK_SETUPS[seed % DESK_SETUPS.length];
    const decor = DECORATIONS[seed % DECORATIONS.length];

    let rx = state.reaction;
    if (rx && rx.startFrame === -1) rx.startFrame = frame;
    const rxActive = rx && (frame - rx.startFrame) < rx.duration;
    const rxType = rxActive ? rx.type : null;
    const rxProgress = rxActive ? (frame - rx.startFrame) / rx.duration : 0;
    if (rx && !rxActive && rx.startFrame !== -1) state.reaction = null;

    // Background
    const wallColors = ['#0a0a18', '#0d0a14', '#0a0d14', '#10080e', '#080a10', '#0e0a0a', '#0a100a', '#0c0810'];
    const wallColor = wallColors[seed % wallColors.length];
    if (rxType === 'error' && rxProgress < 0.3) {
        const flash = Math.sin(rxProgress * Math.PI / 0.3) * 0.3;
        const wr = parseInt(wallColor.slice(1, 3), 16);
        const wg = parseInt(wallColor.slice(3, 5), 16);
        const wb = parseInt(wallColor.slice(5, 7), 16);
        ctx.fillStyle = `rgb(${Math.floor(wr + flash * 120)}, ${Math.floor(wg)}, ${Math.floor(wb)})`;
    } else {
        ctx.fillStyle = wallColor;
    }
    ctx.fillRect(0, 0, w, h);

    if (decor.includes('poster')) {
        drawPoster(ctx, w, h, px, seed, frame);
    }
    if (seed % 3 !== 2) {
        drawWindow(ctx, w, h, px, frame, seed);
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
    const deskShake = (rxType === 'error' && rxProgress < 0.3) ? Math.sin(frame * 2) * 1 : 0;
    const deskColors = ['#3d2b1f', '#2c3e50', '#4a3020', '#2a2a40', '#3a3028', '#2d3a3a', '#3a2a3a'];
    const deskColor = deskColors[seed % deskColors.length];
    ctx.fillStyle = deskColor;
    ctx.fillRect(w * 0.12 + deskShake, deskY, w * 0.76, deskH);
    ctx.fillStyle = darken(deskColor, 30);
    ctx.fillRect(w * 0.12, deskY + deskH, w * 0.76, px);

    // Desk legs
    ctx.fillStyle = darken(deskColor, 30);
    ctx.fillRect(w * 0.15, deskY + deskH, px * 2, h * 0.17);
    ctx.fillRect(w * 0.81, deskY + deskH, px * 2, h * 0.17);

    const typingMult = isLarge ? state.typingSpeed : 1.0;
    const charX = w * 0.42;
    const charY = deskY - px * 8;

    // Camera angle varies per session: 0=back, 1=side, 2=front
    const viewAngle = seed % 3;

    // Chair — back, seat, armrests, and pedestal base
    // Body bottom is at charY - px across all views, so seat meets it there.
    const chairDark = darken(palette.chair, 20);
    const chairColor = palette.chair;
    const chairLight = darken(palette.chair, -10);
    // Chair back (tall panel behind character, frames shoulders)
    ctx.fillStyle = chairDark;
    ctx.fillRect(charX - px * 2, charY - px * 7, px * 14, px * 9);
    ctx.fillStyle = chairColor;
    ctx.fillRect(charX - px, charY - px * 6, px * 12, px * 7);
    // Seat cushion (right at body bottom — character drawn on top hides overlap)
    ctx.fillStyle = chairDark;
    ctx.fillRect(charX - px * 2, charY - px * 1, px * 14, px * 3);
    ctx.fillStyle = chairColor;
    ctx.fillRect(charX - px, charY - px * 0.5, px * 12, px * 2);
    // Armrests (at elbow height, mid-torso)
    ctx.fillStyle = chairLight;
    ctx.fillRect(charX - px * 3, charY - px * 4, px * 2, px * 4);
    ctx.fillRect(charX + px * 11, charY - px * 4, px * 2, px * 4);
    // Chair pedestal (single leg + base)
    ctx.fillStyle = '#333340';
    const pedX = charX + px * 4.5;
    ctx.fillRect(pedX, charY + px * 2, px, deskY + px * 4 - (charY + px * 2));
    // Wheeled base
    ctx.fillStyle = '#2a2a35';
    ctx.fillRect(pedX - px * 3, deskY + px * 3, px * 7, px);

    // Always draw monitors first, then character on top — the character
    // sits between the viewer and the monitor in all camera angles.
    drawMonitorSetup(ctx, w, h, px, setup, palette, seed, frame, deskY, rxType, rxProgress, typingMult, isLarge, canvas, viewAngle);
    drawCharacter(ctx, w, h, px, palette, charX, charY, deskY, frame, rxType, rxProgress, typingMult, viewAngle);

    // Keyboard
    ctx.fillStyle = '#3a3a44';
    ctx.fillRect(charX - px, deskY - px * 2, px * 12, px * 2);
    for (let k = 0; k < 5; k++) {
        let keyColor;
        if (rxType === 'error') {
            keyColor = '#ff3333';
        } else if (rxType === 'complete') {
            const hue = ((k * 60 + frame * 8) % 360);
            keyColor = `hsl(${hue}, 80%, 60%)`;
        } else if (rxType === 'think') {
            keyColor = '#2a2a33';
        } else {
            const keyActive = ((seed * 3 + k * 7 + Math.floor(frame * typingMult * 0.3)) % 5 === 0);
            keyColor = keyActive ? '#7a7a88' : '#4a4a55';
        }
        ctx.fillStyle = keyColor;
        ctx.fillRect(charX + k * px * 2, deskY - px * 2, px, px);
    }
    if (typingMult > 2 && frame % 3 === 0) {
        const sparkX = charX + ((frame * 7 + seed) % 10) * px;
        ctx.fillStyle = 'rgba(255,200,50,0.5)';
        ctx.fillRect(sparkX, deskY - px * 3, px * 0.5, px * 0.5);
    }

    for (const d of decor) {
        drawDecoration(ctx, w, h, px, d, seed, frame, deskY);
    }

    drawMonitorGlow(ctx, w, h, px, setup, palette, frame);

    // Celebration particles
    if (rxType === 'complete') {
        drawCelebration(ctx, w, h, px, frame, rx.startFrame);
        if (rxProgress < 0.6) {
            ctx.fillStyle = '#00ff41';
            const cmx = w * 0.48, cmy = h * 0.25;
            ctx.fillRect(cmx, cmy + px * 2, px, px);
            ctx.fillRect(cmx + px, cmy + px * 3, px, px);
            ctx.fillRect(cmx + px * 2, cmy + px * 2, px, px);
            ctx.fillRect(cmx + px * 3, cmy + px, px, px);
            ctx.fillRect(cmx + px * 4, cmy, px, px);
        }
        for (let i = 0; i < 8; i++) {
            const sx = charX + px * 5 + Math.sin(frame * 0.3 + i * 0.8) * px * 8;
            const sy = charY - px * 14 - Math.abs(Math.sin(frame * 0.2 + i)) * px * 6;
            ctx.fillStyle = `rgba(255, 215, 0, ${0.5 + Math.sin(frame * 0.5 + i) * 0.3})`;
            ctx.fillRect(sx, sy, px * 0.5, px * 0.5);
        }
    }

    // Spawn rings
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

    // Error !
    if (rxType === 'error' && rxProgress < 0.5) {
        ctx.fillStyle = '#ff4444';
        const bangX = charX + px * 5, bangY = charY - px * 16;
        ctx.fillRect(bangX, bangY, px, px * 3);
        ctx.fillRect(bangX, bangY + px * 4, px, px);
    }

    // Think dots
    if (rxType === 'think') {
        const dotPhase = Math.floor(frame / 12) % 4;
        ctx.fillStyle = 'rgba(255,255,255,0.6)';
        for (let i = 0; i < Math.min(dotPhase, 3); i++) {
            ctx.fillRect(charX + px * 8 + i * px * 2, charY - px * 14 - i * px, px, px);
        }
    }

    // User wave
    if (rxType === 'user' && rxProgress < 0.6) {
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(charX + px * 10, charY - px * 12, px * 2, px * 2);
        ctx.fillRect(charX + px * 10.5, charY - px * 11, px, px);
    }

    // Bash lightning
    if (rxType === 'bash' && rxProgress < 0.4) {
        ctx.fillStyle = '#ffff00';
        const bx = charX + px * 5, by = deskY - px * 5;
        ctx.fillRect(bx + px, by, px, px);
        ctx.fillRect(bx, by + px, px * 2, px);
        ctx.fillRect(bx + px, by + px * 2, px, px);
    }

    // Dust motes
    for (let i = 0; i < 12; i++) {
        const pSeed = (seed * 13 + i * 7) % 1000;
        const speed = 0.1 + (pSeed % 5) * 0.05;
        const dx = (pSeed + frame * speed * 0.3) % w;
        const dy = ((pSeed * 3 + frame * speed) % (h * 0.7));
        const size = 1 + (pSeed % 2);
        ctx.fillStyle = `rgba(255,255,255,${0.03 + (pSeed % 10) * 0.006})`;
        ctx.fillRect(dx, dy, size, size);
    }

    // Monitor light particles
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

// ============================================================
// MONITOR SETUP
// ============================================================

function drawMonitorSetup(ctx, w, h, px, setup, palette, seed, frame, deskY, rxType, rxProgress, typingMult, isLarge, canvas, viewAngle) {
    const scrollSpeed = 0.5 * typingMult;
    const mc = canvas && canvas._monitorContent;
    const showBack = (viewAngle === 2); // front view: we see the back of the monitor

    if (setup === 'dual') {
        drawMonitor(ctx, w * 0.22, deskY - px * 18, px * 18, px * 14, px, palette, seed, frame, scrollSpeed, rxType, rxProgress, isLarge, mc, showBack);
        drawMonitor(ctx, w * 0.52, deskY - px * 18, px * 18, px * 14, px, palette, seed + 7, frame, scrollSpeed * 0.6, rxType, rxProgress, false, null, showBack);
    } else if (setup === 'ultrawide') {
        drawMonitor(ctx, w * 0.22, deskY - px * 16, px * 36, px * 14, px, palette, seed, frame, scrollSpeed, rxType, rxProgress, isLarge, mc, showBack);
    } else if (setup === 'laptop') {
        const lx = w * 0.32;
        const ly = deskY - px * 14;
        const lw = px * 24;
        const lh = px * 12;
        ctx.fillStyle = '#3a3a44';
        ctx.fillRect(lx - px, deskY - px * 2, lw + px * 2, px * 2);
        drawMonitor(ctx, lx, ly, lw, lh, px, palette, seed, frame, scrollSpeed, rxType, rxProgress, isLarge, mc, showBack);
    } else if (setup === 'triple') {
        drawMonitor(ctx, w * 0.12, deskY - px * 17, px * 14, px * 13, px, palette, seed, frame, scrollSpeed, rxType, rxProgress, isLarge, mc, showBack);
        drawMonitor(ctx, w * 0.36, deskY - px * 17, px * 14, px * 13, px, palette, seed + 7, frame, scrollSpeed * 0.7, rxType, rxProgress, false, null, showBack);
        drawMonitor(ctx, w * 0.60, deskY - px * 17, px * 14, px * 13, px, palette, seed + 13, frame, scrollSpeed * 0.5, rxType, rxProgress, false, null, showBack);
    } else if (setup === 'stacked') {
        drawMonitor(ctx, w * 0.28, deskY - px * 16, px * 28, px * 12, px, palette, seed, frame, scrollSpeed, rxType, rxProgress, isLarge, mc, showBack);
        drawMonitor(ctx, w * 0.32, deskY - px * 28, px * 22, px * 10, px, palette, seed + 5, frame, scrollSpeed * 0.6, rxType, rxProgress, false, null, showBack);
    } else {
        drawMonitor(ctx, w * 0.32, deskY - px * 18, px * 28, px * 16, px, palette, seed, frame, scrollSpeed, rxType, rxProgress, isLarge, mc, showBack);
    }
}

function drawMonitor(ctx, monX, monY, monW, monH, px, palette, seed, frame, scrollSpeed, rxType, rxProgress, isLarge, monitorContent, showBack) {
    // Bezel / frame
    ctx.fillStyle = '#2c2c34';
    ctx.fillRect(monX - px, monY - px, monW + px * 2, monH + px * 2);

    if (showBack) {
        // Front view — we see the rear of the monitor casing
        ctx.fillStyle = '#222230';
        ctx.fillRect(monX, monY, monW, monH);
        // Vents on the back panel
        ctx.fillStyle = '#1a1a28';
        for (let vy = monY + px * 3; vy < monY + monH - px * 2; vy += px * 2) {
            ctx.fillRect(monX + px * 3, vy, monW - px * 6, px * 0.5);
        }
        // Small manufacturer logo circle
        ctx.fillStyle = '#2a2a3a';
        const cx = monX + monW / 2;
        const cy = monY + monH / 2;
        ctx.fillRect(cx - px, cy - px, px * 2, px * 2);
    } else {
        // Back/side view — we see the screen
        let screenColor = palette.monitor;
        if (rxType === 'error' && rxProgress < 0.5) {
            screenColor = (Math.floor(rxProgress * 10) % 2 === 0) ? '#0000aa' : palette.monitor;
        }
        ctx.fillStyle = screenColor;
        ctx.fillRect(monX, monY, monW, monH);

        // Scanlines
        ctx.fillStyle = 'rgba(0,0,0,0.12)';
        for (let y = monY; y < monY + monH; y += px * 2) {
            ctx.fillRect(monX, y, monW, 1);
        }

        if (rxType === 'error' && rxProgress < 0.5) {
            drawErrorScreen(ctx, monX, monY, monW, monH, px, rxProgress);
            ctx.fillStyle = '#ff4444';
            ctx.fillRect(monX + monW / 2 - px, monY + monH - px * 4, px * 2, px * 2);
        } else if (rxType === 'think') {
            drawThinkingScreen(ctx, monX, monY, monW, monH, px, frame);
        } else {
            const mc = monitorContent || (isLarge ? state.monitorContent : null);
            const mcText = mc ? (mc._text || mc) : null;
            const mcType = mc ? (monitorContent ? monitorContent._type : state.monitorContentType) : null;
            if (mcText && typeof mcText === 'string' && mcText.length > 10) {
                drawRealCodeSession(ctx, monX, monY, monW, monH, px, frame, scrollSpeed, mcText, mcType);
            } else {
                drawMonitorContent(ctx, monX, monY, monW, monH, px, seed, frame, scrollSpeed);
            }
        }

        // Subtle screen flicker
        if (frame % 90 < 2) {
            ctx.fillStyle = 'rgba(255,255,255,0.03)';
            ctx.fillRect(monX, monY, monW, monH);
        }
    }

    // Stand
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
    ctx.fillStyle = '#cc0000';
    const errRows = 4;
    for (let r = 0; r < errRows; r++) {
        const ey = monY + px * 3 + r * px * 3;
        const elen = 6 + (r * 3) % 10;
        for (let c = 0; c < elen; c++) {
            ctx.fillRect(monX + px * (2 + c), ey, px - 1, px - 1);
        }
    }
    ctx.fillStyle = '#ff4444';
    const cx = monX + monW / 2;
    const cy = monY + monH / 2;
    for (let i = -2; i <= 2; i++) {
        ctx.fillRect(cx + i * px, cy + i * px, px, px);
        ctx.fillRect(cx + i * px, cy - i * px, px, px);
    }
}

function drawThinkingScreen(ctx, monX, monY, monW, monH, px, frame) {
    ctx.fillStyle = '#00ff41';
    const dotPhase = Math.floor(frame / 15) % 4;
    for (let i = 0; i < dotPhase; i++) {
        ctx.fillRect(monX + px * (3 + i * 2), monY + px * 4, px, px);
    }
    if (frame % 20 < 10) {
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(monX + px * (3 + dotPhase * 2), monY + px * 4, px, px * 1.5);
    }
}

export function drawCharacter(ctx, w, h, px, palette, charX, charY, deskY, frame, rxType, rxProgress, typingMult, viewAngle) {
    if (viewAngle === 1) {
        drawCharacterSide(ctx, w, h, px, palette, charX, charY, deskY, frame, rxType, rxProgress, typingMult);
    } else if (viewAngle === 2) {
        drawCharacterFront(ctx, w, h, px, palette, charX, charY, deskY, frame, rxType, rxProgress, typingMult);
    } else {
        drawCharacterBack(ctx, w, h, px, palette, charX, charY, deskY, frame, rxType, rxProgress, typingMult);
    }
}

// ---------- shared head motion ----------
function getHeadMotion(px, breathY, bodyOffX, frame, rxType, rxProgress, idle) {
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
        if (idle.action === 'yawn') headOffY += Math.sin(idle.phase * Math.PI) * -px;
        if (idle.action === 'nod') headOffY += Math.sin(idle.phase * Math.PI * 4) * px * 0.8;
        if (idle.action === 'phone') headOffX += px * 2 * Math.sin(idle.phase * Math.PI * 0.5);
    }
    return { headOffX, headOffY };
}

// ==========================================
// VIEW 0: BACK — character faces screens
// ==========================================
function drawCharacterBack(ctx, w, h, px, palette, charX, charY, deskY, frame, rxType, rxProgress, typingMult) {
    const breathY = Math.sin(frame * 0.04) * 1;
    const seed = hashCode(palette.shirt) % 1000;
    const fur = palette.fur;
    const face = palette.face;
    const shirtColor = palette.shirt;
    const furDark = darken(fur, 15);
    const idle = (!rxType) ? getIdleAction(seed, frame) : null;

    // Tail
    const tailSwing = Math.sin(frame * 0.06) * px * 2;
    ctx.fillStyle = fur;
    ctx.fillRect(charX + px * 4 + tailSwing * 0.2, charY - px * 2 + breathY, px * 1.5, px * 2);
    ctx.fillRect(charX + px * 5 + tailSwing * 0.4, charY - px * 3 + breathY, px, px * 2);
    ctx.fillRect(charX + px * 6 + tailSwing * 0.7, charY - px * 4 + breathY, px, px);
    ctx.fillRect(charX + px * 7 + tailSwing, charY - px * 5 + breathY, px, px);

    // Body — back of shirt
    let bodyOffX = 0;
    if (idle && idle.action === 'lean') bodyOffX = px * idle.phase;
    ctx.fillStyle = fur;
    ctx.fillRect(charX + px * 1.5 + bodyOffX, charY - px * 6 + breathY, px * 7, px * 5);
    ctx.fillStyle = shirtColor;
    ctx.fillRect(charX + px * 2 + bodyOffX, charY - px * 5.5 + breathY, px * 6, px * 4);
    ctx.fillStyle = darken(shirtColor, 12);
    ctx.fillRect(charX + px * 4.5 + bodyOffX, charY - px * 5 + breathY, px * 1, px * 3);

    // Head
    const { headOffX, headOffY } = getHeadMotion(px, breathY, bodyOffX, frame, rxType, rxProgress, idle);
    const hx = charX + px * 3 + headOffX;
    const hy = charY - px * 11 + headOffY;

    ctx.fillStyle = fur;
    ctx.fillRect(hx, hy, px * 4, px * 4);
    ctx.fillRect(hx - px * 0.5, hy + px * 0.5, px * 5, px * 3);
    ctx.fillRect(hx + px, hy - px, px * 2, px);
    ctx.fillStyle = furDark;
    ctx.fillRect(hx + px * 0.5, hy + px * 1, px * 3, px * 2);

    // Ears
    ctx.fillStyle = fur;
    ctx.fillRect(hx - px * 1.5, hy + px * 0.5, px * 2, px * 2);
    ctx.fillRect(hx + px * 3.5, hy + px * 0.5, px * 2, px * 2);
    ctx.fillStyle = face;
    ctx.fillRect(hx - px * 1, hy + px * 1, px * 0.5, px * 0.5);
    ctx.fillRect(hx + px * 4.5, hy + px * 1, px * 0.5, px * 0.5);

    // Headphones
    ctx.fillStyle = '#3a3a44';
    ctx.fillRect(hx - px * 0.5, hy - px * 0.5, px * 5, px * 1);
    ctx.fillStyle = '#555566';
    ctx.fillRect(hx - px * 1.5, hy + px * 1, px * 1.5, px * 2);
    ctx.fillRect(hx + px * 4, hy + px * 1, px * 1.5, px * 2);

    // Arms
    const armSpeed = 0.3 * typingMult;
    const armPhase = Math.sin(frame * armSpeed);

    if (rxType === 'error' && rxProgress < 0.5) {
        ctx.fillStyle = fur;
        ctx.fillRect(charX + px * 0.5, charY - px * 8, px * 2, px * 3);
        ctx.fillRect(charX + px * 7.5, charY - px * 8, px * 2, px * 3);
    } else if (rxType === 'complete' && rxProgress < 0.6) {
        const armUp = Math.sin(rxProgress * Math.PI * 4) * px * 2;
        ctx.fillStyle = fur;
        ctx.fillRect(charX + px * 0.5, charY - px * 7 - Math.abs(armUp), px * 2, px * 3);
        ctx.fillRect(charX + px * 7.5, charY - px * 7 - Math.abs(armUp), px * 2, px * 3);
    } else if (idle && idle.action === 'stretch') {
        ctx.fillStyle = fur;
        const stretchUp = idle.phase * px * 4;
        ctx.fillRect(charX + px * 0.5, charY - px * 7 - stretchUp, px * 2, px * 3);
        ctx.fillRect(charX + px * 7.5, charY - px * 7 - stretchUp, px * 2, px * 3);
    } else {
        const lBob = armPhase > 0 ? -px * 0.5 : 0;
        const rBob = armPhase > 0 ? 0 : -px * 0.5;
        ctx.fillStyle = fur;
        ctx.fillRect(charX + px * 0.5, charY - px * 5 + breathY + lBob, px * 2, px * 2.5);
        ctx.fillRect(charX + px * 7.5, charY - px * 5 + breathY + rBob, px * 2, px * 2.5);
        ctx.fillStyle = face;
        ctx.fillRect(charX + px * 1, charY - px * 3 + breathY + lBob, px * 1.5, px * 1);
        ctx.fillRect(charX + px * 7.5, charY - px * 3 + breathY + rBob, px * 1.5, px * 1);
    }
}

// ==========================================
// VIEW 1: SIDE — profile view facing right
// ==========================================
function drawCharacterSide(ctx, w, h, px, palette, charX, charY, deskY, frame, rxType, rxProgress, typingMult) {
    const breathY = Math.sin(frame * 0.04) * 1;
    const seed = hashCode(palette.shirt) % 1000;
    const fur = palette.fur;
    const face = palette.face;
    const shirtColor = palette.shirt;
    const idle = (!rxType) ? getIdleAction(seed, frame) : null;

    // Tail — extends left (behind character)
    const tailSwing = Math.sin(frame * 0.06) * px * 1.5;
    ctx.fillStyle = fur;
    ctx.fillRect(charX - px * 1 + tailSwing * 0.3, charY - px * 2 + breathY, px * 2, px);
    ctx.fillRect(charX - px * 3 + tailSwing * 0.6, charY - px * 3 + breathY, px * 2, px);
    ctx.fillRect(charX - px * 4 + tailSwing, charY - px * 4 + breathY, px, px);
    ctx.fillRect(charX - px * 5 + tailSwing, charY - px * 5 + breathY, px, px);

    // Body — side profile (narrower)
    let bodyOffX = 0;
    if (idle && idle.action === 'lean') bodyOffX = px * idle.phase;
    ctx.fillStyle = fur;
    ctx.fillRect(charX + px * 2 + bodyOffX, charY - px * 6 + breathY, px * 5, px * 5);
    ctx.fillStyle = shirtColor;
    ctx.fillRect(charX + px * 2.5 + bodyOffX, charY - px * 5.5 + breathY, px * 4, px * 4);

    // Head
    const { headOffX, headOffY } = getHeadMotion(px, breathY, bodyOffX, frame, rxType, rxProgress, idle);
    const hx = charX + px * 3 + headOffX;
    const hy = charY - px * 11 + headOffY;

    // Head shape — profile (wider toward face/right side)
    ctx.fillStyle = fur;
    ctx.fillRect(hx, hy, px * 4, px * 4);
    ctx.fillRect(hx - px * 0.5, hy + px * 0.5, px * 5, px * 3);
    ctx.fillRect(hx + px * 1, hy - px, px * 2, px);
    // Snout protrudes to the right
    ctx.fillStyle = face;
    ctx.fillRect(hx + px * 4, hy + px * 2, px * 2, px * 2);
    ctx.fillRect(hx + px * 3.5, hy + px * 2.5, px * 1, px * 1.5);

    // One ear visible (far side, slightly behind head)
    ctx.fillStyle = fur;
    ctx.fillRect(hx - px * 0.5, hy + px * 0.5, px * 1.5, px * 2);
    ctx.fillStyle = face;
    ctx.fillRect(hx, hy + px * 1, px * 0.5, px * 0.5);

    // Eye (one, profile)
    const blinkCycle = (frame + seed * 7) % 100;
    const isBlinking = blinkCycle >= 97;
    if (isBlinking) {
        ctx.fillStyle = '#111111';
        ctx.fillRect(hx + px * 2.5, hy + px * 1.8 + px * 0.3, px, px * 0.3);
    } else {
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(hx + px * 2.5, hy + px * 1.8, px, px);
        ctx.fillStyle = '#331100';
        ctx.fillRect(hx + px * 2.8, hy + px * 2, Math.ceil(px * 0.5), Math.ceil(px * 0.5));
    }

    // Nostril
    ctx.fillStyle = '#3a2010';
    ctx.fillRect(hx + px * 5, hy + px * 2.8, px * 0.4, px * 0.4);

    // Mouth (profile)
    if (rxType === 'complete') {
        ctx.fillStyle = '#cc6666';
        ctx.fillRect(hx + px * 4, hy + px * 3.5, px * 1.5, px * 0.5);
    } else if (rxType === 'error' && rxProgress < 0.4) {
        ctx.fillStyle = '#111111';
        ctx.fillRect(hx + px * 4, hy + px * 3.5, px * 1.5, px * 0.8);
    } else {
        ctx.fillStyle = '#3a2010';
        ctx.fillRect(hx + px * 4.2, hy + px * 3.8, px * 1, px * 0.2);
    }

    // Arms — one visible, reaching forward to keyboard
    const armSpeed = 0.3 * typingMult;
    const armPhase = Math.sin(frame * armSpeed);

    if (rxType === 'error' && rxProgress < 0.5) {
        ctx.fillStyle = fur;
        ctx.fillRect(charX + px * 5, charY - px * 9, px * 2, px * 4);
        ctx.fillStyle = face;
        ctx.fillRect(charX + px * 5, charY - px * 9, px * 1.5, px * 1.5);
    } else if (rxType === 'complete' && rxProgress < 0.6) {
        const armUp = Math.sin(rxProgress * Math.PI * 4) * px * 2;
        ctx.fillStyle = fur;
        ctx.fillRect(charX + px * 5, charY - px * 8 - Math.abs(armUp), px * 2, px * 3);
        ctx.fillStyle = face;
        ctx.fillRect(charX + px * 5, charY - px * 8 - Math.abs(armUp), px * 1.5, px * 1.5);
    } else if (idle && idle.action === 'stretch') {
        ctx.fillStyle = fur;
        const stretchUp = idle.phase * px * 4;
        ctx.fillRect(charX + px * 5, charY - px * 7 - stretchUp, px * 2, px * 3);
    } else {
        // Typing — arm extends forward and down to keyboard
        const bob = armPhase > 0 ? -px * 0.5 : 0;
        ctx.fillStyle = fur;
        ctx.fillRect(charX + px * 5.5, charY - px * 5 + breathY + bob, px * 2, px * 2);
        ctx.fillRect(charX + px * 7, charY - px * 4 + breathY + bob, px * 2, px * 2);
        ctx.fillStyle = face;
        ctx.fillRect(charX + px * 8.5, charY - px * 3 + breathY + bob, px * 1.5, px * 1);
    }
}

// ==========================================
// VIEW 2: FRONT — character faces viewer
// ==========================================
function drawCharacterFront(ctx, w, h, px, palette, charX, charY, deskY, frame, rxType, rxProgress, typingMult) {
    const breathY = Math.sin(frame * 0.04) * 1;
    const seed = hashCode(palette.shirt) % 1000;
    const fur = palette.fur;
    const face = palette.face;
    const belly = palette.belly || face;
    const idle = (!rxType) ? getIdleAction(seed, frame) : null;

    // Tail
    const tailSwing = Math.sin(frame * 0.06) * px * 2;
    ctx.fillStyle = fur;
    ctx.fillRect(charX + px * 8 + tailSwing * 0.3, charY - px * 3 + breathY, px, px * 2);
    ctx.fillRect(charX + px * 9 + tailSwing * 0.6, charY - px * 4 + breathY, px, px * 2);
    ctx.fillRect(charX + px * 10 + tailSwing, charY - px * 5 + breathY, px, px);
    ctx.fillRect(charX + px * 11 + tailSwing, charY - px * 6 + breathY, px, px);

    // Body
    let bodyOffX = 0;
    if (idle && idle.action === 'lean') bodyOffX = px * idle.phase;
    ctx.fillStyle = fur;
    ctx.fillRect(charX + px * 1.5 + bodyOffX, charY - px * 6 + breathY, px * 7, px * 5);
    ctx.fillStyle = palette.shirt;
    ctx.fillRect(charX + px * 2 + bodyOffX, charY - px * 5.5 + breathY, px * 6, px * 4);
    ctx.fillStyle = belly;
    ctx.fillRect(charX + px * 3.5 + bodyOffX, charY - px * 5 + breathY, px * 3, px * 3);

    // Head
    const { headOffX, headOffY } = getHeadMotion(px, breathY, bodyOffX, frame, rxType, rxProgress, idle);
    const hx = charX + px * 3 + headOffX;
    const hy = charY - px * 11 + headOffY;

    ctx.fillStyle = fur;
    ctx.fillRect(hx, hy, px * 4, px * 4);
    ctx.fillRect(hx - px * 0.5, hy + px * 0.5, px * 5, px * 3);
    ctx.fillRect(hx + px, hy - px, px * 2, px);

    // Ears
    ctx.fillStyle = fur;
    ctx.fillRect(hx - px * 1.5, hy + px * 0.5, px * 2, px * 2);
    ctx.fillRect(hx + px * 3.5, hy + px * 0.5, px * 2, px * 2);
    ctx.fillStyle = face;
    ctx.fillRect(hx - px, hy + px, px, px);
    ctx.fillRect(hx + px * 4, hy + px, px, px);

    // Face patch
    ctx.fillStyle = face;
    ctx.fillRect(hx + px * 0.5, hy + px * 1.5, px * 3, px * 2.5);
    ctx.fillRect(hx + px, hy + px * 3, px * 2, px * 1.5);

    // Eyes
    const blinkCycle = (frame + seed * 7) % 100;
    const isBlinking = blinkCycle >= 97;
    const eyeBaseX = hx + px * 0.8;
    const eyeBaseY = hy + px * 1.8;

    if (isBlinking) {
        ctx.fillStyle = '#111111';
        ctx.fillRect(eyeBaseX, eyeBaseY + px * 0.3, px, px * 0.3);
        ctx.fillRect(eyeBaseX + px * 2, eyeBaseY + px * 0.3, px, px * 0.3);
    } else {
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
        ctx.fillStyle = '#cc6666';
        ctx.fillRect(hx + px * 1, hy + px * 3.8, px * 2, px * 0.5);
    } else if (rxType === 'error' && rxProgress < 0.4) {
        ctx.fillStyle = '#111111';
        ctx.fillRect(hx + px * 1, hy + px * 3.8, px * 2, px * 0.8);
    } else if (idle && idle.action === 'sip' && idle.phase > 0.3 && idle.phase < 0.7) {
        ctx.fillStyle = '#111111';
        ctx.fillRect(hx + px * 1.5, hy + px * 3.8, px * 0.8, px * 0.4);
    } else if (idle && idle.action === 'yawn' && idle.phase > 0.2 && idle.phase < 0.8) {
        ctx.fillStyle = '#111111';
        ctx.fillRect(hx + px * 0.8, hy + px * 3.6, px * 2.2, px * 1);
    } else {
        ctx.fillStyle = '#3a2010';
        ctx.fillRect(hx + px * 1.2, hy + px * 3.8, px * 1.5, px * 0.2);
    }

    // Accessories (seed-based, front view only)
    const accessory = (seed >> 3) % 7; // 0=none, 1=hat, 2=glasses, 3=headphones, 4=beanie, 5=bowtie, 6=bandana
    if (accessory === 1) {
        const hatColor = ['#cc3333', '#3366cc', '#33aa55', '#ff9900', '#9146ff'][(seed >> 5) % 5];
        ctx.fillStyle = hatColor;
        ctx.fillRect(hx - px * 0.5, hy - px * 1.5, px * 5, px * 1.5);
        ctx.fillRect(hx + px * 0.5, hy - px * 3, px * 3, px * 1.5);
    } else if (accessory === 2) {
        ctx.fillStyle = '#222233';
        ctx.fillRect(eyeBaseX - px * 0.3, eyeBaseY - px * 0.2, px * 1.6, px * 1.4);
        ctx.fillRect(eyeBaseX + px * 1.7, eyeBaseY - px * 0.2, px * 1.6, px * 1.4);
        ctx.fillRect(eyeBaseX + px * 1.3, eyeBaseY + px * 0.1, px * 0.5, px * 0.3);
        ctx.fillStyle = 'rgba(100,180,255,0.15)';
        ctx.fillRect(eyeBaseX, eyeBaseY, px, px);
        ctx.fillRect(eyeBaseX + px * 2, eyeBaseY, px, px);
    } else if (accessory === 3) {
        ctx.fillStyle = '#333344';
        ctx.fillRect(hx - px * 1, hy + px * 0.3, px * 6, px * 0.8);
        ctx.fillRect(hx - px * 1.8, hy + px * 1, px * 1.8, px * 2);
        ctx.fillRect(hx + px * 4, hy + px * 1, px * 1.8, px * 2);
        ctx.fillStyle = '#555566';
        ctx.fillRect(hx - px * 1.3, hy + px * 1.3, px * 0.8, px * 1.4);
        ctx.fillRect(hx + px * 4.5, hy + px * 1.3, px * 0.8, px * 1.4);
    } else if (accessory === 4) {
        const beanieColor = ['#cc3333', '#3366cc', '#333333', '#ff6600', '#009966'][(seed >> 5) % 5];
        ctx.fillStyle = beanieColor;
        ctx.fillRect(hx - px * 0.5, hy - px * 0.5, px * 5, px * 2);
        ctx.fillRect(hx, hy - px * 1.5, px * 4, px * 1.5);
        ctx.fillRect(hx + px * 1, hy - px * 2, px * 2, px);
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(hx + px * 1.5, hy - px * 2.5, px, px);
    } else if (accessory === 5) {
        const btColor = ['#cc3333', '#3366cc', '#ffd700', '#ff69b4', '#00cc88'][(seed >> 5) % 5];
        ctx.fillStyle = btColor;
        const btY = hy + px * 4.5;
        const btX = hx + px * 1;
        ctx.fillRect(btX, btY, px * 0.8, px * 1.2);
        ctx.fillRect(btX + px * 1.2, btY, px * 0.8, px * 1.2);
        ctx.fillRect(btX + px * 0.8, btY + px * 0.3, px * 0.4, px * 0.6);
    } else if (accessory === 6) {
        const bandColor = ['#cc3333', '#3366cc', '#33aa55', '#ff6600', '#9146ff'][(seed >> 5) % 5];
        ctx.fillStyle = bandColor;
        ctx.fillRect(hx - px * 0.5, hy + px * 0.5, px * 5, px * 0.8);
        ctx.fillRect(hx + px * 4, hy + px * 0.8, px * 1.5, px * 0.5);
        ctx.fillRect(hx + px * 4.5, hy + px * 1.3, px, px * 0.5);
    }

    // Arms
    const armSpeed = 0.3 * typingMult;
    const armPhase = Math.sin(frame * armSpeed);

    if (rxType === 'error' && rxProgress < 0.5) {
        ctx.fillStyle = fur;
        ctx.fillRect(charX - px, charY - px * 8, px * 2, px * 3);
        ctx.fillRect(charX + px * 9, charY - px * 8, px * 2, px * 3);
        ctx.fillStyle = face;
        ctx.fillRect(charX - px, charY - px * 8, px * 1.5, px * 1.5);
        ctx.fillRect(charX + px * 9.5, charY - px * 8, px * 1.5, px * 1.5);
    } else if (rxType === 'complete' && rxProgress < 0.6) {
        const armUp = Math.sin(rxProgress * Math.PI * 4) * px * 2;
        ctx.fillStyle = fur;
        ctx.fillRect(charX - px, charY - px * 7 - Math.abs(armUp), px * 2, px * 3);
        ctx.fillRect(charX + px * 9, charY - px * 7 - Math.abs(armUp), px * 2, px * 3);
        ctx.fillStyle = face;
        ctx.fillRect(charX - px, charY - px * 7 - Math.abs(armUp), px * 1.5, px * 1.5);
        ctx.fillRect(charX + px * 9.5, charY - px * 7 - Math.abs(armUp), px * 1.5, px * 1.5);
    } else if (rxType === 'think') {
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
    } else if (idle && idle.action === 'yawn') {
        ctx.fillStyle = fur;
        const yawnLift = Math.sin(idle.phase * Math.PI);
        ctx.fillRect(charX + px * 7, charY - px * 8 - yawnLift * px * 2, px * 2, px * 3);
        ctx.fillRect(charX, charY - px * 4, px * 2, px * 3);
        ctx.fillStyle = face;
        ctx.fillRect(charX + px * 7, charY - px * 8 - yawnLift * px * 2, px * 1.5, px * 1.5);
    } else if (idle && idle.action === 'phone') {
        ctx.fillStyle = fur;
        ctx.fillRect(charX + px * 7 + headOffX, hy + px * 0.5, px * 2, px * 4);
        ctx.fillRect(charX, charY - px * 4, px * 2, px * 3);
        ctx.fillStyle = '#222233';
        ctx.fillRect(charX + px * 8 + headOffX, hy + px * 0.5, px * 1.2, px * 2);
        ctx.fillStyle = face;
        ctx.fillRect(charX + px * 7 + headOffX, hy + px * 0.5, px * 1.5, px * 1.5);
    } else if (idle && idle.action === 'nod') {
        const lArmY = charY - px * 4 + breathY;
        const rArmY = charY - px * 4 + breathY;
        ctx.fillStyle = fur;
        ctx.fillRect(charX, lArmY, px * 2, px * 3);
        ctx.fillRect(charX + px * 8, rArmY, px * 2, px * 3);
        ctx.fillStyle = face;
        ctx.fillRect(charX - px, lArmY + px * 2, px * 1.5, px * 1.5);
        ctx.fillRect(charX + px * 9.5, rArmY + px * 2, px * 1.5, px * 1.5);
    } else {
        const lArmY = charY - px * 4 + breathY + (armPhase > 0 ? -px : 0);
        const rArmY = charY - px * 4 + breathY + (armPhase > 0 ? 0 : -px);
        ctx.fillStyle = fur;
        ctx.fillRect(charX, lArmY, px * 2, px * 3);
        ctx.fillRect(charX - px, lArmY + px * 2, px, px);
        ctx.fillRect(charX + px * 8, rArmY, px * 2, px * 3);
        ctx.fillRect(charX + px * 10, rArmY + px * 2, px, px);
        ctx.fillStyle = face;
        ctx.fillRect(charX - px, lArmY + px * 2, px * 1.5, px * 1.5);
        ctx.fillRect(charX + px * 9.5, rArmY + px * 2, px * 1.5, px * 1.5);
    }
}

// ============================================================
// MONITOR GLOW & DECORATIONS
// ============================================================

function drawMonitorGlow(ctx, w, h, px, setup, palette, frame) {
    const glowAlpha = 0.04 + Math.sin(frame * 0.02) * 0.015;
    const monColor = palette.monitor;
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
            const sway = Math.sin(frame * 0.03) * px;
            ctx.fillStyle = '#228b22';
            ctx.fillRect(px2 + px + sway * 0.3, deskY - px * 7, px * 2, px * 3);
            ctx.fillRect(px2 - px + sway * 0.5, deskY - px * 6, px * 2, px * 2);
            ctx.fillRect(px2 + px * 3 - sway * 0.4, deskY - px * 6, px * 2, px * 2);
            ctx.fillRect(px2 + px * 4 + sway, deskY - px * 7, px, px);
            if (frame % 300 < 30) {
                ctx.fillStyle = '#44cc44';
                ctx.fillRect(px2 + px * 2 + sway, deskY - px * 8, px, px);
            }
            break;
        }
        case 'cat': {
            const cx = w * 0.18;
            const catY = deskY - px * 3;
            const catCycle = Math.floor(frame / 400) % 3;
            const catPhase = (frame % 400) / 400;

            if (catCycle === 1 && catPhase < 0.3) {
                ctx.fillStyle = '#ff8c00';
                ctx.fillRect(cx, catY - px, px * 5, px * 2);
                ctx.fillRect(cx + px * 4, catY - px * 3, px * 3, px * 2);
                ctx.fillRect(cx, catY - px * 2, px * 2, px);
            } else {
                ctx.fillStyle = '#ff8c00';
                ctx.fillRect(cx, catY, px * 4, px * 2);
                ctx.fillRect(cx + px * 3, catY - px * 2, px * 3, px * 2);
            }
            ctx.fillStyle = '#ff6600';
            const headX = catCycle === 1 && catPhase < 0.3 ? cx + px * 4 : cx + px * 3;
            const headY = catCycle === 1 && catPhase < 0.3 ? catY - px * 4 : catY - px * 3;
            ctx.fillRect(headX, headY, px, px);
            ctx.fillRect(headX + px * 2, headY, px, px);
            if (frame % 120 < 110) {
                ctx.fillStyle = '#00ff00';
                const headTurn = Math.sin(frame * 0.02) * px * 0.3;
                ctx.fillRect(headX + px + headTurn, headY + px, px * 0.5, px * 0.5);
                ctx.fillRect(headX + px * 1.5 + headTurn, headY + px, px * 0.5, px * 0.5);
            }
            ctx.fillStyle = '#ff8c00';
            const tailCurl = Math.sin(frame * 0.08);
            const tailX = cx - px + tailCurl * px;
            ctx.fillRect(tailX, catY, px, px);
            ctx.fillRect(tailX - px * 0.5 + tailCurl * px * 0.3, catY - px, px, px);
            ctx.fillRect(tailX - px + tailCurl * px * 0.5, catY - px * 2, px, px);
            if (seed % 2 === 0 && frame % 40 < 20) {
                ctx.fillStyle = 'rgba(255,255,255,0.3)';
                ctx.fillRect(cx + px * 6, catY - px * 3, px, px);
            }
            break;
        }
        case 'figurine': {
            const fx = w * 0.2;
            ctx.fillStyle = '#9146ff';
            ctx.fillRect(fx, deskY - px * 5, px * 3, px * 3);
            ctx.fillStyle = '#bf94ff';
            ctx.fillRect(fx + px * 0.5, deskY - px * 4.5, px, px * 0.5);
            ctx.fillRect(fx + px * 1.5, deskY - px * 4.5, px, px * 0.5);
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
            const lampFlicker = 0.06 + Math.sin(frame * 0.15) * 0.02 + (frame % 7 === 0 ? 0.03 : 0);
            ctx.fillStyle = `rgba(240, 198, 116, ${lampFlicker})`;
            ctx.fillRect(lx - px * 4, deskY - px * 10, px * 10, px * 9);
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
            const bob = Math.sin(frame * 0.06) * px * 0.5;
            ctx.fillStyle = '#ffdd00';
            ctx.fillRect(dx, deskY - px * 3 + bob, px * 3, px * 2);
            ctx.fillRect(dx + px, deskY - px * 5 + bob, px * 2, px * 2);
            ctx.fillStyle = '#ff8800';
            ctx.fillRect(dx + px * 3, deskY - px * 4.5 + bob, px, px);
            ctx.fillStyle = '#000000';
            ctx.fillRect(dx + px * 1.5, deskY - px * 4.5 + bob, px * 0.4, px * 0.4);
            if (frame % 200 < 40) {
                ctx.fillStyle = 'rgba(255,255,255,0.7)';
                ctx.fillRect(dx + px * 3, deskY - px * 6.5 + bob, px * 3, px * 2);
                ctx.fillStyle = '#000000';
                ctx.fillRect(dx + px * 3.5, deskY - px * 6 + bob, px * 0.5, px * 0.5);
                ctx.fillRect(dx + px * 4.5, deskY - px * 6 + bob, px * 0.5, px * 0.5);
            }
            break;
        }
        case 'books': {
            const bx = w * 0.19;
            ctx.fillStyle = '#cc3333';
            ctx.fillRect(bx, deskY - px * 5, px * 4, px * 1.5);
            ctx.fillStyle = '#3366cc';
            ctx.fillRect(bx + px * 0.2, deskY - px * 3.5, px * 3.6, px * 1.5);
            ctx.fillStyle = '#33aa55';
            ctx.fillRect(bx - px * 0.2, deskY - px * 2, px * 4.4, px * 1.5);
            ctx.fillStyle = 'rgba(255,255,255,0.2)';
            ctx.fillRect(bx + px * 0.5, deskY - px * 5, px * 0.3, px * 1.2);
            ctx.fillRect(bx + px * 1.5, deskY - px * 3.5, px * 0.3, px * 1.2);
            ctx.fillRect(bx + px * 2.5, deskY - px * 2, px * 0.3, px * 1.2);
            break;
        }
        case 'headphones': {
            const hx = w * 0.74;
            ctx.fillStyle = '#333344';
            ctx.fillRect(hx, deskY - px * 6, px * 4, px);
            ctx.fillRect(hx - px * 0.5, deskY - px * 5.5, px, px * 0.5);
            ctx.fillRect(hx + px * 4 - px * 0.5, deskY - px * 5.5, px, px * 0.5);
            ctx.fillRect(hx - px, deskY - px * 5, px * 2, px * 3);
            ctx.fillRect(hx + px * 3, deskY - px * 5, px * 2, px * 3);
            ctx.fillStyle = '#555566';
            ctx.fillRect(hx - px * 0.5, deskY - px * 4.5, px, px * 2);
            ctx.fillRect(hx + px * 3.5, deskY - px * 4.5, px, px * 2);
            break;
        }
        case 'snack': {
            const sx = w * 0.68;
            ctx.fillStyle = '#ff9900';
            ctx.fillRect(sx, deskY - px * 3, px * 3, px * 2.5);
            ctx.fillStyle = '#cc7700';
            ctx.fillRect(sx + px * 0.5, deskY - px * 3.5, px * 2, px * 0.5);
            ctx.fillStyle = '#ffbb33';
            ctx.fillRect(sx + px * 0.3, deskY - px * 2.5, px * 0.5, px * 0.5);
            ctx.fillRect(sx + px * 1.5, deskY - px * 2.3, px * 0.5, px * 0.5);
            break;
        }
        case 'photo': {
            const fx = w * 0.19;
            ctx.fillStyle = '#8B7355';
            ctx.fillRect(fx, deskY - px * 6, px * 5, px * 4.5);
            ctx.fillStyle = '#4488aa';
            ctx.fillRect(fx + px * 0.5, deskY - px * 5.5, px * 4, px * 3.5);
            ctx.fillStyle = '#336688';
            ctx.fillRect(fx + px * 1.5, deskY - px * 4, px * 2, px * 1.5);
            ctx.fillRect(fx + px * 2, deskY - px * 5, px, px);
            ctx.fillStyle = '#8B7355';
            ctx.fillRect(fx + px * 1.5, deskY - px * 1.5, px * 2, px * 1.5);
            break;
        }
        case 'cactus': {
            const cx = w * 0.2;
            ctx.fillStyle = '#cc6633';
            ctx.fillRect(cx, deskY - px * 3, px * 3, px * 2.5);
            ctx.fillStyle = '#aa5522';
            ctx.fillRect(cx - px * 0.3, deskY - px * 3, px * 3.6, px * 0.8);
            ctx.fillStyle = '#2d8a4e';
            ctx.fillRect(cx + px * 0.5, deskY - px * 7, px * 2, px * 4);
            ctx.fillRect(cx - px * 0.5, deskY - px * 5.5, px * 1.5, px);
            ctx.fillRect(cx - px * 0.5, deskY - px * 6.5, px, px * 1.5);
            ctx.fillRect(cx + px * 2, deskY - px * 6, px * 1.5, px);
            ctx.fillRect(cx + px * 3, deskY - px * 7, px, px * 1.5);
            ctx.fillStyle = '#88cc88';
            ctx.fillRect(cx + px, deskY - px * 6.5, px * 0.3, px * 0.3);
            ctx.fillRect(cx + px * 1.8, deskY - px * 5.5, px * 0.3, px * 0.3);
            ctx.fillRect(cx + px * 0.8, deskY - px * 4.5, px * 0.3, px * 0.3);
            break;
        }
        case 'trophy': {
            const tx = w * 0.2;
            ctx.fillStyle = '#8B7355';
            ctx.fillRect(tx + px * 0.5, deskY - px * 1.5, px * 2, px * 1.5);
            ctx.fillStyle = '#ffd700';
            ctx.fillRect(tx + px, deskY - px * 3, px, px * 1.5);
            ctx.fillRect(tx, deskY - px * 5.5, px * 3, px * 2.5);
            ctx.fillStyle = '#cc9900';
            ctx.fillRect(tx + px * 0.5, deskY - px * 5, px * 2, px * 1.5);
            ctx.fillStyle = '#ffd700';
            ctx.fillRect(tx - px * 0.5, deskY - px * 5, px * 0.5, px * 1.5);
            ctx.fillRect(tx + px * 3, deskY - px * 5, px * 0.5, px * 1.5);
            ctx.fillStyle = '#ffffff';
            ctx.fillRect(tx + px * 1.2, deskY - px * 4.5, px * 0.6, px * 0.6);
            break;
        }
        case 'poster': break;
    }
}

function drawPoster(ctx, w, h, px, seed, frame) {
    const postX = w * 0.08;
    const postY = h * 0.08;
    const postW = px * 12;
    const postH = px * 10;
    ctx.fillStyle = '#3a3a44';
    ctx.fillRect(postX - px, postY - px, postW + px * 2, postH + px * 2);
    ctx.fillStyle = '#1a1a44';
    ctx.fillRect(postX, postY, postW, postH);
    ctx.fillStyle = '#4a6a4a';
    for (let i = 0; i < 6; i++) {
        ctx.fillRect(postX + px * (3 + i), postY + postH - px * (1 + i * 0.8), px, px * (1 + i * 0.8));
    }
    ctx.fillStyle = '#8899aa';
    for (let i = 0; i < 4; i++) {
        ctx.fillRect(postX + px * (7 + i), postY + postH - px * (1 + i * 0.5), px, px * (1 + i * 0.5));
    }
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(postX + px * 2, postY + px * 2, 1, 1);
    ctx.fillRect(postX + px * 8, postY + px * 1, 1, 1);
    ctx.fillRect(postX + px * 5, postY + px * 3, 1, 1);
}

export function drawWindow(ctx, w, h, px, frame, seed) {
    seed = seed || 0;
    const winX = w * 0.78;
    const winY = h * 0.05;
    const winW = px * 12;
    const winH = px * 10;
    ctx.fillStyle = '#3a3a44';
    ctx.fillRect(winX - px, winY - px, winW + px * 2, winH + px * 2);
    ctx.fillStyle = '#0a0a2a';
    ctx.fillRect(winX, winY, winW, winH);

    const sceneType = seed % 6;
    if (sceneType === 0 || sceneType === 1) {
        // Cityscape
        ctx.fillStyle = '#111122';
        const buildings = [3, 5, 4, 7, 3, 6, 4, 5];
        for (let i = 0; i < buildings.length; i++) {
            const bx = winX + i * px * 1.5;
            const bh = buildings[i] * px * 0.8;
            ctx.fillRect(bx, winY + winH - bh, px * 1.2, bh);
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
    } else if (sceneType === 2) {
        // Mountain silhouette
        const grad = ctx.createLinearGradient(winX, winY, winX, winY + winH);
        grad.addColorStop(0, '#1a0a2e');
        grad.addColorStop(0.6, '#ff6b35');
        grad.addColorStop(1, '#ffcc66');
        ctx.fillStyle = grad;
        ctx.fillRect(winX, winY, winW, winH);
        ctx.fillStyle = '#0a0a1a';
        const peaks = [0.4, 0.7, 0.5, 0.8, 0.3, 0.6];
        for (let i = 0; i < peaks.length; i++) {
            const mx = winX + i * px * 2;
            const mh = peaks[i] * winH * 0.5;
            ctx.fillRect(mx, winY + winH - mh, px * 2.5, mh);
        }
    } else if (sceneType === 3) {
        // Forest
        ctx.fillStyle = '#0a1a0a';
        ctx.fillRect(winX, winY + winH * 0.6, winW, winH * 0.4);
        for (let i = 0; i < 6; i++) {
            const tx = winX + i * px * 2;
            const th = (3 + (i * 7 + seed) % 4) * px;
            ctx.fillStyle = '#3a2a1a';
            ctx.fillRect(tx + px * 0.7, winY + winH - th * 0.3, px * 0.6, th * 0.3);
            ctx.fillStyle = '#1a4a1a';
            ctx.fillRect(tx, winY + winH - th, px * 2, th * 0.7);
            ctx.fillRect(tx + px * 0.3, winY + winH - th - px, px * 1.4, px);
        }
    } else if (sceneType === 4) {
        // Space with planet
        ctx.fillStyle = '#ffffff';
        for (let s = 0; s < 15; s++) {
            const sx = winX + ((seed * 3 + s * 17) % Math.floor(winW));
            const sy = winY + ((seed * 7 + s * 23) % Math.floor(winH));
            const bright = 0.3 + (s % 3) * 0.3;
            ctx.fillStyle = `rgba(255,255,255,${bright})`;
            ctx.fillRect(sx, sy, 1, 1);
        }
        const planetX = winX + winW * 0.65;
        const planetY = winY + winH * 0.4;
        const planetR = px * 2.5;
        const planetColors = ['#cc6644', '#4488aa', '#44aa66', '#aa6688'];
        ctx.fillStyle = planetColors[seed % planetColors.length];
        ctx.beginPath();
        ctx.arc(planetX, planetY, planetR, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = 'rgba(200,200,200,0.3)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.ellipse(planetX, planetY, planetR * 1.8, planetR * 0.4, 0, 0, Math.PI * 2);
        ctx.stroke();
    } else if (sceneType === 5) {
        // Snow scene
        ctx.fillStyle = '#eeeeff';
        ctx.fillRect(winX, winY + winH - px * 2, winW, px * 2);
        ctx.fillRect(winX, winY + winH - px * 2.5, winW * 0.3, px * 0.5);
        ctx.fillRect(winX + winW * 0.5, winY + winH - px * 2.5, winW * 0.3, px * 0.5);
        for (let s = 0; s < 10; s++) {
            const fx = winX + ((seed * 5 + s * 19 + frame) % Math.floor(winW));
            const fy = winY + ((s * 29 + frame * 0.8) % Math.floor(winH));
            if (fx >= winX && fx < winX + winW && fy >= winY && fy < winY + winH) {
                ctx.fillStyle = `rgba(255,255,255,${0.4 + (s % 3) * 0.2})`;
                ctx.fillRect(fx, fy, 1, 1);
            }
        }
    }

    ctx.fillStyle = '#ffffcc';
    ctx.fillRect(winX + px * 2, winY + px * 2, px * 3, px * 3);
    ctx.fillStyle = '#0a0a2a';
    ctx.fillRect(winX + px * 3, winY + px * 1.5, px * 2, px * 2);

    const cloudX = winX + ((frame * 0.15 + seed * 20) % (winW + px * 6)) - px * 3;
    if (cloudX >= winX && cloudX + px * 4 <= winX + winW) {
        ctx.fillStyle = 'rgba(100,100,140,0.3)';
        ctx.fillRect(cloudX, winY + px * 4, px * 4, px);
        ctx.fillRect(cloudX + px, winY + px * 3, px * 2, px);
    }

    ctx.fillStyle = '#ffffff';
    if (frame % 40 < 30) ctx.fillRect(winX + px * 7, winY + px * 3, 1, 1);
    if (frame % 50 < 35) ctx.fillRect(winX + px * 9, winY + px * 1, 1, 1);
    if (frame % 35 < 25) ctx.fillRect(winX + px * 5, winY + px * 7, 1, 1);

    const shootPhase = frame % 500;
    if (shootPhase < 8) {
        ctx.fillStyle = `rgba(255,255,255,${0.8 - shootPhase * 0.1})`;
        const sx = winX + px * 8 - shootPhase * px * 0.8;
        const sy = winY + px + shootPhase * px * 0.4;
        if (sx >= winX && sx <= winX + winW && sy >= winY && sy <= winY + winH) {
            ctx.fillRect(sx, sy, px * 0.5, px * 0.3);
        }
    }

    if (seed % 5 === 0) {
        ctx.fillStyle = 'rgba(120,140,200,0.4)';
        for (let r = 0; r < 8; r++) {
            const rx = winX + ((seed * 3 + r * 17 + frame * 2) % Math.floor(winW));
            const ry = winY + ((r * 23 + frame * 3) % Math.floor(winH));
            if (rx >= winX && rx < winX + winW && ry >= winY && ry < winY + winH) {
                ctx.fillRect(rx, ry, 1, px);
            }
        }
        if (frame % 6 < 3) {
            ctx.fillStyle = 'rgba(120,140,200,0.15)';
            ctx.fillRect(winX, winY + winH, winW, px * 0.5);
        }
    }

    ctx.fillStyle = '#3a3a44';
    ctx.fillRect(winX - px * 2, winY + winH + px, winW + px * 4, px);
}

export function drawCelebration(ctx, w, h, px, frame, startFrame) {
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

export function getIdleAction(seed, frame) {
    const cycle = Math.floor(frame / 200) + seed * 3;
    const phase = (frame % 200) / 200;
    switch (cycle % 8) {
        case 0: return { action: 'sip', phase };
        case 1: return { action: 'stretch', phase };
        case 2: return { action: 'look', phase };
        case 3: return { action: 'scratch', phase };
        case 4: return { action: 'lean', phase };
        case 5: return { action: 'yawn', phase };
        case 6: return { action: 'phone', phase };
        case 7: return { action: 'nod', phase };
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

// Session-view version of drawRealCode (pixel-based character rendering)
export function drawRealCodeSession(ctx, monX, monY, monW, monH, px, frame, scrollSpeed, contentText, contentType) {
    const content = contentText || state.monitorContent || '';
    if (!content) return;
    const lines = content.split('\n').filter(l => l.trim().length > 0);
    if (lines.length === 0) return;

    const charW = px;
    const charH = px;
    const lineH = px * 2.5;
    const gutterW = px * 4;
    const margin = px * 1.5;
    const codeX = monX + margin + gutterW;
    const codeW = monW - margin * 2 - gutterW;
    const maxCols = Math.floor(codeW / charW);
    const maxRows = Math.floor((monH - margin * 2) / lineH);
    const scrollOffset = Math.floor(frame * scrollSpeed * 0.15) % Math.max(1, lines.length);

    const evtType = contentType || state.monitorContentType;
    const colorSchemes = {
        bash:        { keyword: '#ffcc00', text: '#e0e0e0', comment: '#666666', string: '#00ff41' },
        error:       { keyword: '#ff4444', text: '#ff8888', comment: '#884444', string: '#ffaaaa' },
        think:       { keyword: '#88aaff', text: '#cccccc', comment: '#666688', string: '#aaccff' },
        file_create: { keyword: '#00e676', text: '#c5c8c6', comment: '#5c6370', string: '#98c379' },
        file_update: { keyword: '#00e676', text: '#c5c8c6', comment: '#5c6370', string: '#98c379' },
    };
    const colors = colorSchemes[evtType] || { keyword: '#00ff41', text: '#c5c8c6', comment: '#5c6370', string: '#e5c07b' };

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

        ctx.fillStyle = '#556666';
        const numStr = String((lineIdx + 1) % 1000).padStart(3, ' ');
        for (let d = 0; d < numStr.length; d++) {
            if (numStr[d] !== ' ') {
                ctx.fillRect(monX + margin + d * charW, lineY, charW - 1, charH);
            }
        }

        for (let col = 0; col < Math.min(line.length, maxCols); col++) {
            const ch = line[col];
            if (ch === ' ' || ch === '\t') continue;
            ctx.fillStyle = getCharColor(line, col);
            const cx = codeX + col * charW;
            if (cx + charW > monX + monW - margin) break;
            ctx.fillRect(cx, lineY, charW - 1, charH);
        }
    }

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

        ctx.fillStyle = '#00ff41';
        ctx.fillRect(monX + px, lineY, px, px - 1);
        ctx.fillRect(monX + px * 2.5, lineY, px * 0.5, px - 1);

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

        ctx.fillStyle = isFolder ? folderColors[row % folderColors.length] : fileColors[row % fileColors.length];
        ctx.fillRect(indentX, lineY, px, px - 1);

        const nameLen = 3 + (lineSeed % 8);
        for (let col = 0; col < nameLen; col++) {
            if ((lineSeed + col * 11) % 100 < 15) continue;
            ctx.fillRect(indentX + px * (2 + col), lineY, px - 1, px - 1);
        }

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

        ctx.fillStyle = '#5588aa';
        for (let c = 0; c < 4; c++) {
            ctx.fillRect(monX + px * (1 + c), lineY, px - 1, px - 1);
        }

        const colorIdx = (lineSeed % logColors.length);
        ctx.fillStyle = logColors[colorIdx];
        ctx.fillRect(monX + px * 6, lineY, px * 2, px - 1);

        const lineLen = 3 + (lineSeed % (maxCols - 12));
        for (let col = 0; col < lineLen; col++) {
            if ((lineSeed + col * 13) % 100 < 22) continue;
            const cx = monX + px * (9 + col);
            if (cx + px > monX + monW - px) break;
            ctx.fillRect(cx, lineY, px - 1, px - 1);
        }
    }
}

// ============================================================
// ANIMATION CONTROL
// ============================================================

export function startPixelAnimation(canvas, seed, isLarge) {
    let frame = Math.floor(Math.random() * 100);
    const id = canvas.dataset.animId || ('' + Math.random());
    canvas.dataset.animId = id;

    if (state.animFrames.has(id)) cancelAnimationFrame(state.animFrames.get(id));

    let lastDraw = 0;
    function animate(ts) {
        state.animFrames.set(id, requestAnimationFrame(animate));
        if (ts - lastDraw < 67) return;
        lastDraw = ts;
        drawPixelScene(canvas, seed, frame, isLarge);
        frame++;
    }
    state.animFrames.set(id, requestAnimationFrame(animate));
}

export function stopAllAnimations() {
    state.animFrames.forEach((id) => cancelAnimationFrame(id));
    state.animFrames.clear();
}

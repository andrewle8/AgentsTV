/* AgentsTV — chat message rendering, viewer chat, narrator */

import { state, CHAT_BADGES } from './state.js';
import { esc, fmtTokens, hashCode } from './utils.js';
import { triggerReaction } from './pixelEngine.js';

// ============================================================
// CHAT MODE HELPERS
// ============================================================

export function getViewerLog() {
    if (!state.chatSplit) return document.getElementById('chat-log');
    return document.getElementById('viewer-log');
}

export function getAgentLog() {
    if (!state.chatSplit) return document.getElementById('chat-log');
    return document.getElementById('event-log');
}

export function toggleChatSplit() {
    state.chatSplit = !state.chatSplit;
    try { localStorage.setItem('agenttv_chatSplit', state.chatSplit ? '1' : '0'); } catch {}
    applyChatMode();
    if (state.session) {
        if (state.view === 'master') renderMasterChatLog(state.session);
        else renderChatLog(state.session);
    }
}

export function applyChatMode() {
    const chatLog = document.getElementById('chat-log');
    const viewerPane = document.querySelector('.viewer-pane');
    const agentPane = document.querySelector('.agent-pane');
    const divider = document.querySelector('.chat-pane-divider');
    const splitBtn = document.getElementById('split-chat-btn');

    if (state.chatSplit) {
        if (chatLog) chatLog.style.display = 'none';
        if (viewerPane) viewerPane.style.display = '';
        if (agentPane) agentPane.style.display = '';
        if (divider) divider.style.display = '';
        if (splitBtn) { splitBtn.title = 'Combine chat'; splitBtn.classList.add('active'); }
        setupDividerDrag();
    } else {
        if (chatLog) chatLog.style.display = '';
        if (viewerPane) viewerPane.style.display = 'none';
        if (agentPane) agentPane.style.display = 'none';
        if (divider) divider.style.display = 'none';
        if (splitBtn) { splitBtn.title = 'Split chat'; splitBtn.classList.remove('active'); }
    }
}

// ============================================================
// PROJECT COLORS (for master mode)
// ============================================================

const PROJECT_COLORS = [
    '#81d4fa', '#e879a8', '#f0c674', '#a5d6a7', '#ef5350',
    '#64b5f6', '#ffb74d', '#bf94ff', '#4dd0e1', '#ff8a65',
    '#aed581', '#ce93d8', '#90caf9', '#fff176',
];
const _projectColorMap = {};
let _projectColorIdx = 0;
export function getProjectColor(project) {
    if (!project) return null;
    if (!_projectColorMap[project]) {
        _projectColorMap[project] = PROJECT_COLORS[_projectColorIdx % PROJECT_COLORS.length];
        _projectColorIdx++;
    }
    return _projectColorMap[project];
}

// ============================================================
// CHAT MESSAGE CAP
// ============================================================

const MAX_CHAT_MESSAGES = 500;

function capChatDom(log) {
    while (log.children.length > MAX_CHAT_MESSAGES) {
        log.removeChild(log.firstChild);
    }
}

// ============================================================
// APPEND CHAT MESSAGE
// ============================================================

export function appendChatMessage(log, evt, s, isMaster, evtIndex) {
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

    const projColor = isMaster ? getProjectColor(evt.project) : null;

    const div = document.createElement('div');
    div.className = 'chat-msg' + (totalTok > 0 ? ' has-tokens' : '');

    const badge = CHAT_BADGES[evt.type] || '·';
    const modBadge = isSubagent ? '🗡' : '';
    const nameClass = projColor ? '' : `name-${agentColor}`;
    const nameStyle = projColor ? ` style="color:${projColor}"` : '';
    const chatText = buildChatText(evt);
    const tokenHtml = totalTok > 0 ? `<span class="token-badge">+${fmtTokens(totalTok)}</span>` : '';

    div.innerHTML = `<span class="chat-badge">${badge}</span>`
        + (modBadge ? `<span class="chat-badge">${modBadge}</span>` : '')
        + `<span class="chat-name ${nameClass}"${nameStyle}>${esc(agentName)}</span>`
        + `<span class="chat-text">${esc(chatText)}</span>`
        + tokenHtml;

    const expanded = document.createElement('div');
    expanded.className = 'chat-expanded';

    const expandedText = document.createElement('div');
    expandedText.textContent = evt.content || '(no content)';
    expanded.appendChild(expandedText);

    if (evt.content && evtIndex != null) {
        const askBtn = document.createElement('button');
        askBtn.className = 'ask-about-btn';
        askBtn.textContent = 'Ask about this';
        const capturedIndex = evtIndex;
        askBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            setReplyToEvent(capturedIndex, chatText.substring(0, 80));
        });
        expanded.appendChild(askBtn);
    }

    div.addEventListener('click', () => {
        expanded.style.display = expanded.style.display === 'block' ? 'none' : 'block';
    });

    log.appendChild(div);
    log.appendChild(expanded);
    capChatDom(log);
    updateAgentCount();
}

export function buildChatText(evt) {
    switch (evt.type) {
        case 'spawn': return `spawns \u2192 ${evt.summary}`;
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

export function buildStreamTitle(session) {
    if (!session) return 'Coding \u00b7 Claude Code';
    const events = (session.events || []).slice(-5);
    const extMap = {
        '.py': 'Python', '.js': 'JavaScript', '.ts': 'TypeScript', '.tsx': 'React',
        '.jsx': 'React', '.rs': 'Rust', '.go': 'Go', '.java': 'Java',
        '.rb': 'Ruby', '.cpp': 'C++', '.c': 'C', '.cs': 'C#',
        '.html': 'HTML', '.css': 'CSS', '.sh': 'Shell', '.md': 'Markdown',
        '.json': 'JSON', '.yaml': 'YAML', '.yml': 'YAML', '.toml': 'TOML',
        '.sql': 'SQL', '.swift': 'Swift', '.kt': 'Kotlin', '.php': 'PHP',
    };
    let activity = null;
    let language = null;
    for (const evt of events.reverse()) {
        const t = evt.type;
        if (!activity) {
            if (t === 'file_create' || t === 'file_update') activity = 'Coding';
            else if (t === 'bash') activity = 'Terminal';
            else if (t === 'think') activity = 'Planning';
            else if (t === 'web_search') activity = 'Research';
        }
        if (!language && evt.file_path) {
            const dot = evt.file_path.lastIndexOf('.');
            if (dot !== -1) {
                const ext = evt.file_path.slice(dot).toLowerCase();
                if (extMap[ext]) language = extMap[ext];
            }
        }
        if (activity && language) break;
    }
    const parts = [];
    if (activity) parts.push(activity);
    if (language) parts.push(language);
    if (session.branch) parts.push(session.branch);
    return parts.length > 0 ? parts.join(' \u00b7 ') : 'Coding \u00b7 Claude Code';
}

// ============================================================
// RENDER CHAT LOGS
// ============================================================

export function renderChatLog(s) {
    const log = getAgentLog();
    const wasAtBottom = state.autoScroll;
    log.innerHTML = '';
    if (state.chatSplit) {
        const viewerLog = document.getElementById('viewer-log');
        if (viewerLog) viewerLog.innerHTML = '';
    }
    state.inventory = {};

    let lastEvent = null;

    s.events.forEach((evt, idx) => {
        appendChatMessage(log, evt, s, false, idx);
        if (isEventVisible(evt.type)) lastEvent = evt;
    });

    if (lastEvent && state.view === 'session') {
        triggerReaction(lastEvent.type, lastEvent.content);
    }

    if (wasAtBottom) log.scrollTop = log.scrollHeight;
    updateChatCounters(s);
}

export function renderMasterChatLog(s) {
    const log = getAgentLog();
    const wasAtBottom = state.autoScroll;
    log.innerHTML = '';
    if (state.chatSplit) {
        const viewerLog = document.getElementById('viewer-log');
        if (viewerLog) viewerLog.innerHTML = '';
    }
    state.inventory = {};

    s.events.forEach((evt, idx) => {
        appendChatMessage(log, evt, s, true, idx);
    });

    if (wasAtBottom) log.scrollTop = log.scrollHeight;
    updateChatCounters(s);
}

export function updateChatCounters(s) {
    document.getElementById('event-count').textContent = `${s.events.length}`;
    const filesCount = document.getElementById('files-count');
    if (filesCount) filesCount.textContent = `(${Object.keys(state.inventory).length})`;
    updateAgentCount();
    updateViewerCount();
    renderViewerCount();
    renderFiles();
}

export function renderViewerCount() {
    const count = Object.keys(state.inventory).length;
    document.getElementById('viewer-count').textContent = `\uD83D\uDC41 ${count} viewers`;
}

export function renderDonationGoal() {
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

export function renderMods(s) {
    const panel = document.getElementById('agents-panel');
    panel.innerHTML = Object.values(s.agents).map(a => {
        const total = a.input_tokens + a.output_tokens;
        const tokStr = total > 0 ? fmtTokens(total) : '';
        const badge = a.is_subagent ? '🗡' : '👑';
        const projColor = a.project ? getProjectColor(a.project) : null;
        const nameClass = projColor ? '' : `name-${a.color}`;
        const nameStyle = projColor ? ` style="color:${projColor}"` : '';
        return `<div class="mod-pill">
            <span class="mod-badge">${badge}</span>
            <span class="mod-name ${nameClass}"${nameStyle}>${esc(a.name)}</span>
            ${tokStr ? `<span class="mod-tokens">${tokStr}</span>` : ''}
        </div>`;
    }).join('');
}

export function renderFiles() {
    const panel = document.getElementById('files-panel');
    if (!panel) return;
    const entries = Object.entries(state.inventory);
    const countEl = document.getElementById('files-count');
    if (countEl) countEl.textContent = `(${entries.length})`;
    if (!entries.length) {
        panel.innerHTML = '<div style="color:var(--text-muted);font-size:11px;padding:4px 0">No files yet</div>';
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

export function initFilters() {
    const panel = document.getElementById('filters-panel');
    const EVENT_LABELS = { spawn: 'Spawn', think: 'Think', tool_call: 'Tool', tool_result: 'Result', file_create: 'Create', file_update: 'Edit', file_read: 'Read', bash: 'Bash', web_search: 'Web', text: 'Text', error: 'Error', complete: 'Done', user: 'User' };
    state.filters = {};
    const types = Object.keys(EVENT_LABELS);
    panel.innerHTML = types.map(t => {
        state.filters[t] = true;
        return `<div class="filter-entry">
            <input type="checkbox" id="filter-${t}" checked>
            <label for="filter-${t}">${CHAT_BADGES[t] || '\u00b7'} ${EVENT_LABELS[t]}</label>
        </div>`;
    }).join('');

    types.forEach(t => {
        document.getElementById(`filter-${t}`).addEventListener('change', (e) => {
            state.filters[t] = e.target.checked;
            if (state.session) renderChatLog(state.session);
        });
    });
}

export function isEventVisible(type) { return state.filters[type] !== false; }

// ============================================================
// VIEWER CHAT (LLM + fallback)
// ============================================================

export const VIEWER_NAMES = [
    'viewer_42', 'code_fan99', 'pixel_dev', 'stream_lurker', 'bug_hunter',
    'git_pusher', 'regex_queen', 'null_ptr', 'sudo_user', 'mr_merge',
    'debug_diva', 'pr_approved', 'stack_overflow', 'tab_hoarder', 'vim_exit',
    'semicolon_sam', 'async_anna', 'monorepo_mike', 'lint_error', 'deploy_dan',
    'chmod_777', 'docker_dave', 'type_safe_ty', 'cargo_build', 'pip_install',
    'branch_bob', 'merge_mia', 'refactor_ray', 'test_tina', 'ci_cd_carl',
    'heap_holly', 'mutex_max', 'lambda_liz', 'cache_miss', 'jwt_jenny',
    'yaml_yuri', 'env_var_ed', 'cors_cathy', 'orm_oscar', 'api_key_aki',
];

const VIEWER_MESSAGES_BY_TYPE = {
    file_update: [
        'that edit is clean', 'ship it!', 'LGTM',
        'how many lines was that', 'love the naming', 'that function tho',
        'the abstraction is solid', 'clean commit incoming',
        'watch the cyclomatic complexity', 'extract that into a helper?',
        'nice separation of concerns', 'that return early pattern tho',
        'DRY violation or intentional?', 'single responsibility W',
        'bet that broke something', 'was that a refactor or a feature',
        'diff looks clean from here', 'indent game strong',
        'bold move changing that', 'hope theres a test for that',
    ],
    file_create: [
        'new file just dropped', 'fresh module \uD83D\uDD25', 'the architecture is growing',
        'building out the project structure', 'nice scaffolding',
        'should that be a separate package?', 'good call on the file split',
        'add it to .gitignore?', 'modular design W',
        'the file tree is getting deep', 'clean project layout',
    ],
    bash: [
        'terminal wizard', 'that command tho \uD83E\uDDD9', 'pipe gang',
        'one-liner king', 'just grep it', 'shell scripting arc',
        'the flags on that command', 'thats a lot of output',
        'redirect stderr too', 'add set -e at the top',
        'that pipe chain is elegant', 'curl | jq gang',
        'should probably quote those vars', 'exit code 0 lets go',
        'alias that command', 'xargs would be faster',
        'did that just install something', 'watch out for rm -rf',
    ],
    error: [
        'RIP \uD83D\uDC80', 'F in chat', 'stack trace arc',
        'not the red text \uD83D\uDE2D', 'error handling time', 'classic off by one',
        'the debugger is calling', 'check the stack trace closely',
        'is that a race condition?', 'null reference strikes again',
        'missing import maybe?', 'wrong argument order probably',
        'did the types change upstream?', 'try adding a breakpoint there',
        'seen this before its the config', 'oh no the build broke',
        'revert revert revert', 'have you tried turning it off and on',
    ],
    think: [
        'the thinking phase \uD83E\uDDE0', 'planning arc', 'galaxy brain moment',
        'cooking something up', 'big brain time', 'strategizing',
        'architecture review in progress', 'weighing the tradeoffs',
        'considering the edge cases', 'this is the important part',
        'thats a long think', 'must be a hard one',
        'the plan is forming', 'hope it picks the right approach',
    ],
    tool_call: [
        'tool usage on point', 'using the right tool for the job',
        'that tool call was fast', 'automation ftw',
        'good call reaching for grep first', 'should cache that result',
        'batch those calls maybe?', 'nice API choice',
        'the tooling in this project tho', 'thats a smart integration',
        'how many tools does it have', 'tool-assisted speedrun',
    ],
    complete: [
        'GG \uD83C\uDF89', 'LETS GOOO', 'task complete W',
        'another one done', 'speedrun strats',
        'tests passing?', 'time for code review', 'push it!',
        'merge and ship', 'clean implementation',
        'that was fast', 'commit and move on', 'next task incoming',
    ],
    spawn: [
        'new agent just dropped', 'subagent arc', 'parallel processing moment',
        'deploying reinforcements', 'the squad is growing',
        'divide and conquer approach', 'smart to parallelize that',
        'how many agents now', 'multithreaded coding',
        'the swarm grows', 'agent army assembling',
    ],
    text: [
        'reading the output', 'long response incoming',
        'thats a wall of text', 'TLDR?', 'summarize pls',
        'the explanation is solid', 'good context',
    ],
};

const VIEWER_MESSAGES_GENERIC = [
    'LFG \uD83D\uDD25', 'this is clean', 'nice', 'W', 'Pog',
    'what lang is this?', 'whats the tech stack?', 'can you explain that?',
    'should write a test for that', 'add error handling there',
    'whats the time complexity on that?', 'consider the edge cases',
    'is there a linter running?', 'the naming convention is consistent',
    'wonder what the memory footprint looks like', 'any benchmarks on this?',
    'solid project structure', 'how long has this been going',
    'first time catching the stream', 'this is better than Netflix',
    'learn so much from these streams', 'real ones are watching',
    'the architecture here is interesting', 'what IDE is this',
    'do you use copilot too?', 'this is my favorite stream',
    'watching from work dont tell my boss', 'the vibes are immaculate',
    'how did you learn all this?', 'is this open source?',
    'anyone else taking notes?', 'my brain is expanding',
    'this should be a tutorial', 'the code speaks for itself',
    'how many monitors do you have?', 'clean code clean mind',
    'respect the craft', 'you make it look easy',
    'meanwhile my code doesnt even compile', 'teach me your ways',
    'the productivity is insane', 'ok im inspired to code now',
    'i need to refactor my whole project after this', 'subscribed',
    'dropping knowledge bombs', 'this is peak engineering',
    'anyone else staying up late for this?', 'just got here whats happening',
    'the pacing is perfect', 'cant look away', 'coding ASMR fr',
    'better than any bootcamp', 'my PR would never look this clean',
    'wait go back i missed that', 'are there replays of this?',
    'the focus is unreal', 'no stack overflow needed apparently',
    'built different', 'i aspire to this level', 'chat is learning today',
    'someone clip that', 'how long have you been coding?',
    'the error messages fear this person', 'flawless execution',
    'typing speed is wild', 'smooth operator', 'EZ',
    'this is art', 'poetry in motion', 'brain.exe running at 100%',
    'wish my team coded like this', 'taking mental notes rn',
    'this stream is underrated', 'more people need to see this',
];

function _dynamicFallback(evt) {
    const fpath = evt.short_path || evt.file_path || '';
    const fname = fpath.split('/').pop() || '';
    const proj = evt.project || '';
    const tool = evt.tool_name || '';

    const templates = [];
    if (fname) {
        templates.push(
            `${fname} getting the attention it deserves`,
            `changes to ${fname} look solid`,
            `${fname} is evolving`,
            `that ${fname} edit tho`,
            `wonder how big ${fname} is now`,
            `${fname} diff is gonna be interesting`,
            `${fname} is getting a glow up`,
            `been watching ${fname} change all stream`,
            `how many lines is ${fname} now`,
            `${fname} again? must be important`,
            `the ${fname} saga continues`,
            `${fname} carrying the whole project`,
        );
    }
    if (proj) {
        templates.push(
            `${proj} is coming along`,
            `${proj} getting some love`,
            `whats the status on ${proj}`,
            `${proj} making progress`,
            `${proj} arc is heating up`,
            `love the work on ${proj}`,
            `${proj} looking clean today`,
            `${proj} speedrun any%`,
        );
    }
    if (tool) {
        templates.push(
            `${tool} is the right call here`,
            `using ${tool} smart`,
            `${tool} doing the heavy lifting`,
            `good ol ${tool}`,
        );
    }
    if (templates.length > 0) {
        return templates[Math.floor(Math.random() * templates.length)];
    }
    return null;
}

const _recentFallbacks = [];
const _MAX_RECENT = 30;

// Queue of LLM-generated viewer chat messages
export const viewerChatQueue = [];
export let viewerChatFetching = false;

export function resetViewerChatQueue() {
    viewerChatQueue.length = 0;
    viewerChatFetching = false;
}
let llmFallbackShown = false;
let llmLoadingEl = null;

function showLlmLoadingNotice() {
    if (llmLoadingEl) return;
    const log = getViewerLog();
    if (!log) return;
    llmLoadingEl = document.createElement('div');
    llmLoadingEl.className = 'chat-msg llm-loading-notice';
    llmLoadingEl.innerHTML = `<span class="chat-badge">\uD83E\uDDE0</span>`
        + `<span class="chat-text" style="color:var(--text-dim);font-style:italic">Loading LLM model\u2026 first message may take a moment</span>`;
    log.appendChild(llmLoadingEl);
    if (state.viewerAutoScroll) log.scrollTop = log.scrollHeight;
}

function hideLlmLoadingNotice() {
    if (llmLoadingEl) { llmLoadingEl.remove(); llmLoadingEl = null; }
}

function showLlmFallbackNotice(error) {
    if (llmFallbackShown) return;
    llmFallbackShown = true;
    const log = getViewerLog();
    if (!log) return;
    const div = document.createElement('div');
    div.className = 'chat-msg llm-fallback-notice';
    const short = error.length > 60 ? error.slice(0, 60) + '\u2026' : error;
    div.innerHTML = `<span class="chat-badge">\u26A0\uFE0F</span>`
        + `<span class="chat-text" style="color:var(--text-dim);font-style:italic">`
        + `Chat is using fallback messages (LLM error: ${esc(short)})</span>`;
    log.appendChild(div);
    updateViewerCount();
    if (state.viewerAutoScroll) log.scrollTop = log.scrollHeight;
}

export function _updateModelLabel(label, cfg) {
    if (cfg.provider === 'off') {
        label.textContent = 'off';
    } else if (cfg.provider === 'openai') {
        label.textContent = cfg.openai_model || 'not set';
    } else if (cfg.provider === 'anthropic') {
        label.textContent = cfg.anthropic_model || 'not set';
    } else {
        label.textContent = cfg.ollama_model || 'not set';
    }
    label.title = 'Active LLM: ' + label.textContent;
}

export async function fetchViewerChatBatch() {
    if (viewerChatFetching || !state.sessionFilePath) return;
    viewerChatFetching = true;
    if (viewerChatQueue.length === 0) showLlmLoadingNotice();
    try {
        const bufSize = state.tuning.bufferSize || 10;
        const url = '/api/viewer-chat/' + encodeURIComponent(state.sessionFilePath);
        const results = await Promise.allSettled(
            Array.from({ length: bufSize }, () => fetch(url).then(r => r.ok ? r.json() : null))
        );
        let hadError = false;
        let gotMessages = false;
        for (const r of results) {
            if (r.status !== 'fulfilled' || !r.value) continue;
            const data = r.value;
            if (data.name && data.message) {
                viewerChatQueue.push(data);
                llmFallbackShown = false;
                gotMessages = true;
            } else if (data.llm_error && !hadError) {
                showLlmFallbackNotice(data.llm_error);
                hadError = true;
            }
        }
        if (gotMessages) {
            hideLlmLoadingNotice();
            const label = document.getElementById('llm-model-label');
            if (label && label.textContent === 'loading...') {
                fetch('/api/settings').then(r => r.json()).then(c => _updateModelLabel(label, c)).catch(() => {});
            }
        }
        if (hadError) hideLlmLoadingNotice();
    } catch (e) {
        hideLlmLoadingNotice();
        showLlmFallbackNotice(e.message || 'Network error');
    }
    viewerChatFetching = false;
}

function addViewerChatMessage() {
    const log = getViewerLog();
    if (!log) return;

    if (Math.random() < (state.tuning.tipChance || 15) / 100) {
        addRandomViewerTip();
        return;
    }

    let name, msg;

    if (viewerChatQueue.length > 0) {
        const item = viewerChatQueue.shift();
        name = item.name;
        msg = item.message;
        if (viewerChatQueue.length <= Math.floor((state.tuning.bufferSize || 10) / 2)) fetchViewerChatBatch();
    } else {
        name = VIEWER_NAMES[Math.floor(Math.random() * VIEWER_NAMES.length)];
        const evts = state.session && state.session.events;
        const recentIdx = evts ? Math.max(0, evts.length - 10) + Math.floor(Math.random() * Math.min(10, evts.length)) : -1;
        const recent = recentIdx >= 0 ? evts[recentIdx] : null;

        if (recent && Math.random() < 0.5) {
            msg = _dynamicFallback(recent);
        }
        if (!msg) {
            let pool = VIEWER_MESSAGES_GENERIC;
            if (recent) {
                const typed = VIEWER_MESSAGES_BY_TYPE[recent.type];
                if (typed && Math.random() < 0.7) pool = typed;
            }
            msg = pool[Math.floor(Math.random() * pool.length)];
        }
        if (_recentFallbacks.includes(msg)) {
            const allPools = [...VIEWER_MESSAGES_GENERIC];
            if (recent) {
                const typed = VIEWER_MESSAGES_BY_TYPE[recent.type];
                if (typed) allPools.push(...typed);
            }
            for (let attempt = 0; attempt < 5; attempt++) {
                const candidate = allPools[Math.floor(Math.random() * allPools.length)];
                if (!_recentFallbacks.includes(candidate)) { msg = candidate; break; }
            }
        }
        _recentFallbacks.push(msg);
        if (_recentFallbacks.length > _MAX_RECENT) _recentFallbacks.shift();
        if (!viewerChatFetching) fetchViewerChatBatch();
    }

    const colors = ['#9146ff', '#00b4d8', '#f0c674', '#00e676', '#ff6b6b', '#81d4fa', '#e74c3c', '#8abeb7'];
    const color = colors[Math.floor(Math.random() * colors.length)];

    const div = document.createElement('div');
    div.className = 'chat-msg viewer-chat';
    div.innerHTML = `<span class="chat-badge">\uD83D\uDCAC</span>`
        + `<span class="chat-name" style="color:${color}">${esc(name)}</span>`
        + `<span class="chat-text">${esc(msg)}</span>`;
    log.appendChild(div);
    capChatDom(log);
    updateViewerCount();

    if (state.viewerAutoScroll) log.scrollTop = log.scrollHeight;
}

function addRandomViewerTip() {
    const log = getViewerLog();
    const amounts = [100, 100, 100, 250, 500, 500, 1000, 2500];
    const amount = amounts[Math.floor(Math.random() * amounts.length)];
    const name = VIEWER_NAMES[Math.floor(Math.random() * VIEWER_NAMES.length)];
    const tipMessages = [
        'Keep it up!', 'For the coffee fund \u2615', 'Love the stream!',
        'Ship it! \uD83D\uDE80', 'You earned this', 'Bug free zone \uD83D\uDC1B',
        '\uD83D\uDC9C', 'More pixels pls', 'Coding ASMR \uD83C\uDFA7',
    ];
    const msg = tipMessages[Math.floor(Math.random() * tipMessages.length)];

    state.tips += amount;
    if (state.sessionFilePath) persistTips(state.sessionFilePath);
    renderDonationGoal();
    triggerReaction('complete');

    const div = document.createElement('div');
    div.className = 'chat-msg is-tip';
    div.innerHTML = `<span class="chat-badge">\uD83D\uDC8E</span>`
        + `<span class="chat-name" style="color:var(--tip-blue)">${esc(name)}</span>`
        + `<span class="tip-amount">${fmtTokens(amount)} tokens</span> `
        + `<span class="chat-text">${esc(msg)}</span>`;
    log.appendChild(div);
    capChatDom(log);
    updateViewerCount();
    if (state.viewerAutoScroll) log.scrollTop = log.scrollHeight;

    setTimeout(() => {
        const streamerName = state.session
            ? (Object.values(state.session.agents)[0]?.name || 'Claude')
            : 'Claude';
        const reactions = amount >= 2500
            ? ['OMG thank you!! \uD83D\uDE2D', 'HUGE!! You\'re amazing!', 'No way!! \uD83D\uDE4F']
            : ['Thanks! \uD83D\uDC9C', 'Appreciate it! \u2764\uFE0F', 'Ty! \uD83C\uDF89', 'Ayy thanks! \uD83D\uDD25'];
        const reaction = reactions[Math.floor(Math.random() * reactions.length)];
        const replyDiv = document.createElement('div');
        replyDiv.className = 'chat-msg is-streamer-reply';
        replyDiv.innerHTML = `<span class="chat-badge">\uD83D\uDC35</span>`
            + `<span class="chat-name" style="color:var(--purple)">${esc(streamerName)}</span>`
            + `<span class="chat-text">${esc(reaction)}</span>`;
        log.appendChild(replyDiv);
        capChatDom(log);
        updateViewerCount();
        if (state.viewerAutoScroll) log.scrollTop = log.scrollHeight;
    }, 800 + Math.random() * 1200);
}

const REACTION_FALLBACKS = [
    'good question', 'I was wondering the same', 'real', 'chat is alive today',
    '^^^ this', 'true', 'lol same', 'fr fr', 'big facts', '+1',
];

export function reactToUserChat(userMessage) {
    if (Math.random() > (state.tuning.reactionChance || 50) / 100) return;

    const log = getViewerLog();
    if (!log) return;

    const colors = ['#9146ff', '#00b4d8', '#f0c674', '#00e676', '#ff6b6b', '#81d4fa', '#e74c3c', '#8abeb7'];
    const delay = 1500 + Math.random() * 3000;

    if (state.llmEnabled) {
        fetch('/api/viewer-react', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ message: userMessage }),
        }).then(r => r.json()).then(data => {
            (data.reactions || []).forEach((r, i) => {
                setTimeout(() => {
                    const color = colors[Math.floor(Math.random() * colors.length)];
                    const div = document.createElement('div');
                    div.className = 'chat-msg viewer-chat';
                    div.innerHTML = `<span class="chat-badge">\uD83D\uDCAC</span>`
                        + `<span class="chat-name" style="color:${color}">${esc(r.name)}</span>`
                        + `<span class="chat-text">${esc(r.message)}</span>`;
                    log.appendChild(div);
                    capChatDom(log);
                    updateViewerCount();
                    if (state.viewerAutoScroll) log.scrollTop = log.scrollHeight;
                }, delay + i * 1500);
            });
        }).catch(() => {});
    } else {
        setTimeout(() => {
            const name = VIEWER_NAMES[Math.floor(Math.random() * VIEWER_NAMES.length)];
            const msg = REACTION_FALLBACKS[Math.floor(Math.random() * REACTION_FALLBACKS.length)];
            const color = colors[Math.floor(Math.random() * colors.length)];
            const div = document.createElement('div');
            div.className = 'chat-msg viewer-chat';
            div.innerHTML = `<span class="chat-badge">\uD83D\uDCAC</span>`
                + `<span class="chat-name" style="color:${color}">${esc(name)}</span>`
                + `<span class="chat-text">${esc(msg)}</span>`;
            log.appendChild(div);
            capChatDom(log);
            updateViewerCount();
            if (state.viewerAutoScroll) log.scrollTop = log.scrollHeight;
        }, delay);
    }
}

// ============================================================
// VIEWER CHAT TIMER
// ============================================================

export function startViewerChat() {
    stopViewerChat();
    const ready = state.llmEnabled ? fetchViewerChatBatch() : Promise.resolve();
    function scheduleNext() {
        const isMaster = state.view === 'master';
        const speed = isMaster ? 'fast' : (state.tuning.chatSpeed || 'normal');
        const delay = speed === 'fast' ? (1000 + Math.random() * 2000)
            : speed === 'slow' ? (5000 + Math.random() * 10000)
            : (3000 + Math.random() * 7000);
        state.viewerChatTimer = setTimeout(() => {
            addViewerChatMessage();
            scheduleNext();
        }, delay);
    }
    ready.then(() => scheduleNext());
    if (state.llmEnabled) startNarratorChat();
}

export function stopViewerChat() {
    if (state.viewerChatTimer) {
        clearTimeout(state.viewerChatTimer);
        state.viewerChatTimer = null;
    }
    stopNarratorChat();
}

// ============================================================
// NARRATOR BOT
// ============================================================

export function startNarratorChat() {
    stopNarratorChat();
    if (!state.llmEnabled) return;
    function scheduleNext() {
        const center = (state.tuning.narratorFreq || 20) * 1000;
        const delay = center * 0.6 + Math.random() * center * 0.8;
        state.narratorChatTimer = setTimeout(() => {
            if (!state.llmEnabled) { stopNarratorChat(); return; }
            addNarratorMessage();
            scheduleNext();
        }, delay);
    }
    scheduleNext();
}

export function stopNarratorChat() {
    if (state.narratorChatTimer) {
        clearTimeout(state.narratorChatTimer);
        state.narratorChatTimer = null;
    }
}

async function addNarratorMessage() {
    const log = getViewerLog();
    if (!log || !state.sessionFilePath) return;

    try {
        const resp = await fetch('/api/narrator/' + encodeURIComponent(state.sessionFilePath));
        if (!resp.ok) return;
        const data = await resp.json();
        if (!data.message) return;

        const div = document.createElement('div');
        div.className = 'chat-msg narrator-chat';
        div.innerHTML = `<span class="chat-badge">\uD83C\uDFA4</span>`
            + `<span class="chat-name" style="color:var(--gold)">caster_bot</span>`
            + `<span class="chat-text">${esc(data.message)}</span>`;
        log.appendChild(div);
        capChatDom(log);
        updateViewerCount();
        if (state.viewerAutoScroll) log.scrollTop = log.scrollHeight;
    } catch (e) {
        // narrator unavailable, skip silently
    }
}

// ============================================================
// TIP HANDLING (chat-initiated)
// ============================================================

export function addTipToChat(amount) {
    const log = getViewerLog();
    const names = ['viewer_42', 'code_fan99', 'pixel_dev', 'stream_lurker', 'bug_hunter',
                   'git_pusher', 'regex_queen', 'null_ptr', 'sudo_user', 'mr_merge'];
    const name = names[Math.floor(Math.random() * names.length)];
    const messages = [
        'Keep coding! \uD83D\uDD25', 'Amazing stream!', 'Fix that bug! \uD83D\uDC1B',
        'Ship it! \uD83D\uDE80', 'Clean code! \u2728', 'LFG!! \uD83D\uDCAA',
        'GOAT coder \uD83D\uDC10', 'Take my tokens!', 'Huge fan! \uD83C\uDF89',
    ];
    const msg = messages[Math.floor(Math.random() * messages.length)];

    const div = document.createElement('div');
    div.className = 'chat-msg is-tip';
    div.innerHTML = `<span class="chat-badge">\uD83D\uDC8E</span>`
        + `<span class="chat-name" style="color:var(--tip-blue)">${esc(name)}</span>`
        + `<span class="tip-amount">${fmtTokens(amount)} tokens</span> `
        + `<span class="chat-text">${esc(msg)}</span>`;
    log.appendChild(div);
    capChatDom(log);
    updateViewerCount();

    setTimeout(() => {
        const streamerName = state.session
            ? (Object.values(state.session.agents)[0]?.name || 'Claude')
            : 'Claude';
        const reactions = amount >= 2500
            ? ['OMG thank you so much!! \uD83D\uDE2D', 'HUGE tip! You are incredible!', 'No way!! Thank you!! \uD83D\uDE4F',
               'I literally can\'t right now \uD83D\uDE2D\uD83D\uDC9C', 'GOAT viewer right here!!!']
            : ['Thanks for the tip! \uD83D\uDC9C', 'Appreciate it! \u2764\uFE0F', 'You\'re awesome, ty!',
               'Ayy thanks! \uD83C\uDF89', 'Let\'s gooo, ty! \uD83D\uDD25', 'Much love! \uD83D\uDC9C'];
        const reaction = reactions[Math.floor(Math.random() * reactions.length)];
        const replyDiv = document.createElement('div');
        replyDiv.className = 'chat-msg is-streamer-reply';
        replyDiv.innerHTML = `<span class="chat-badge">\uD83D\uDC35</span>`
            + `<span class="chat-name" style="color:var(--purple)">${esc(streamerName)}</span>`
            + `<span class="chat-text">${esc(reaction)}</span>`;
        log.appendChild(replyDiv);
        capChatDom(log);
        updateViewerCount();
        if (state.viewerAutoScroll) log.scrollTop = log.scrollHeight;
    }, 800 + Math.random() * 1200);

    if (state.viewerAutoScroll) log.scrollTop = log.scrollHeight;
}

// ============================================================
// PERSISTENCE HELPERS
// ============================================================

function getTipKey(filePath) { return 'agenttv_tips_' + hashCode(filePath); }
function getLikeKey(filePath) { return 'agenttv_likes_' + hashCode(filePath); }
function getFollowKey(filePath) { return 'agenttv_follow_' + hashCode(filePath); }

export function loadPersistedState(filePath) {
    try {
        state.tips = parseInt(localStorage.getItem(getTipKey(filePath)) || '0');
        state.likes = parseInt(localStorage.getItem(getLikeKey(filePath)) || '0');
        state.following = localStorage.getItem(getFollowKey(filePath)) === '1';
    } catch (e) { /* localStorage unavailable */ }
}

export function persistTips(filePath) {
    try { localStorage.setItem(getTipKey(filePath), String(state.tips)); } catch (e) {}
}
export function persistLikes(filePath) {
    try { localStorage.setItem(getLikeKey(filePath), String(state.likes)); } catch (e) {}
}
export function persistFollow(filePath) {
    try { localStorage.setItem(getFollowKey(filePath), state.following ? '1' : '0'); } catch (e) {}
}

// ============================================================
// VIEWER NAME
// ============================================================

export function getViewerName() {
    try { return localStorage.getItem('agenttv_viewer_name') || 'you'; } catch { return 'you'; }
}

export function setViewerName(name) {
    try { localStorage.setItem('agenttv_viewer_name', name || 'you'); } catch {}
}

// ============================================================
// EXPORT CHAT LOG
// ============================================================

export function exportChatLog() {
    const s = state.session;
    if (!s || !s.events || !s.events.length) return;

    const lines = [];
    lines.push(`AgentsTV Chat Export — ${s.slug || 'Session'}`);
    lines.push(`Project: ${s.project_name || 'Unknown'}`);
    lines.push(`Exported: ${new Date().toISOString()}`);
    lines.push('---');
    for (const evt of s.events) {
        if (!isEventVisible(evt.type)) continue;
        const agent = s.agents[evt.agent_id];
        const name = agent ? agent.name : evt.agent_id;
        const text = buildChatText(evt);
        const ts = evt.timestamp ? new Date(evt.timestamp * 1000).toLocaleTimeString() : '';
        lines.push(`[${ts}] ${name}: ${text}`);
    }

    const blob = new Blob([lines.join('\n')], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `agentstv-chat-${(s.slug || 'session').replace(/[^a-z0-9]/gi, '-')}.txt`;
    a.click();
    URL.revokeObjectURL(url);
}

// ============================================================
// INTERACTIVE CHAT INPUT
// ============================================================

export function setReplyToEvent(index, summary) {
    state.replyToEventIndex = index;
    const preview = document.getElementById('chat-reply-preview');
    const text = document.getElementById('chat-reply-text');
    if (preview && text) {
        text.textContent = summary || `Event #${index}`;
        preview.style.display = 'flex';
    }
    const input = document.getElementById('chat-input');
    if (input && !input.disabled) input.focus();
}

export function initChatInput() {
    const input = document.getElementById('chat-input');
    const sendBtn = document.getElementById('chat-send-btn');
    const replyPreview = document.getElementById('chat-reply-preview');
    const replyCancel = document.getElementById('chat-reply-cancel');

    if (!input || !sendBtn) return;

    async function sendMessage() {
        const msg = input.value.trim();
        if (!msg || !state.llmEnabled || sendBtn.disabled) return;

        const log = getViewerLog();
        input.value = '';
        sendBtn.disabled = true;

        const userDiv = document.createElement('div');
        userDiv.className = 'chat-msg user-chat';
        const viewerName = getViewerName();
        userDiv.innerHTML = `<span class="chat-badge">\uD83D\uDCAC</span>`
            + `<span class="chat-name" style="color:var(--purple-light)">${esc(viewerName)}</span>`
            + `<span class="chat-text">${esc(msg)}</span>`;
        log.appendChild(userDiv);
        capChatDom(log);
        updateViewerCount();

        input.placeholder = 'thinking...';
        input.classList.add('thinking');
        if (state.viewerAutoScroll) log.scrollTop = log.scrollHeight;

        const body = {
            message: msg,
            session_id: state.sessionFilePath || '',
        };
        if (state.replyToEventIndex !== null) {
            body.reply_to_event_index = state.replyToEventIndex;
        }

        try {
            const resp = await fetch('/api/chat', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(body),
            });
            const data = await resp.json();

            const replyDiv = document.createElement('div');
            replyDiv.className = 'chat-msg llm-reply';
            if (data.reply) {
                replyDiv.innerHTML = `<span class="chat-badge">&#x1F9E0;</span>`
                    + `<span class="chat-name" style="color:var(--green)">codemonkey_mod</span>`
                    + `<span class="chat-text">${esc(data.reply)}</span>`;
            } else {
                replyDiv.innerHTML = `<span class="chat-badge">&#x1F9E0;</span>`
                    + `<span class="chat-name" style="color:var(--green)">codemonkey_mod</span>`
                    + `<span class="chat-text" style="color:var(--text-muted)">${esc(data.error || 'No response')}</span>`;
            }
            log.appendChild(replyDiv);
            capChatDom(log);
            updateViewerCount();
            reactToUserChat(msg);
        } catch (e) {
            const errDiv = document.createElement('div');
            errDiv.className = 'chat-msg llm-reply';
            errDiv.innerHTML = `<span class="chat-badge">&#x1F9E0;</span>`
                + `<span class="chat-name" style="color:var(--green)">codemonkey_mod</span>`
                + `<span class="chat-text" style="color:var(--red-soft)">Failed to reach LLM</span>`;
            log.appendChild(errDiv);
            capChatDom(log);
            updateViewerCount();
        } finally {
            state.replyToEventIndex = null;
            if (replyPreview) replyPreview.style.display = 'none';
            input.placeholder = 'Ask about this stream...';
            input.classList.remove('thinking');
            sendBtn.disabled = false;
            input.focus();
            if (state.viewerAutoScroll) log.scrollTop = log.scrollHeight;
        }
    }

    sendBtn.addEventListener('click', sendMessage);
    input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            sendMessage();
        }
    });

    if (replyCancel) {
        replyCancel.addEventListener('click', () => {
            state.replyToEventIndex = null;
            replyPreview.style.display = 'none';
        });
    }
}

// ============================================================
// COUNT HELPERS
// ============================================================

export function updateViewerCount() {
    const el = document.getElementById('viewer-chat-count');
    if (!el) return;
    const log = document.getElementById('viewer-log');
    if (log) el.textContent = `(${log.children.length})`;
}

export function updateAgentCount() {
    const el = document.getElementById('agent-log-count');
    if (!el) return;
    const log = document.getElementById('event-log');
    if (log) el.textContent = `(${log.querySelectorAll('.chat-msg').length})`;
}

// ============================================================
// DIVIDER DRAG & SCROLL
// ============================================================

export function setupDividerDrag() {
    const divider = document.querySelector('.chat-pane-divider');
    if (!divider) return;
    const viewerPane = divider.previousElementSibling;
    const agentPane = divider.nextElementSibling;
    if (!viewerPane || !agentPane) return;

    let startY, startViewerFlex, startAgentFlex;

    divider.addEventListener('mousedown', (e) => {
        e.preventDefault();
        startY = e.clientY;
        const container = divider.parentElement;
        const totalHeight = container.clientHeight - divider.offsetHeight;
        startViewerFlex = viewerPane.offsetHeight / totalHeight;
        startAgentFlex = agentPane.offsetHeight / totalHeight;

        function onMouseMove(e) {
            const delta = e.clientY - startY;
            const totalHeight = divider.parentElement.clientHeight - divider.offsetHeight;
            const deltaFrac = delta / totalHeight;
            let newViewer = startViewerFlex + deltaFrac;
            let newAgent = startAgentFlex - deltaFrac;
            if (newViewer < 0.1) { newViewer = 0.1; newAgent = 0.9; }
            if (newAgent < 0.1) { newAgent = 0.1; newViewer = 0.9; }
            viewerPane.style.flex = newViewer.toString();
            agentPane.style.flex = newAgent.toString();
        }

        function onMouseUp() {
            document.removeEventListener('mousemove', onMouseMove);
            document.removeEventListener('mouseup', onMouseUp);
        }

        document.addEventListener('mousemove', onMouseMove);
        document.addEventListener('mouseup', onMouseUp);
    });
}

export function setupScrollListener() {
    const chatLog = document.getElementById('chat-log');
    const eventLog = document.getElementById('event-log');
    const viewerLog = document.getElementById('viewer-log');
    const scrollBtn = document.getElementById('scroll-bottom-btn');

    function onScroll(el) {
        const atBottom = el.scrollTop + el.clientHeight >= el.scrollHeight - 30;
        if (!state.chatSplit && el === chatLog) {
            state.autoScroll = atBottom;
            state.viewerAutoScroll = atBottom;
        } else if (state.chatSplit && el === eventLog) {
            state.autoScroll = atBottom;
        } else if (state.chatSplit && el === viewerLog) {
            state.viewerAutoScroll = atBottom;
            return;
        } else {
            return;
        }
        if (state.autoScroll) {
            const badge = document.getElementById('new-events-badge');
            if (badge) badge.style.display = 'none';
            if (scrollBtn) scrollBtn.style.display = 'none';
        } else {
            if (scrollBtn) scrollBtn.style.display = 'block';
        }
    }

    if (chatLog && !chatLog.dataset.scrollBound) {
        chatLog.dataset.scrollBound = '1';
        chatLog.addEventListener('scroll', () => onScroll(chatLog), { passive: true });
    }
    if (eventLog && !eventLog.dataset.scrollBound) {
        eventLog.dataset.scrollBound = '1';
        eventLog.addEventListener('scroll', () => onScroll(eventLog), { passive: true });
    }
    if (viewerLog && !viewerLog.dataset.scrollBound) {
        viewerLog.dataset.scrollBound = '1';
        viewerLog.addEventListener('scroll', () => onScroll(viewerLog), { passive: true });
    }

    if (scrollBtn) {
        scrollBtn.onclick = () => {
            const target = state.chatSplit ? eventLog : chatLog;
            if (target) target.scrollTop = target.scrollHeight;
            state.autoScroll = true;
            scrollBtn.style.display = 'none';
        };
    }

    if (state.chatSplit) setupDividerDrag();
}

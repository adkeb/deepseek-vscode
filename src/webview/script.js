(function () {
    const vscode = acquireVsCodeApi();
    const messagesEl = document.getElementById('messages');
    const activityListEl = document.getElementById('activityList');
    const inputEl = document.getElementById('input');
    const sendBtn = document.getElementById('sendBtn');
    const thinkBtn = document.getElementById('thinkBtn');
    const searchBtn = document.getElementById('searchBtn');
    const statusLabel = document.getElementById('statusLabel');
    const statusDot = document.getElementById('statusDot');
    const portLabel = document.getElementById('portLabel');
    const composerStatus = document.getElementById('composerStatus');
    const clearBtn = document.getElementById('clearBtn');
    const activityCountEl = document.getElementById('activityCount');

    const state = {
        connected: false,
        backendPort: 8765,
        thinkingEnabled: false,
        searchEnabled: false,
        messages: [],
        activities: [],
        stream: {
            thinkingHtml: '',
            responseHtml: '',
            active: false,
        },
        sequence: 0,
    };

    function nextId(prefix) {
        state.sequence += 1;
        return `${prefix}-${state.sequence}`;
    }

    function renderAll() {
        renderHeader();
        renderMessages();
        renderActivities();
    }

    function renderHeader() {
        statusLabel.textContent = state.connected ? '已连接' : '未连接';
        statusDot.classList.toggle('status-chip__dot--connected', state.connected);
        portLabel.textContent = `ws://127.0.0.1:${state.backendPort}`;
        composerStatus.textContent = state.connected ? '已连接到本地桥' : '等待连接';
        sendBtn.disabled = !state.connected;
        thinkBtn.classList.toggle('mode-button--active', state.thinkingEnabled);
        searchBtn.classList.toggle('mode-button--active', state.searchEnabled);
    }

    function renderMessages() {
        const fragments = [];

        for (const message of state.messages) {
            fragments.push(renderMessage(message));
        }

        if (state.stream.active && (state.stream.thinkingHtml || state.stream.responseHtml)) {
            fragments.push(renderAssistantStream());
        }

        messagesEl.innerHTML = fragments.join('');
        messagesEl.scrollTop = messagesEl.scrollHeight;
    }

    function renderActivities() {
        activityCountEl.textContent = String(state.activities.length);
        if (state.activities.length === 0) {
            activityListEl.innerHTML = '<div class="empty-state">暂时没有工具活动。</div>';
            return;
        }

        const html = state.activities
            .slice()
            .reverse()
            .map(activity => renderActivityCard(activity, true))
            .join('');
        activityListEl.innerHTML = html;
    }

    function renderMessage(message) {
        if (message.role === 'user') {
            return `
                <article class="message message--user">
                    <div class="message__label">你</div>
                    <div class="message__bubble"><pre>${escapeHtml(message.text)}</pre></div>
                </article>
            `;
        }

        if (message.role === 'assistant') {
            const thinkingBlock = message.thinkingHtml
                ? `
                    <details class="thinking-card">
                        <summary>思考过程</summary>
                        <div class="markdown-body">${message.thinkingHtml}</div>
                    </details>
                `
                : '';
            const responseBlock = message.responseHtml
                ? `<div class="markdown-body">${message.responseHtml}</div>`
                : '<div class="assistant-placeholder">AI 已触发工具调用。</div>';
            return `
                <article class="message message--assistant">
                    <div class="message__label">AI</div>
                    <div class="message__bubble">
                        ${thinkingBlock}
                        ${responseBlock}
                    </div>
                </article>
            `;
        }

        if (message.role === 'system') {
            return `
                <article class="message message--system">
                    <div class="system-note system-note--${message.level}">
                        ${escapeHtml(message.text)}
                    </div>
                </article>
            `;
        }

        if (message.role === 'tool') {
            return `
                <article class="message message--tool">
                    <div class="message__label">工具</div>
                    <div class="message__bubble">
                        ${renderActivityCard(message.activity, false)}
                    </div>
                </article>
            `;
        }

        return '';
    }

    function renderAssistantStream() {
        const thinkingBlock = state.stream.thinkingHtml
            ? `
                <details class="thinking-card" open>
                    <summary>思考过程</summary>
                    <div class="markdown-body">${state.stream.thinkingHtml}</div>
                </details>
            `
            : '';
        const responseBlock = state.stream.responseHtml
            ? `<div class="markdown-body">${state.stream.responseHtml}</div>`
            : '<div class="assistant-placeholder">等待 AI 输出…</div>';

        return `
            <article class="message message--assistant message--streaming">
                <div class="message__label">AI 输出中</div>
                <div class="message__bubble">
                    ${thinkingBlock}
                    ${responseBlock}
                </div>
            </article>
        `;
    }

    function renderActivityCard(activity, compact) {
        const statusClass = activity.status || 'running';
        const requestPayload = activity.requestPayload !== undefined
            ? `<pre class="tool-card__payload">${escapeHtml(JSON.stringify(activity.requestPayload, null, 2))}</pre>`
            : '';
        const resultPayload = activity.result !== undefined
            ? `<pre class="tool-card__payload">${escapeHtml(JSON.stringify(activity.result, null, 2))}</pre>`
            : '';
        const errorBlock = activity.error
            ? `<div class="tool-card__error">${escapeHtml(activity.error)}</div>`
            : '';
        const summaryBlock = compact && activity.summaryStats
            ? `
                <div class="tool-card__summary">
                    <span>总计 ${activity.summaryStats.total}</span>
                    <span>成功 ${activity.summaryStats.succeeded}</span>
                    <span>失败 ${activity.summaryStats.failed}</span>
                </div>
            `
            : '';
        const batchItems = Array.isArray(activity.results)
            ? `
                <div class="tool-card__list">
                    ${activity.results.map((result, index) => `
                        <div class="tool-card__list-item">
                            <span>${index + 1}. ${escapeHtml(result.name)}</span>
                            <span class="tool-card__list-status tool-card__list-status--${result.success ? 'ok' : 'error'}">
                                ${result.success ? '成功' : result.confirmationState === 'rejected' ? '已拒绝' : '失败'}
                            </span>
                        </div>
                    `).join('')}
                </div>
            `
            : '';
        const confirmation = activity.confirmationState
            ? `<div class="tool-card__meta">确认状态: ${escapeHtml(activity.confirmationState)}</div>`
            : '';

        return `
            <section class="tool-card tool-card--${statusClass}">
                <div class="tool-card__header">
                    <div>
                        <div class="tool-card__eyebrow">${escapeHtml(activity.kind)}</div>
                        <div class="tool-card__title">${escapeHtml(activity.title)}</div>
                    </div>
                    <div class="tool-card__status">${escapeHtml(activity.status)}</div>
                </div>
                <div class="tool-card__summary-text">${escapeHtml(activity.summary)}</div>
                ${confirmation}
                ${summaryBlock}
                ${batchItems}
                ${errorBlock}
                ${requestPayload}
                ${resultPayload}
            </section>
        `;
    }

    function pushMessage(message) {
        state.messages.push(message);
        renderMessages();
    }

    function upsertActivity(activity) {
        const index = state.activities.findIndex(item => item.id === activity.id);
        if (index === -1) {
            state.activities.push(activity);
        } else {
            state.activities[index] = activity;
        }

        const toolMessageId = `tool-message:${activity.id}`;
        const messageIndex = state.messages.findIndex(item => item.id === toolMessageId);
        const message = {
            id: toolMessageId,
            role: 'tool',
            activity,
        };
        if (messageIndex === -1) {
            state.messages.push(message);
        } else {
            state.messages[messageIndex] = message;
        }

        renderAll();
    }

    function clearLocalConversation() {
        state.messages = [];
        state.activities = [];
        state.stream = {
            thinkingHtml: '',
            responseHtml: '',
            active: false,
        };
        renderAll();
    }

    function escapeHtml(value) {
        return String(value)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#039;');
    }

    function sendCurrentMessage() {
        const text = inputEl.value.trim();
        if (!text || !state.connected) {
            return;
        }

        pushMessage({
            id: nextId('user'),
            role: 'user',
            text,
        });
        vscode.postMessage({
            command: 'sendMessage',
            text,
        });
        inputEl.value = '';
        inputEl.focus();
    }

    window.addEventListener('message', (event) => {
        const message = event.data;
        switch (message.type) {
            case 'initialize':
                state.connected = Boolean(message.connectionState.connected);
                state.backendPort = message.backendPort || 8765;
                state.thinkingEnabled = Boolean(message.modeState.thinkingEnabled);
                state.searchEnabled = Boolean(message.modeState.searchEnabled);
                renderAll();
                break;
            case 'connectionState':
                state.connected = Boolean(message.connected);
                state.backendPort = message.port || state.backendPort;
                renderHeader();
                break;
            case 'modeState':
                state.thinkingEnabled = Boolean(message.thinkingEnabled);
                state.searchEnabled = Boolean(message.searchEnabled);
                renderHeader();
                break;
            case 'assistantStream':
                state.stream.active = true;
                state.stream.thinkingHtml = message.thinkingHtml || '';
                state.stream.responseHtml = message.responseHtml || '';
                renderMessages();
                break;
            case 'assistantFinal':
                state.stream.active = false;
                state.stream.thinkingHtml = '';
                state.stream.responseHtml = '';
                if (message.thinkingHtml || message.responseHtml) {
                    state.messages.push({
                        id: nextId('assistant'),
                        role: 'assistant',
                        thinkingHtml: message.thinkingHtml || '',
                        responseHtml: message.responseHtml || '',
                    });
                }
                renderMessages();
                break;
            case 'systemNotice':
                pushMessage({
                    id: nextId('system'),
                    role: 'system',
                    level: message.level || 'info',
                    text: message.text || '',
                });
                break;
            case 'toolActivity':
                upsertActivity(message.activity);
                break;
            case 'conversationCleared':
                clearLocalConversation();
                break;
            default:
                break;
        }
    });

    sendBtn.addEventListener('click', sendCurrentMessage);
    inputEl.addEventListener('keydown', (event) => {
        if (event.key === 'Enter' && !event.shiftKey) {
            event.preventDefault();
            sendCurrentMessage();
        }
    });

    thinkBtn.addEventListener('click', () => {
        const next = !state.thinkingEnabled;
        vscode.postMessage({
            command: 'toggleThinking',
            state: next,
        });
    });

    searchBtn.addEventListener('click', () => {
        const next = !state.searchEnabled;
        vscode.postMessage({
            command: 'toggleSearch',
            state: next,
        });
    });

    clearBtn.addEventListener('click', () => {
        vscode.postMessage({ command: 'clearConversation' });
    });

    messagesEl.addEventListener('click', (event) => {
        const button = event.target.closest('.code-copy-button');
        if (!button) {
            return;
        }
        const shell = button.closest('.code-shell');
        const code = shell?.querySelector('code');
        if (!code) {
            return;
        }
        navigator.clipboard.writeText(code.innerText).then(() => {
            const original = button.textContent;
            button.textContent = '已复制';
            setTimeout(() => {
                button.textContent = original;
            }, 1200);
        }).catch(() => {
            button.textContent = '复制失败';
            setTimeout(() => {
                button.textContent = '复制';
            }, 1200);
        });
    });

    vscode.postMessage({ command: 'ready' });
})();

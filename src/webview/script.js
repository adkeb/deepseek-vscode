/* global marked hljs */
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
        sequence: 0,
        autoFollow: true,
        pendingThinking: '',
        pendingResponse: '',
    };
    const stream = {
        container: null,
        thinkingContainer: null,
        responseContainer: null,
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
        thinkBtn.setAttribute('aria-pressed', String(state.thinkingEnabled));
        searchBtn.setAttribute('aria-pressed', String(state.searchEnabled));
        thinkBtn.title = state.thinkingEnabled ? '深度思考：已开启' : '深度思考：已关闭';
        searchBtn.title = state.searchEnabled ? '智能搜索：已开启' : '智能搜索：已关闭';
    }

    function renderMessages() {
        const shouldStickToBottom = state.autoFollow;
        const previousScrollTop = messagesEl.scrollTop;
        const fragments = [];

        for (const message of state.messages) {
            fragments.push(renderMessage(message));
        }

        messagesEl.innerHTML = fragments.join('');
        if (stream.container) {
            messagesEl.appendChild(stream.container);
        }
        if (shouldStickToBottom) {
            scrollMessagesToBottom();
        } else {
            // 按比例恢复滚动位置
            const newScrollHeight = messagesEl.scrollHeight;
            if (previousScrollPosition.scrollHeight > 0) {
                messagesEl.scrollTop = (previousScrollPosition.scrollTop / previousScrollPosition.scrollHeight) * newScrollHeight;
            }
        }
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
        resetStream();
        renderAll();
    }

    function ensureStreamElements() {
        if (stream.container) {
            return;
        }

        const container = document.createElement('article');
        container.className = 'message message--assistant message--streaming';

        const label = document.createElement('div');
        label.className = 'message__label';
        label.textContent = 'AI 输出中';

        const bubble = document.createElement('div');
        bubble.className = 'message__bubble';

        // 思考内容容器
        const thinkingContainer = document.createElement('div');
        thinkingContainer.className = 'markdown-body thinking-content';
        thinkingContainer.hidden = true;

        // 回复内容容器
        const responseContainer = document.createElement('div');
        responseContainer.className = 'markdown-body response-content';

        bubble.appendChild(thinkingContainer);
        bubble.appendChild(responseContainer);
        container.appendChild(label);
        container.appendChild(bubble);

        stream.container = container;
        stream.thinkingContainer = thinkingContainer;
        stream.responseContainer = responseContainer;
        messagesEl.appendChild(container);
    }

    function updateStreamContent() {
        ensureStreamElements();
        if (state.pendingThinking) {
            stream.thinkingContainer.hidden = false;
            stream.thinkingContainer.innerHTML = renderMarkdown(state.pendingThinking);
        }
        if (state.pendingResponse) {
            stream.responseContainer.innerHTML = renderMarkdown(state.pendingResponse);
        }
        if (state.autoFollow) {
            requestAnimationFrame(scrollMessagesToBottom);
        }
    }

    function resetStream() {
        if (stream.container) {
            stream.container.remove();
        }
        stream.container = null;
        stream.thinkingContainer = null;
        stream.responseContainer = null;
        state.pendingThinking = '';
        state.pendingResponse = '';
    }

    function escapeHtml(value) {
        return String(value)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#039;');
    }

    function renderMarkdown(text) {
        if (!text) return '';

        const lines = text.split('\n');
        let inCodeBlock = false;
        let codeLang = '';
        let codeLines = [];
        let normalLines = [];
        let resultHtml = '';

        for (let i = 0; i < lines.length; i++) {
            const line = lines[i];
            const trimmedLine = line.trim();

            // 检测代码块开始或结束（行以 ``` 开头）
            if (trimmedLine.startsWith('```')) {
                if (!inCodeBlock) {
                    // 进入代码块
                    inCodeBlock = true;
                    codeLang = trimmedLine.substring(3).trim();
                    // 将之前累积的普通文本渲染并加入结果
                    if (normalLines.length > 0) {
                        resultHtml += marked.parse(normalLines.join('\n'));
                        normalLines = [];
                    }
                    continue;
                } else {
                    // 退出代码块
                    inCodeBlock = false;
                    // 渲染累积的代码行
                    const codeContent = codeLines.join('\n');
                    const validLang = codeLang && hljs.getLanguage(codeLang) ? codeLang : 'plaintext';
                    const highlighted = hljs.highlight(validLang, codeContent).value;
                    resultHtml += `<pre><code class="hljs language-${validLang}">${highlighted}</code></pre>`;
                    codeLines = [];
                    codeLang = '';
                    continue;
                }
            }

            if (inCodeBlock) {
                codeLines.push(line);
            } else {
                normalLines.push(line);
            }
        }

        // 处理剩余的普通文本
        if (normalLines.length > 0) {
            resultHtml += marked.parse(normalLines.join('\n'));
        }

        // 处理未闭合的代码块
        if (codeLines.length > 0) {
            const codeContent = codeLines.join('\n');
            const validLang = codeLang && hljs.getLanguage(codeLang) ? codeLang : 'plaintext';
            const highlighted = hljs.highlight(validLang, codeContent).value;
            resultHtml += `<pre><code class="hljs language-${validLang}">${highlighted}</code></pre>`;
        }

        return resultHtml;
    }

    function sendCurrentMessage() {
        const text = inputEl.value.trim();
        if (!text || !state.connected) {
            return;
        }

        state.autoFollow = true;
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

    function isNearBottom() {
        const threshold = 40;
        const distanceToBottom = messagesEl.scrollHeight - messagesEl.scrollTop - messagesEl.clientHeight;
        return distanceToBottom <= threshold;
    }

    function scrollMessagesToBottom() {
        messagesEl.scrollTop = messagesEl.scrollHeight;
    }

    window.addEventListener('message', (event) => {
        const message = event.data;
        switch (message.type) {
            case 'initialize':
                state.connected = Boolean(message.connectionState.connected);
                state.backendPort = message.backendPort || 8765;
                state.thinkingEnabled = Boolean(message.modeState.thinkingEnabled);
                state.searchEnabled = Boolean(message.modeState.searchEnabled);
                // 恢复保存的主题
                const savedTheme = localStorage.getItem('deepseek-theme') || 'dark';
                document.body.classList.add(`theme-${savedTheme}`);
                const themeSelector = document.getElementById('themeSelector');
                if (themeSelector) {
                    themeSelector.value = savedTheme;
                }

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
                if (message.thinkingChunk) {
                    state.pendingThinking += message.thinkingChunk;
                    updateStreamContent();
                }
                if (message.responseChunk) {
                    state.pendingResponse += message.responseChunk;
                    updateStreamContent();
                }
                break;
            case 'assistantFinal':
                resetStream();
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

    messagesEl.addEventListener('scroll', () => {
        state.autoFollow = isNearBottom();
    });
    
    // 主题切换
    const themeSelector = document.getElementById('themeSelector');
    if (themeSelector) {
        themeSelector.addEventListener('change', (e) => {
            const theme = e.target.value;
            // 移除所有现有主题类
            document.body.className = document.body.className
                .split(' ')
                .filter(cls => !cls.startsWith('theme-'))
                .join(' ');
            document.body.classList.add(`theme-${theme}`);
            localStorage.setItem('deepseek-theme', theme);
        });
    }

    // 活动条折叠/展开
    const activityBarHeader = document.getElementById('activityBarHeader');
    const activityToggle = document.getElementById('activityToggle');
    // activityListEl 已在文件开头声明，可直接使用
    if (activityBarHeader && activityListEl && activityToggle) {
        activityBarHeader.addEventListener('click', (e) => {
            // 防止点击按钮时触发两次（按钮在header内）
            if (e.target === activityToggle) return;
            const isVisible = activityListEl.style.display === 'block';
            activityListEl.style.display = isVisible ? 'none' : 'block';
            activityToggle.textContent = isVisible ? '▼' : '▲';
        });
        
        activityToggle.addEventListener('click', (e) => {
            e.stopPropagation();
            const isVisible = activityListEl.style.display === 'block';
            activityListEl.style.display = isVisible ? 'none' : 'block';
            activityToggle.textContent = isVisible ? '▼' : '▲';
        });
    }

    vscode.postMessage({ command: 'ready' });
})();

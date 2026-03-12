// inject.js - 最终版：提取所有文本，实时区分思考与回复

(function() {
    const DEBUG = true;
    function log(...args) { if (DEBUG) console.log('[Inject]', ...args); }
    function warn(...args) { console.warn('[Inject]', ...args); }
    function error(...args) { console.error('[Inject]', ...args); }

    // 发送 AI 块
    function sendChunk(type, text) {
        if (!type || text === undefined) return;
        log(`发送 ${type} 块:`, text);
        window.postMessage({ 
            type: 'FROM_INJECT', 
            command: 'ai_chunk', 
            chunkType: type, 
            content: text 
        }, '*');
    }

    function sendEnd() {
        log('发送 ai_end');
        window.postMessage({ type: 'FROM_INJECT', command: 'ai_end' }, '*');
    }

    // 状态管理
    let currentFragmentType = null; // 'thinking' 或 'response'

    function resetState() {
        currentFragmentType = null;
        log('状态已重置');
    }

    // 解析 SSE 数据块：提取所有文本，并根据 fragments 更新类型
    function parseSSEChunk(chunk) {
        const lines = chunk.split('\n');
        for (const line of lines) {
            if (line.startsWith('data: ')) {
                const jsonStr = line.slice(6);
                log('原始 JSON:', jsonStr);
                try {
                    const data = JSON.parse(jsonStr);

                    // ---- 1. 处理 fragments 数组（更新类型并发送已有文本） ----
                    // 情况：初始 fragments（data.v.response.fragments）
                    if (data.v && data.v.response && data.v.response.fragments) {
                        const fragments = data.v.response.fragments;
                        log('初始 fragments:', fragments);
                        fragments.forEach(f => {
                            if (f.type === 'THINK') {
                                currentFragmentType = 'thinking';
                                if (f.content) sendChunk('thinking', f.content);
                            } else if (f.type === 'RESPONSE') {
                                currentFragmentType = 'response';
                                if (f.content) sendChunk('response', f.content);
                            }
                        });
                    }
                    // 情况：APPEND fragments 数组（data.p === 'response/fragments'）
                    else if (data.p === 'response/fragments' && data.o === 'APPEND' && Array.isArray(data.v)) {
                        log('APPEND fragments:', data.v);
                        data.v.forEach(f => {
                            if (f.type === 'THINK') {
                                currentFragmentType = 'thinking';
                                if (f.content) sendChunk('thinking', f.content);
                            } else if (f.type === 'RESPONSE') {
                                currentFragmentType = 'response';
                                if (f.content) sendChunk('response', f.content);
                            }
                        });
                    }

                    // ---- 2. 处理内容追加：data.p === 'response/fragments/-1/content' ----
                    else if (data.p === 'response/fragments/-1/content' && data.v) {
                        log('内容追加，当前类型:', currentFragmentType);
                        const type = currentFragmentType || 'response';
                        sendChunk(type === 'thinking' ? 'thinking' : 'response', data.v);
                    }

                    // ---- 3. 处理直接 v 字段（无 p/o）——可能是简单的文本块 ----
                    else if (data.v && typeof data.v === 'string' && !data.p && !data.o) {
                        log('直接文本，当前类型:', currentFragmentType);
                        const type = currentFragmentType || 'response';
                        sendChunk(type === 'thinking' ? 'thinking' : 'response', data.v);
                    }

                    // 其他结构忽略（如 SET 操作、非字符串等）
                    else {
                        log('忽略的数据:', data);
                    }

                } catch (e) {
                    warn('JSON解析失败:', e.message);
                }
            }
        }
    }

    // ---------- 重写 fetch ----------
    const originalFetch = window.fetch;
    window.fetch = async function(...args) {
        const request = args[0] instanceof Request ? args[0] : new Request(...args);
        if (request.method === 'POST' && request.url.includes('/api/v0/chat/completion')) {
            log('拦截 fetch 请求');
            const response = await originalFetch.apply(this, args);
            const cloned = response.clone();
            if (response.headers.get('content-type')?.includes('text/event-stream')) {
                resetState();
                const reader = cloned.body.getReader();
                const decoder = new TextDecoder('utf-8');
                let buffer = '';
                while (true) {
                    const { done, value } = await reader.read();
                    if (done) break;
                    buffer += decoder.decode(value, { stream: true });
                    let messages = buffer.split('\n\n');
                    buffer = messages.pop() || '';
                    for (const msg of messages) parseSSEChunk(msg);
                }
                sendEnd();
            }
            return response;
        }
        return originalFetch.apply(this, args);
    };

    // ---------- 重写 XMLHttpRequest ----------
    const XHR = XMLHttpRequest;
    function XHRInterceptor() {
        const xhr = new XHR();
        const originalOpen = xhr.open;
        const originalSend = xhr.send;
        let targetUrl, targetMethod;
        xhr.open = function(method, url) { targetMethod = method; targetUrl = url; originalOpen.apply(this, arguments); };
        xhr.send = function(body) {
            if (targetMethod === 'POST' && targetUrl.includes('/api/v0/chat/completion')) {
                log('拦截 XHR 请求');
                let buffer = '';
                let lastLength = 0;
                const check = () => {
                    if (xhr.readyState === 3 || xhr.readyState === 4) {
                        const newText = xhr.responseText.slice(lastLength);
                        lastLength = xhr.responseText.length;
                        buffer += newText;
                        let messages = buffer.split('\n\n');
                        buffer = messages.pop() || '';
                        for (const msg of messages) parseSSEChunk(msg);
                    }
                };
                xhr.addEventListener('readystatechange', check);
                xhr.addEventListener('load', () => sendEnd());
            }
            originalSend.apply(this, arguments);
        };
        xhr.__proto__ = XHR.prototype;
        return xhr;
    }
    XHRInterceptor.prototype = XHR.prototype;
    window.XMLHttpRequest = XHRInterceptor;

    // ---------- 填充输入框 ----------
    function fillAndSubmitInput(text) {
        const ta = document.querySelector('textarea[placeholder="给 DeepSeek 发送消息 "]') ||
                   document.querySelector('textarea[placeholder="给 DeepSeek 发送消息"]') ||
                   document.querySelector('textarea._27c9245');
        if (!ta) { warn('未找到输入框'); return; }
        ta.focus();
        document.execCommand('insertText', false, text);
        ta.dispatchEvent(new Event('input', { bubbles: true }));
        ta.dispatchEvent(new Event('change', { bubbles: true }));
        setTimeout(() => {
            const btn = document.querySelector('div._7436101[role="button"]:not([aria-disabled="true"])') ||
                        document.querySelector('div.ds-icon-button[role="button"]:not([aria-disabled="true"])');
            if (btn) { btn.click(); log('已点击发送'); } else warn('发送按钮不可用');
        }, 300);
    }

    // ---------- 切换按钮 ----------
    function toggleButton(type, state) {
        const text = type === 'thinking' ? '深度思考' : '智能搜索';
        const btn = Array.from(document.querySelectorAll('div[role="button"]')).find(el => el.textContent.includes(text));
        if (!btn) { warn(`未找到 ${text}`); return; }
        const selected = btn.classList.contains('ds-toggle-button--selected');
        if (state !== undefined && ((state && selected) || (!state && !selected))) { log(`${text} 已是所需状态`); return; }
        btn.click();
        log(`已点击 ${text}`);
    }

    // ---------- 消息监听 ----------
    window.addEventListener('message', (event) => {
        if (event.source !== window) return;
        if (event.data.type === 'FROM_CONTENT') {
            if (event.data.command === 'fillInput') fillAndSubmitInput(event.data.text);
            else if (event.data.command === 'toggle') toggleButton(event.data.buttonType, event.data.targetState);
        }
    });

    log('inject.js 已加载');
})();
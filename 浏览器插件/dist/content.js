// content.js
const script = document.createElement('script');
script.src = chrome.runtime.getURL('inject.js');
script.onload = () => script.remove();
(document.documentElement || document.head).appendChild(script);

// WebSocket 连接管理
const WS_URL = 'ws://127.0.0.1:8765';
let ws = null;
let reconnectTimer = null;

function connectWebSocket() {
    if (ws && ws.readyState === WebSocket.OPEN) return;
    ws = new WebSocket(WS_URL);
    ws.onopen = () => {
        console.log('[Content] WebSocket 已连接到本地应用');
        chrome.runtime.sendMessage({ type: 'ws_status', status: 'connected' });
    };
    ws.onclose = () => {
        console.log('[Content] WebSocket 连接关闭，5秒后重连');
        chrome.runtime.sendMessage({ type: 'ws_status', status: 'disconnected' });
        if (reconnectTimer) clearTimeout(reconnectTimer);
        reconnectTimer = setTimeout(connectWebSocket, 5000);
    };
    ws.onerror = (err) => {
        console.error('[Content] WebSocket 错误', err);
    };
    ws.onmessage = (event) => {
        try {
            const data = JSON.parse(event.data);
            console.log('[Content] Received from local app:', data);
            if (data.type === 'user_input') {
                window.postMessage({ type: 'FROM_CONTENT', command: 'fillInput', text: data.text }, '*');
            } else if (data.type === 'toggle_thinking') {
                window.postMessage({
                    type: 'FROM_CONTENT',
                    command: 'toggle',
                    buttonType: 'thinking',
                    targetState: data.state
                }, '*');
            } else if (data.type === 'toggle_search') {
                window.postMessage({
                    type: 'FROM_CONTENT',
                    command: 'toggle',
                    buttonType: 'search',
                    targetState: data.state
                }, '*');
            }
        } catch (e) {
            console.error('[Content] 解析消息失败', e);
        }
    };
}
connectWebSocket();

// 监听来自 inject.js 的消息
window.addEventListener('message', (event) => {
    if (event.source !== window) return;
    if (event.data.type === 'FROM_INJECT') {
        if (event.data.command === 'ai_chunk') {
            if (ws && ws.readyState === WebSocket.OPEN) {
                ws.send(JSON.stringify({ 
                    type: 'ai_chunk', 
                    chunkType: event.data.chunkType, 
                    content: event.data.content 
                }));
            }
        } else if (event.data.command === 'ai_end') {
            if (ws && ws.readyState === WebSocket.OPEN) {
                ws.send(JSON.stringify({ type: 'ai_end' }));
            }
        }
    }
});

// 可选：监听来自 background 的直接消息
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.type === 'user_input') {
        window.postMessage({ type: 'FROM_CONTENT', command: 'fillInput', text: message.text }, '*');
    }
});
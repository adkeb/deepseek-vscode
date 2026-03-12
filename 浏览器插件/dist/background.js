// background.js - 扩展的后台服务工作者
// 负责接收内容脚本的连接状态更新，并响应弹出页面的状态查询

let connectionStatus = 'disconnected'; // 'connected' 或 'disconnected'

// 监听来自内容脚本的消息
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'ws_status') {
    connectionStatus = message.status;
    // 可选：存储到 storage 以供弹出页面读取
    chrome.storage.local.set({ wsStatus: connectionStatus });
  }
  // 响应弹出页面的状态查询
  if (message.type === 'get_status') {
    sendResponse({ status: connectionStatus });
  }
});

// 可选：定期清理状态（如果长时间没有更新，可以设为 disconnected）
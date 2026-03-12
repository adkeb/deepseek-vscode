// popup.js - 弹出页面的脚本

const indicator = document.getElementById('indicator');
const statusText = document.getElementById('statusText');
const refreshBtn = document.getElementById('refreshBtn');

function updateUI(status) {
  if (status === 'connected') {
    indicator.style.backgroundColor = 'green';
    statusText.textContent = '已连接到本地应用';
  } else {
    indicator.style.backgroundColor = 'red';
    statusText.textContent = '未连接';
  }
}

// 从 background 查询状态
function queryStatus() {
  chrome.runtime.sendMessage({ type: 'get_status' }, (response) => {
    if (response && response.status) {
      updateUI(response.status);
    } else {
      updateUI('disconnected');
    }
  });
}

// 初始查询
queryStatus();

// 点击刷新按钮重新查询
refreshBtn.addEventListener('click', queryStatus);
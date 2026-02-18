// PRD: Red Dot or Timer overlay so the user knows recording is working

let overlayEl = null;
let timerInterval = null;

function formatDuration(ms) {
  const totalSec = Math.floor(ms / 1000);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  return [h, m, s].map((n) => String(n).padStart(2, '0')).join(':');
}

function showOverlay(startedAt) {
  if (overlayEl) return;
  const div = document.createElement('div');
  div.id = 'echo-recording-overlay';
  div.innerHTML = '<span class="echo-dot"></span><span class="echo-timer">00:00:00</span>';
  document.body.appendChild(div);
  overlayEl = div;
  const timerEl = div.querySelector('.echo-timer');
  const start = typeof startedAt === 'number' ? startedAt : Date.now();
  function tick() {
    if (!timerEl || !document.body.contains(overlayEl)) return;
    timerEl.textContent = formatDuration(Date.now() - start);
  }
  tick();
  timerInterval = setInterval(tick, 1000);
}

function hideOverlay() {
  if (timerInterval) {
    clearInterval(timerInterval);
    timerInterval = null;
  }
  if (overlayEl && overlayEl.parentNode) {
    overlayEl.parentNode.removeChild(overlayEl);
  }
  overlayEl = null;
}

chrome.runtime.onMessage.addListener((message) => {
  if (message.type === 'ECHO_OVERLAY_START') {
    showOverlay(message.startedAt ?? Date.now());
  }
  if (message.type === 'ECHO_OVERLAY_STOP') {
    hideOverlay();
  }
});

// Show overlay on load if this tab is already the one being recorded (e.g. message was missed)
chrome.runtime.sendMessage({ type: 'ECHO_OVERLAY_QUERY' }, (response) => {
  if (chrome.runtime.lastError) return;
  if (response?.show) showOverlay(response.startedAt ?? Date.now());
});

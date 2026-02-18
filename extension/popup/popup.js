// Popup script: auth, controls Start/Stop, timer + visualizer

import { initDB, getAllSessions, downloadSessionAsFile, deleteSession } from '../utils/indexeddb.js';

const authSection = document.getElementById('authSection');
const mainSection = document.getElementById('mainSection');
const statusSection = document.getElementById('statusSection');
const visualizerSection = document.getElementById('visualizerSection');
const controlsSection = document.getElementById('controlsSection');
const apiUrlInput = document.getElementById('apiUrlInput');
const authTabLogin = document.getElementById('authTabLogin');
const authTabRegister = document.getElementById('authTabRegister');
const authLoginForm = document.getElementById('authLoginForm');
const authRegisterForm = document.getElementById('authRegisterForm');
const authEmail = document.getElementById('authEmail');
const authPassword = document.getElementById('authPassword');
const authDisplayName = document.getElementById('authDisplayName');
const authRegisterEmail = document.getElementById('authRegisterEmail');
const authRegisterPassword = document.getElementById('authRegisterPassword');
const authConfirmPassword = document.getElementById('authConfirmPassword');
const authTermsCheck = document.getElementById('authTermsCheck');
const loginBtn = document.getElementById('loginBtn');
const registerBtn = document.getElementById('registerBtn');
const authError = document.getElementById('authError');
const authUserEmail = document.getElementById('authUserEmail');
const logoutBtn = document.getElementById('logoutBtn');
const statusText = document.getElementById('statusText');
const timerEl = document.getElementById('timer');
const toggleBtn = document.getElementById('toggleBtn');
const barsEl = document.getElementById('bars');
const audioWarning = document.getElementById('audioWarning');
const recordTab = document.getElementById('recordTab');
const recordingsTab = document.getElementById('recordingsTab');
const recordingsSection = document.getElementById('recordingsSection');
const recordingsList = document.getElementById('recordingsList');
const refreshRecordingsBtn = document.getElementById('refreshRecordingsBtn');
const monitorToggle = document.getElementById('monitorToggle');
const micToggle = document.getElementById('micToggle');
const upgradeSection = document.getElementById('upgradeSection');
const upgradeArcadeBtn = document.getElementById('upgradeArcadeBtn');
const upgradeProBtn = document.getElementById('upgradeProBtn');
const headerDot = document.getElementById('headerDot') || document.querySelector('.title-block .dot');

let timerInterval = null;
let startTimestamp = null;
let isRecording = false;
let currentView = 'record';
let monitorEnabled = true;
let includeMic = false;

initBars();
(async () => {
  const { echoAuthToken, echoApiBase, echoUserEmail, echoUserDisplayName, echoSubscriptionTier, echoCurrentSession } = await chrome.storage.local.get(['echoAuthToken', 'echoApiBase', 'echoUserEmail', 'echoUserDisplayName', 'echoSubscriptionTier', 'echoCurrentSession']);
  if (echoApiBase) apiUrlInput.value = echoApiBase;
  if (echoAuthToken) {
    authSection.classList.add('hidden');
    mainSection.classList.remove('hidden');
    [statusSection, visualizerSection, controlsSection].forEach(el => el && el.classList.remove('hidden'));
    const tierLabel = echoSubscriptionTier === 'arcade_pass' ? 'Arcade Pass' : echoSubscriptionTier === 'echo_pro' ? 'Echo Pro' : 'Free';
    if (authUserEmail) authUserEmail.textContent = (echoUserDisplayName ? `Hi, ${echoUserDisplayName}` : (echoUserEmail || 'Signed in')) + ` · ${tierLabel}`;
    if (upgradeSection) {
      if (echoSubscriptionTier === 'free') upgradeSection.classList.remove('hidden');
      else upgradeSection.classList.add('hidden');
    }
    if (echoCurrentSession?.isRecording && headerDot) headerDot.classList.add('recording');
  } else {
    authSection.classList.remove('hidden');
    mainSection.classList.add('hidden');
    [statusSection, visualizerSection, controlsSection].forEach(el => el && el.classList.add('hidden'));
    if (headerDot) headerDot.classList.remove('recording');
  }
})();

if (authTabLogin) authTabLogin.addEventListener('click', () => {
  authTabLogin.classList.add('active');
  authTabRegister?.classList.remove('active');
  authLoginForm?.classList.remove('hidden');
  authRegisterForm?.classList.add('hidden');
  authError?.classList.add('hidden');
});
if (authTabRegister) authTabRegister.addEventListener('click', () => {
  authTabRegister.classList.add('active');
  authTabLogin?.classList.remove('active');
  authRegisterForm?.classList.remove('hidden');
  authLoginForm?.classList.add('hidden');
  authError?.classList.add('hidden');
});
restoreState();
setupTabs();
initDB().catch(() => {});
loadRecordings();
restoreMonitorSetting();
restoreMicSetting();

loginBtn.addEventListener('click', async () => {
  const base = (apiUrlInput.value || '').trim() || 'http://localhost:5012';
  const email = (authEmail.value || '').trim();
  const password = authPassword.value || '';
  authError.classList.add('hidden');
  if (!email || !password) {
    authError.textContent = 'Email and password required';
    authError.classList.remove('hidden');
    return;
  }
  try {
    const res = await fetch(`${base.replace(/\/$/, '')}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password })
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      authError.textContent = data.error || `Login failed (${res.status})`;
      authError.classList.remove('hidden');
      return;
    }
    await chrome.storage.local.set({
      echoAuthToken: data.token,
      echoApiBase: base,
      echoUserEmail: data.user?.email || email,
      echoUserDisplayName: data.user?.displayName || '',
      echoSubscriptionTier: data.user?.subscriptionTier || 'free'
    });
    authSection.classList.add('hidden');
    mainSection.classList.remove('hidden');
    [statusSection, visualizerSection, controlsSection].forEach(el => el && el.classList.remove('hidden'));
    const tierLabel = (data.user?.subscriptionTier === 'arcade_pass') ? 'Arcade Pass' : (data.user?.subscriptionTier === 'echo_pro') ? 'Echo Pro' : 'Free';
    if (authUserEmail) authUserEmail.textContent = (data.user?.displayName ? `Hi, ${data.user.displayName}` : (data.user?.email || email)) + ` · ${tierLabel}`;
    if (upgradeSection) {
      if ((data.user?.subscriptionTier || 'free') === 'free') upgradeSection.classList.remove('hidden');
      else upgradeSection.classList.add('hidden');
    }
  } catch (e) {
    authError.textContent = e.message || 'Network error';
    authError.classList.remove('hidden');
  }
});

registerBtn.addEventListener('click', async () => {
  const base = (apiUrlInput.value || '').trim() || 'http://localhost:5012';
  const displayName = (authDisplayName?.value || '').trim();
  const email = (authRegisterEmail?.value || authEmail?.value || '').trim().toLowerCase();
  const password = authRegisterPassword?.value || '';
  const confirmPassword = authConfirmPassword?.value || '';
  authError.classList.add('hidden');
  if (!email || !password) {
    authError.textContent = 'Email and password required';
    authError.classList.remove('hidden');
    return;
  }
  if (password.length < 6) {
    authError.textContent = 'Password must be at least 6 characters';
    authError.classList.remove('hidden');
    return;
  }
  if (password !== confirmPassword) {
    authError.textContent = 'Password and confirm password do not match';
    authError.classList.remove('hidden');
    return;
  }
  if (!authTermsCheck?.checked) {
    authError.textContent = 'Please agree to record responsibly and notify participants';
    authError.classList.remove('hidden');
    return;
  }
  try {
    const res = await fetch(`${base.replace(/\/$/, '')}/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ displayName, email, password, confirmPassword })
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      authError.textContent = data.error || `Register failed (${res.status})`;
      authError.classList.remove('hidden');
      return;
    }
    await chrome.storage.local.set({
      echoAuthToken: data.token,
      echoApiBase: base,
      echoUserEmail: data.user?.email || email,
      echoUserDisplayName: data.user?.displayName || displayName || '',
      echoSubscriptionTier: data.user?.subscriptionTier || 'free'
    });
    authSection.classList.add('hidden');
    mainSection.classList.remove('hidden');
    [statusSection, visualizerSection, controlsSection].forEach(el => el && el.classList.remove('hidden'));
    const tierLabel = (data.user?.subscriptionTier === 'arcade_pass') ? 'Arcade Pass' : (data.user?.subscriptionTier === 'echo_pro') ? 'Echo Pro' : 'Free';
    if (authUserEmail) authUserEmail.textContent = (data.user?.displayName ? `Hi, ${data.user.displayName}` : (data.user?.email || email)) + ` · ${tierLabel}`;
    if (upgradeSection) {
      if ((data.user?.subscriptionTier || 'free') === 'free') upgradeSection.classList.remove('hidden');
      else upgradeSection.classList.add('hidden');
    }
  } catch (e) {
    authError.textContent = e.message || 'Network error';
    authError.classList.remove('hidden');
  }
});

logoutBtn.addEventListener('click', async () => {
  await chrome.storage.local.remove(['echoAuthToken', 'echoUserEmail', 'echoUserDisplayName', 'echoSubscriptionTier']);
  authSection.classList.remove('hidden');
  mainSection.classList.add('hidden');
  [statusSection, visualizerSection, controlsSection].forEach(el => el && el.classList.add('hidden'));
  if (upgradeSection) upgradeSection.classList.add('hidden');
  authEmail.value = '';
  authPassword.value = '';
  authError.classList.add('hidden');
  if (authDisplayName) authDisplayName.value = '';
  if (authRegisterEmail) authRegisterEmail.value = '';
  if (authRegisterPassword) authRegisterPassword.value = '';
  if (authConfirmPassword) authConfirmPassword.value = '';
  if (authTermsCheck) authTermsCheck.checked = false;
});

async function openCheckout(tier) {
  const { echoAuthToken, echoApiBase } = await chrome.storage.local.get(['echoAuthToken', 'echoApiBase']);
  const base = (echoApiBase || '').trim() || 'http://localhost:5012';
  if (!echoAuthToken) {
    alert('Please log in first.');
    return;
  }
  try {
    const res = await fetch(`${base.replace(/\/$/, '')}/payments/create-checkout-session`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + echoAuthToken },
      body: JSON.stringify({ tier })
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      alert(data.error || 'Could not start checkout. Is Stripe configured on the server?');
      return;
    }
    if (data.url) chrome.tabs.create({ url: data.url });
    else alert('No checkout URL returned.');
  } catch (e) {
    alert('Error: ' + (e?.message || String(e)));
  }
}
if (upgradeArcadeBtn) upgradeArcadeBtn.addEventListener('click', () => openCheckout('arcade_pass'));
if (upgradeProBtn) upgradeProBtn.addEventListener('click', () => openCheckout('echo_pro'));

// Send message to background with retry (MV3 service worker may be sleeping – "Receiving end does not exist")
async function sendToBackground(msg, retries = 3) {
  let lastError;
  for (let i = 0; i < retries; i++) {
    try {
      const response = await new Promise((resolve, reject) => {
        chrome.runtime.sendMessage(msg, (response) => {
          if (chrome.runtime.lastError) {
            const err = chrome.runtime.lastError.message || '';
            reject(new Error(err));
          } else {
            resolve(response);
          }
        });
      });
      return response;
    } catch (e) {
      lastError = e;
      const msg = e?.message || '';
      if (msg.includes('Receiving end does not exist') && i < retries - 1) {
        await new Promise((r) => setTimeout(r, 200 * (i + 1)));
      } else {
        throw e;
      }
    }
  }
  throw lastError;
}

toggleBtn.addEventListener('click', async () => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) return;
  const url = tab.url || '';
  if (url.startsWith('chrome://') || url.startsWith('edge://') || url.startsWith('chrome-extension://')) {
    alert('Cannot record Chrome/Edge internal pages. Open Zoom/Meet/YouTube on a normal website tab and try again.');
    return;
  }

  try {
    if (isRecording) {
      const res = await sendToBackground({ type: 'ECHO_STOP_RECORDING' });
      if (res && res.ok === false) {
        alert(res.error || 'Stop failed');
        if (res.code === 'FREE_LIMIT_EXCEEDED') alert('Upgrade to Arcade Pass ($9/mo) or Echo Pro ($5/mo) for unlimited recording.');
        return;
      }
      setIdleUI();
      // Refresh Recordings list so the new session appears when user opens that tab
      loadRecordings();
    } else {
      const res = await sendToBackground({
        type: 'ECHO_START_RECORDING',
        tabId: tab.id,
        monitorEnabled,
        includeMic
      });
      if (res && res.ok === false) {
        alert(res.error || 'Start failed');
        setIdleUI();
        return;
      }
      setRecordingUI();
    }
  } catch (e) {
    alert('Extension error: ' + (e?.message || String(e)) + '. Try reloading the extension (chrome://extensions) and try again.');
    setIdleUI();
  }
});

monitorToggle.addEventListener('change', async () => {
  monitorEnabled = !!monitorToggle.checked;
  await chrome.storage.local.set({ echoMonitorEnabled: monitorEnabled });
});

micToggle.addEventListener('change', async () => {
  includeMic = !!micToggle.checked;
  await chrome.storage.local.set({ echoIncludeMic: includeMic });
});

async function restoreState() {
  const { echoCurrentSession } = await chrome.storage.local.get('echoCurrentSession');
  if (echoCurrentSession?.isRecording) {
    isRecording = true;
    startTimestamp = echoCurrentSession.startedAt;
    setRecordingUI(true);
  } else {
    setIdleUI();
  }
}

async function restoreMonitorSetting() {
  const { echoMonitorEnabled: saved } = await chrome.storage.local.get('echoMonitorEnabled');
  // Default OFF to avoid echo/double audio on sites that don't mute.
  monitorEnabled = saved !== undefined ? !!saved : false;
  monitorToggle.checked = monitorEnabled;
}

async function restoreMicSetting() {
  const { echoIncludeMic: saved } = await chrome.storage.local.get('echoIncludeMic');
  includeMic = saved !== undefined ? !!saved : false;
  micToggle.checked = includeMic;
}

function initBars() {
  for (let i = 0; i < 24; i++) {
    const bar = document.createElement('div');
    bar.className = 'bar';
    barsEl.appendChild(bar);
  }
}

const AUDIO_LEVEL_THRESHOLD = 0.01;
// Show warning only after 12s of low/zero level so it doesn't flash during normal quiet moments
const NO_AUDIO_WARN_MS = 12000;
let lowLevelSince = null;

function animateBars(active, level = 0) {
  const bars = Array.from(document.querySelectorAll('.bar'));
  if (!active) {
    lowLevelSince = null;
    bars.forEach((bar) => {
      bar.style.transform = 'scaleY(0.1)';
      bar.style.opacity = '0.3';
    });
    audioWarning.classList.add('hidden');
    return;
  }

  const normalizedLevel = Math.min(1, Math.max(0, Number(level) || 0));
  bars.forEach((bar, index) => {
    const spread = Math.sin((Date.now() / 80) + index * 0.4) * 0.25 + 0.75;
    const height = Math.max(0.08, Math.min(1, normalizedLevel * spread));
    bar.style.transform = `scaleY(${height})`;
    bar.style.opacity = normalizedLevel > 0.02 ? '0.8' : '0.4';
  });

  if (normalizedLevel < AUDIO_LEVEL_THRESHOLD) {
    if (lowLevelSince == null) lowLevelSince = Date.now();
    if (Date.now() - lowLevelSince >= NO_AUDIO_WARN_MS) {
      audioWarning.classList.remove('hidden');
    }
  } else {
    lowLevelSince = null;
    audioWarning.classList.add('hidden');
  }
}

function setIdleUI() {
  isRecording = false;
  statusText.textContent = 'Idle';
  toggleBtn.textContent = 'Start Recording';
  toggleBtn.classList.remove('danger');
  toggleBtn.classList.add('primary');
  const dot = document.getElementById('headerDot') || document.querySelector('.title-block .dot');
  if (dot) dot.classList.remove('recording');
  if (timerInterval) {
    clearInterval(timerInterval);
    timerInterval = null;
  }
  timerEl.textContent = '00:00:00';
  animateBars(false);
}

function setRecordingUI(fromRestore = false) {
  isRecording = true;
  statusText.textContent = 'Recording…';
  toggleBtn.textContent = 'Stop Recording';
  toggleBtn.classList.remove('primary');
  toggleBtn.classList.add('danger');
  const dot = document.getElementById('headerDot') || document.querySelector('.title-block .dot');
  if (dot) dot.classList.add('recording');

  if (!fromRestore) {
    startTimestamp = Date.now();
  }

  if (timerInterval) clearInterval(timerInterval);
  timerInterval = setInterval(async () => {
    const elapsedMs = Date.now() - startTimestamp;
    const totalSeconds = Math.floor(elapsedMs / 1000);
    const h = String(Math.floor(totalSeconds / 3600)).padStart(2, '0');
    const m = String(Math.floor((totalSeconds % 3600) / 60)).padStart(2, '0');
    const s = String(totalSeconds % 60).padStart(2, '0');
    timerEl.textContent = `${h}:${m}:${s}`;
    const { echoLastAudioLevel = 0 } = await chrome.storage.local.get('echoLastAudioLevel');
    animateBars(true, echoLastAudioLevel);
  }, 200);
}

function setupTabs() {
  recordTab.addEventListener('click', () => {
    currentView = 'record';
    recordTab.classList.add('active');
    recordingsTab.classList.remove('active');
    recordingsSection.classList.add('hidden');
    document.querySelector('.status').classList.remove('hidden');
    document.querySelector('.visualizer').classList.remove('hidden');
  });

  recordingsTab.addEventListener('click', () => {
    currentView = 'recordings';
    recordTab.classList.remove('active');
    recordingsTab.classList.add('active');
    recordingsSection.classList.remove('hidden');
    document.querySelector('.status').classList.add('hidden');
    document.querySelector('.visualizer').classList.add('hidden');
    loadRecordings();
  });

  if (refreshRecordingsBtn) {
    refreshRecordingsBtn.addEventListener('click', () => loadRecordings());
  }
}

async function loadRecordings() {
  if (!recordingsList) return;
  try {
    recordingsList.innerHTML = '<p class="loading">Loading recordings...</p>';
    const { echoAuthToken, echoApiBase } = await chrome.storage.local.get(['echoAuthToken', 'echoApiBase']);
    const base = (echoApiBase && echoApiBase.trim()) ? echoApiBase.replace(/\/$/, '') : 'http://localhost:5012';

    if (!echoAuthToken) {
      recordingsList.innerHTML = '<p class="empty">Log in to see your recordings.</p>';
      return;
    }

    const res = await fetch(`${base}/echo/sessions`, {
      headers: { 'Authorization': 'Bearer ' + echoAuthToken }
    });
    if (res.status === 401) {
      recordingsList.innerHTML = '<p class="empty">Session expired. Please log in again.</p>';
      return;
    }
    if (!res.ok) {
      recordingsList.innerHTML = '<p class="empty">Could not load recordings.</p>';
      return;
    }

    const sessions = await res.json();
    if (!Array.isArray(sessions) || sessions.length === 0) {
      recordingsList.innerHTML = '<p class="empty">No recordings yet. Start a recording, then click Stop – it will appear here.</p>';
      return;
    }

    await initDB();
    const localSessions = await getAllSessions();
    const localSessionIds = new Set(localSessions.map(s => s.sessionId));

    recordingsList.innerHTML = '';
    for (const session of sessions) {
      const item = document.createElement('div');
      item.className = 'recording-item';
      const date = new Date(session.createdAt);
      const dateStr = date.toLocaleDateString() + ' ' + date.toLocaleTimeString();
      const durationMin = (session.chunkCount || 0) * 5;
      const durationStr = durationMin >= 60 ? `${Math.floor(durationMin / 60)}h ${durationMin % 60}m` : `${durationMin} min`;
      const hasLocal = localSessionIds.has(session.id);
      item.innerHTML = `
        <div class="recording-item-header">
          <span class="recording-item-title">Recording</span>
          <span style="font-size: 10px; color: #6b7280;">${session.status}</span>
        </div>
        <div class="recording-item-meta">
          ${dateStr} • ~${durationStr} • ${session.chunkCount || 0} chunks
        </div>
        <div class="recording-item-actions">
          <button class="btn-view" data-session-id="${session.id}">View</button>
          ${hasLocal ? `<button class="btn-download" data-session-id="${session.id}">Download</button><button class="btn-delete" data-session-id="${session.id}">Delete local</button>` : ''}
        </div>
      `;
      recordingsList.appendChild(item);
    }

    document.querySelectorAll('.btn-view').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        const sessionId = e.target.dataset.sessionId;
        try {
          const { echoAuthToken: token, echoApiBase: apiBase } = await chrome.storage.local.get(['echoAuthToken', 'echoApiBase']);
          const b = (apiBase && apiBase.trim()) ? apiBase.replace(/\/$/, '') : 'http://localhost:5012';
          const r = await fetch(`${b}/echo/session/${sessionId}`, { headers: { 'Authorization': 'Bearer ' + token } });
          if (!r.ok) { alert('Could not load session.'); return; }
          const data = await r.json();
          const summary = (data.summary || '(No summary yet)').substring(0, 500);
          const transcript = (data.transcript || '(No transcript yet)').substring(0, 500);
          alert(`Status: ${data.status}\n\nSummary:\n${summary}${data.summary && data.summary.length > 500 ? '…' : ''}\n\nTranscript (excerpt):\n${transcript}${data.transcript && data.transcript.length > 500 ? '…' : ''}`);
        } catch (err) {
          alert('Failed to load: ' + err.message);
        }
      });
    });

    document.querySelectorAll('.btn-download').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        const sessionId = e.target.dataset.sessionId;
        try {
          await downloadSessionAsFile(sessionId);
        } catch (err) {
          alert('Failed to download: ' + err.message);
        }
      });
    });

    document.querySelectorAll('.btn-delete').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        const sessionId = e.target.dataset.sessionId;
        if (confirm('Remove this recording from this device only? (It stays on the server.)')) {
          try {
            await deleteSession(sessionId);
            loadRecordings();
          } catch (err) {
            alert('Failed to delete: ' + err.message);
          }
        }
      });
    });
  } catch (err) {
    console.error('Failed to load recordings:', err);
    recordingsList.innerHTML = '<p class="empty">Error loading recordings. Check console for details.</p>';
  }
}


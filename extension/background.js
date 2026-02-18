// Echo background service worker (MV3)
// - Manages recording sessions
// - Coordinates tabCapture + offscreen document

const OFFSCREEN_URL = 'offscreen/offscreen.html';
const DEFAULT_API_BASE = 'http://localhost:5012';

let currentSession = null;

async function getApiBase() {
  const { echoApiBase } = await chrome.storage.local.get('echoApiBase');
  return (echoApiBase && echoApiBase.trim()) ? echoApiBase.replace(/\/$/, '') : DEFAULT_API_BASE;
}

async function getAuthHeaders() {
  const base = await getApiBase();
  const { echoAuthToken } = await chrome.storage.local.get('echoAuthToken');
  const headers = { 'Content-Type': 'application/json' };
  if (echoAuthToken) headers['Authorization'] = 'Bearer ' + echoAuthToken;
  return { base, headers };
}

// A simple in-memory state; for long-term persistence we will also sync to chrome.storage.
// currentSession = {
//   tabId,
//   sessionId,
//   isRecording,
//   startedAt,
// }

chrome.runtime.onInstalled.addListener(() => {
  console.log('Echo extension installed');
});

// When the tab that was being recorded is closed, mark the session as finished in the API
// so the DB doesn't keep showing "Recording" forever.
chrome.tabs.onRemoved.addListener(async (tabId) => {
  await loadSessionFromStorage();
  if (!currentSession?.isRecording || currentSession.tabId !== tabId) return;
  const sessionId = currentSession.sessionId;
  try {
    const { base, headers } = await getAuthHeaders();
    const res = await fetch(`${base}/echo/finish-session`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ sessionId })
    });
    if (res.status === 401) await chrome.storage.local.remove('echoAuthToken');
  } catch (err) {
    console.warn('Echo API finish-session (on tab close) failed:', err);
  }
  currentSession.isRecording = false;
  await chrome.storage.local.set({ echoCurrentSession: currentSession });
  await chrome.action.setBadgeText({ text: '' });
  try {
    await chrome.runtime.sendMessage({ type: 'ECHO_OFFSCREEN_STOP', sessionId });
  } catch {}
  try {
    await chrome.offscreen.closeDocument();
  } catch {}
});

chrome.action.onClicked.addListener(async (tab) => {
  // Fallback if user clicks the icon directly (without popup)
  if (!tab.id) return;
  await toggleRecording(tab.id);
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  (async () => {
    // MV3 service workers sleep; reload state from storage every time.
    await loadSessionFromStorage();

    if (message.type === 'ECHO_START_RECORDING') {
      const result = await startRecordingForTab(message.tabId, message.monitorEnabled, message.includeMic);
      sendResponse(result);
    }

    if (message.type === 'ECHO_STOP_RECORDING') {
      const result = await stopRecording();
      sendResponse(result);
    }

    // Content script asks: should I show the recording overlay? (e.g. after tab load / when message was missed)
    if (message.type === 'ECHO_OVERLAY_QUERY') {
      const tabId = sender.tab?.id;
      if (tabId != null && currentSession?.isRecording && currentSession.tabId === tabId) {
        sendResponse({ show: true, startedAt: currentSession.startedAt });
      } else {
        sendResponse({ show: false });
      }
    }
  })();
  // Indicate we will respond asynchronously
  return true;
});

async function loadSessionFromStorage() {
  try {
    const { echoCurrentSession } = await chrome.storage.local.get('echoCurrentSession');
    if (echoCurrentSession) currentSession = echoCurrentSession;
  } catch {}
}

async function toggleRecording(tabId) {
  if (currentSession?.isRecording) {
    await stopRecording();
  } else {
    await startRecordingForTab(tabId);
  }
}

/** Resolve when offscreen sends ECHO_OFFSCREEN_READY, or reject after timeout. */
function waitForOffscreenReady(timeoutMs) {
  return new Promise((resolve) => {
    const handler = (message, sender) => {
      if (message?.type === 'ECHO_OFFSCREEN_READY') {
        chrome.runtime.onMessage.removeListener(handler);
        resolve(true);
      }
    };
    chrome.runtime.onMessage.addListener(handler);
    setTimeout(() => {
      chrome.runtime.onMessage.removeListener(handler);
      resolve(false);
    }, timeoutMs);
  });
}

async function ensureOffscreenDocument() {
  try {
    const hasDocument = await chrome.offscreen.hasDocument();
    if (hasDocument) {
      console.log('Offscreen document already exists');
      return;
    }
  } catch (err) {
    console.log('hasDocument check failed, will try to create:', err);
  }

  try {
    await chrome.offscreen.createDocument({
      url: OFFSCREEN_URL,
      reasons: ['USER_MEDIA'],
      justification: 'Record long-running tab audio using MediaRecorder in a DOM context.'
    });
    console.log('Offscreen document created successfully');
  } catch (err) {
    if (err.message && err.message.includes('already exists') || err.message?.includes('Only a single offscreen')) {
      await chrome.offscreen.closeDocument().catch(() => {});
      await new Promise((r) => setTimeout(r, 400));
      const hasDoc = await chrome.offscreen.hasDocument().catch(() => false);
      if (!hasDoc) {
        await chrome.offscreen.createDocument({
          url: OFFSCREEN_URL,
          reasons: ['USER_MEDIA'],
          justification: 'Record long-running tab audio using MediaRecorder in a DOM context.'
        });
      }
      return;
    }
    throw err;
  }
}

async function startRecordingForTab(tabId, monitorEnabled, includeMic) {
  try {
    await forceStopAndCloseOffscreen();
    await new Promise((r) => setTimeout(r, 250));

    // Start listening for ready before creating document so we don't miss the message.
    const readyPromise = waitForOffscreenReady(2500);
    await ensureOffscreenDocument();
    const ready = await readyPromise;
    if (!ready) {
      return { ok: false, error: 'Recording panel did not start in time. Try again.' };
    }

    // Get stream ID as late as possible so it's still valid when offscreen calls getUserMedia.
    let streamId;
    try {
      streamId = await chrome.tabCapture.getMediaStreamId({ targetTabId: tabId });
    } catch (streamErr) {
      const msg = streamErr?.message || String(streamErr);
      if (msg.includes('active stream') || msg.includes('capture')) {
        await forceStopAndCloseOffscreen();
        await new Promise((r) => setTimeout(r, 300));
        streamId = await chrome.tabCapture.getMediaStreamId({ targetTabId: tabId });
      } else {
        throw streamErr;
      }
    }

    let sessionId;
    try {
      const { base, headers } = await getAuthHeaders();
      const res = await fetch(`${base}/echo/start-session`, { method: 'POST', headers });
      if (res.ok) {
        const data = await res.json();
        sessionId = data.sessionId;
      } else {
        if (res.status === 401) {
          await chrome.storage.local.remove('echoAuthToken');
          return { ok: false, error: 'Please log in again.' };
        }
        sessionId = crypto.randomUUID();
      }
    } catch (err) {
      console.warn('Echo API not reachable, using local session only:', err);
      sessionId = crypto.randomUUID();
    }

    currentSession = {
      tabId,
      sessionId,
      isRecording: true,
      startedAt: Date.now()
    };

    await chrome.storage.local.set({ echoCurrentSession: currentSession });

    const apiBase = await getApiBase();
    const { echoAuthToken } = await chrome.storage.local.get('echoAuthToken');
    const offscreenResponse = await new Promise((resolve) => {
      chrome.runtime.sendMessage(
        {
          type: 'ECHO_OFFSCREEN_START',
          streamId,
          sessionId,
          apiBaseUrl: apiBase,
          authToken: echoAuthToken || null,
          monitorEnabled: monitorEnabled === true,
          includeMic: includeMic === true
        },
        (response) => {
          if (chrome.runtime.lastError) resolve({ ok: false, error: chrome.runtime.lastError.message });
          else resolve(response || { ok: false, error: 'No response' });
        }
      );
    });

    if (!offscreenResponse.ok) {
      currentSession.isRecording = false;
      await chrome.storage.local.set({ echoCurrentSession: currentSession });
      await chrome.action.setBadgeText({ text: '' });
      return { ok: false, error: offscreenResponse.error || 'Recording failed to start' };
    }

    await chrome.action.setBadgeText({ text: 'REC' });
    await chrome.action.setBadgeBackgroundColor({ color: '#e02424' });
    const sendOverlayStart = () => {
      chrome.tabs.sendMessage(tabId, { type: 'ECHO_OVERLAY_START', startedAt: currentSession.startedAt }).catch(() => {});
    };
    sendOverlayStart();
    setTimeout(sendOverlayStart, 600);
    setTimeout(sendOverlayStart, 1500);
    return { ok: true };
  } catch (err) {
    console.error('Failed to start recording', err);
    // Don't use chrome.notifications here (it requires a valid iconUrl).
    return { ok: false, error: err?.message ?? String(err) };
  }
}

async function forceStopAndCloseOffscreen() {
  await loadSessionFromStorage();
  try {
    await chrome.runtime.sendMessage({
      type: 'ECHO_OFFSCREEN_STOP',
      sessionId: currentSession?.sessionId ?? null
    });
  } catch {}
  try {
    await chrome.offscreen.closeDocument();
  } catch {}
  await new Promise((r) => setTimeout(r, 300));
}

async function stopRecording() {
  await loadSessionFromStorage();
  if (!currentSession?.isRecording) {
    // Still try to stop/close offscreen just in case recording is running but
    // the session state didn't persist correctly.
    await forceStopAndCloseOffscreen();
    await chrome.action.setBadgeText({ text: '' });
    return { ok: true };
  }

  const sessionId = currentSession.sessionId;

  // Wait for offscreen to stop and finish saving to IndexedDB before updating state.
  try {
    await new Promise((resolve, reject) => {
      chrome.runtime.sendMessage({ type: 'ECHO_OFFSCREEN_STOP', sessionId }, (response) => {
        if (chrome.runtime.lastError) resolve(); // offscreen may already be closed
        else resolve(response);
      });
    });
  } catch {}

  try {
    const { base, headers } = await getAuthHeaders();
    const res = await fetch(`${base}/echo/finish-session`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ sessionId })
    });
    if (res.status === 401) await chrome.storage.local.remove('echoAuthToken');
    if (res.status === 403) {
      const data = await res.json().catch(() => ({}));
      if (data.code === 'FREE_LIMIT_EXCEEDED') {
        try {
          await chrome.notifications.create({
            type: 'basic',
            iconUrl: 'icons/icon128.png',
            title: 'Echo – Free limit reached',
            message: data.error || 'Free tier is 3 hours/month. Upgrade to Arcade Pass or Echo Pro for unlimited recording.'
          });
        } catch (_) {}
        currentSession.isRecording = false;
        await chrome.storage.local.set({ echoCurrentSession: currentSession });
        await chrome.action.setBadgeText({ text: '' });
        try { await chrome.tabs.sendMessage(currentSession.tabId, { type: 'ECHO_OVERLAY_STOP' }); } catch (_) {}
        return { ok: false, error: data.error || 'Free limit reached. Upgrade for unlimited recording.', code: 'FREE_LIMIT_EXCEEDED' };
      }
    }
  } catch (err) {
    console.warn('Echo API finish-session failed:', err);
  }

  currentSession.isRecording = false;
  await chrome.storage.local.set({ echoCurrentSession: currentSession });

  await chrome.action.setBadgeText({ text: '' });
  try {
    await chrome.tabs.sendMessage(currentSession.tabId, { type: 'ECHO_OVERLAY_STOP' });
  } catch (e) {}
  return { ok: true };
}


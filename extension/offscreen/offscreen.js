// Runs in offscreen document; has DOM + MediaRecorder.
// Listens for messages from background.js to start/stop recording.

import { initDB, saveChunk, getChunk } from '../utils/indexeddb.js';

// In some contexts chrome.storage can be undefined; use a safe ref to avoid "reading 'local' of undefined"
const storageLocal =
  typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local
    ? chrome.storage.local
    : { get: () => Promise.resolve({}), set: () => Promise.resolve() };

let mediaRecorder = null;
let chunks = [];
let chunkIntervalId = null;
let currentSessionId = null;
let chunkSequenceNumber = 0;
/** Echo API base URL (from background). If set, chunks are also uploaded to the API. */
let apiBaseUrl = '';
/** JWT for authenticated requests (production). */
let authToken = null;
let tabStream = null;
let micStream = null;
let mixedStream = null;
/** Resolved when mediaRecorder onstop has finished flushing to IndexedDB. */
let flushDonePromise = Promise.resolve();
let resolveFlushDone = () => {};
/** PRD: Real audio level for popup visualizer + "No Audio Detected" warning. */
let analyserIntervalId = null;
let analyserContext = null;
let analyserNode = null;

// PRD: one chunk every 5 minutes (limits data loss if browser/tab closes)
const CHUNK_INTERVAL_MS = 5 * 60 * 1000;

// Initialize IndexedDB when offscreen document loads
initDB().catch(console.error);

// Tell background we are ready so it doesn't send ECHO_OFFSCREEN_START before we're listening
try {
  chrome.runtime.sendMessage({ type: 'ECHO_OFFSCREEN_READY' }).catch(() => {});
} catch {}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  (async () => {
    if (message.type === 'ECHO_OFFSCREEN_START') {
      apiBaseUrl = message.apiBaseUrl || '';
      authToken = message.authToken || null;
      try {
        await retryPendingUploads();
        await startRecording(
          message.streamId,
          message.sessionId,
          message.monitorEnabled === true,
          message.includeMic === true
        );
        sendResponse({ ok: true });
      } catch (e) {
        console.error('Echo offscreen startRecording failed:', e);
        const errMsg = e instanceof DOMException
          ? (e.name + ': ' + (e.message || ''))
          : (e?.message || String(e));
        sendResponse({ ok: false, error: errMsg || 'Recording failed' });
      }
    }
    if (message.type === 'ECHO_OFFSCREEN_STOP') {
      try {
        await stopRecording();
        sendResponse({ ok: true });
      } catch (e) {
        sendResponse({ ok: false, error: e?.message || String(e) });
      }
    }
  })();
  return true;
});

async function startRecording(streamId, sessionId, monitorEnabled = false, includeMic = false) {
  if (mediaRecorder && mediaRecorder.state === 'recording') {
    await stopRecording();
  }

  currentSessionId = sessionId;
  chunkSequenceNumber = 0; // Reset sequence number for new session

  // Use getUserMedia with tab capture (Chrome extension: mandatory chromeMediaSourceId from getMediaStreamId)
  if (!streamId || typeof streamId !== 'string') {
    throw new DOMException('Missing or invalid stream ID. Try starting again.', 'InvalidStateError');
  }
  const constraints = {
    audio: {
      mandatory: {
        chromeMediaSource: 'tab',
        chromeMediaSourceId: streamId
      }
    },
    video: false
  };
  tabStream = await navigator.mediaDevices.getUserMedia(constraints);

  // Optional: also capture microphone and mix it with tab audio.
  // This will trigger a mic permission prompt.
  if (includeMic) {
    micStream = await navigator.mediaDevices.getUserMedia({
      audio: true,
      video: false
    });
  }

  // Build the stream we will actually record:
  // - tab only, OR
  // - tab + mic mixed together via WebAudio
  mixedStream = tabStream;
  if (includeMic && micStream) {
    // Use low-latency hint to reduce audio delay vs video when mixing.
    const audioContext = new AudioContext({ latencyHint: 'interactive' });
    const destination = audioContext.createMediaStreamDestination();

    const tabSource = audioContext.createMediaStreamSource(tabStream);
    tabSource.connect(destination);

    const micSource = audioContext.createMediaStreamSource(micStream);
    micSource.connect(destination);

    await audioContext.resume().catch(() => {});
    window.echoMixContext = audioContext;
    window.echoMixNodes = { tabSource, micSource, destination };
    mixedStream = destination.stream;
  }

  // Start recording immediately to minimize audio-video delay (no setup after this before start).
  const mimeType = MediaRecorder.isTypeSupported('audio/webm') ? 'audio/webm' : '';
  mediaRecorder = new MediaRecorder(mixedStream, mimeType ? { mimeType } : {});

  mediaRecorder.ondataavailable = async (event) => {
    if (event.data && event.data.size > 0) {
      chunks.push(event.data);
    }
  };

  flushDonePromise = new Promise((r) => { resolveFlushDone = r; });
  mediaRecorder.onstop = async () => {
    try {
      if (chunks.length > 0) {
        await flushChunks(true);
      } else {
        const sid = currentSessionId;
        if (sid) {
          const emptyBlob = new Blob([], { type: mediaRecorder?.mimeType || 'audio/webm' });
          const seq = chunkSequenceNumber++;
          await saveChunk(sid, emptyBlob, seq);
          await uploadChunkToApi(sid, seq, emptyBlob);
        }
      }
    } catch (e) {
      console.error('Echo onstop flush failed:', e);
    } finally {
      chunks = [];
      await new Promise((r) => setTimeout(r, 100));
      resolveFlushDone();
    }
  };

  mediaRecorder.start(100);
  chunkIntervalId = setInterval(() => flushChunks(false).catch(console.error), CHUNK_INTERVAL_MS);

  // Optional monitor: play tab audio so user can hear (Chrome may mute tab when capturing).
  // Use Web Audio with minimal buffer so pause/stop stops quickly; no <audio> element.
  if (monitorEnabled) {
    try {
      const ctx = new AudioContext({ latencyHint: 'interactive' });
      const src = ctx.createMediaStreamSource(tabStream);
      src.connect(ctx.destination);
      await ctx.resume();
      window.echoMonitorContext = ctx;
    } catch (e) {
      console.warn('Echo monitor (speakers) failed:', e);
    }
  }

  try {
    analyserContext = new AudioContext();
    const source = analyserContext.createMediaStreamSource(mixedStream);
    analyserNode = analyserContext.createAnalyser();
    analyserNode.fftSize = 256;
    analyserNode.smoothingTimeConstant = 0.6;
    source.connect(analyserNode);
    await analyserContext.resume();
    const dataArray = new Uint8Array(analyserNode.frequencyBinCount);
    analyserIntervalId = setInterval(() => {
      if (!analyserNode) return;
      analyserNode.getByteFrequencyData(dataArray);
      const sum = dataArray.reduce((a, b) => a + b, 0);
      const level = dataArray.length ? sum / dataArray.length / 255 : 0;
      storageLocal.set({ echoLastAudioLevel: level }).catch(() => {});
    }, 150);
  } catch (e) {
    console.warn('Echo audio analyser failed:', e);
  }
}

async function stopRecording() {
  if (!mediaRecorder) return;

  if (chunkIntervalId) {
    clearInterval(chunkIntervalId);
    chunkIntervalId = null;
  }
  if (analyserIntervalId) {
    clearInterval(analyserIntervalId);
    analyserIntervalId = null;
  }
  if (analyserContext) {
    try {
      await analyserContext.close();
    } catch {}
    analyserContext = null;
    analyserNode = null;
  }
  storageLocal.set({ echoLastAudioLevel: 0 }).catch(() => {});

  // IMPORTANT:
  // If we don't wait for the recorder "stop" event, Chrome may still consider the
  // tabCapture stream active, and the next start will fail with:
  // "Cannot capture a tab with an active stream."
  if (mediaRecorder.state === 'recording') {
    // Ensure we have at least one final dataavailable event, even for very short recordings.
    try {
      mediaRecorder.requestData();
    } catch {}
    // Wait for final ondataavailable (timeslice is 100ms, so 250ms is enough).
    await new Promise((r) => setTimeout(r, 250));

    await new Promise((resolve) => {
      const onStop = () => resolve();
      mediaRecorder.addEventListener('stop', onStop, { once: true });
      mediaRecorder.stop();
    });
    // Wait for onstop handler to finish saving to IndexedDB before we return (and background might close us).
    await flushDonePromise;
  }

  // Stop monitor playback first so no audio continues after pause/stop.
  if (window.echoMonitorContext) {
    try {
      await window.echoMonitorContext.close();
    } catch {}
    window.echoMonitorContext = null;
  }

  if (window.echoMixContext) {
    try {
      await window.echoMixContext.close();
    } catch {}
    window.echoMixContext = null;
    window.echoMixNodes = null;
  }

  // Stop all tracks to release resources
  try {
    if (mediaRecorder.stream) {
      mediaRecorder.stream.getTracks().forEach(track => track.stop());
    }
  } catch {}

  if (tabStream) {
    tabStream.getTracks().forEach(t => t.stop());
    tabStream = null;
  }
  if (micStream) {
    micStream.getTracks().forEach(t => t.stop());
    micStream = null;
  }
  mixedStream = null;

  mediaRecorder = null;

  // Keep popup state accurate even if the MV3 service worker sleeps.
  try {
    const { echoCurrentSession } = await storageLocal.get('echoCurrentSession');
    if (echoCurrentSession) {
      await storageLocal.set({
        echoCurrentSession: { ...echoCurrentSession, isRecording: false }
      });
    }
  } catch {}
}

/** Upload one chunk to Echo API so ChunkCount > 0 and worker is triggered on finish-session. */
async function uploadChunkToApi(sessionId, sequenceNumber, blob) {
  if (!apiBaseUrl) return;
  const form = new FormData();
  form.append('sessionId', sessionId);
  form.append('sequenceNumber', String(sequenceNumber));
  form.append('file', blob, `chunk_${sequenceNumber}.webm`);
  try {
    const headers = {};
    if (authToken) headers['Authorization'] = 'Bearer ' + authToken;
    const res = await fetch(`${apiBaseUrl}/echo/upload-chunk`, { method: 'POST', headers, body: form });
    if (!res.ok) {
      console.warn('Echo API upload-chunk failed:', res.status, await res.text());
      const { echoPendingUploads = [] } = await storageLocal.get('echoPendingUploads');
      echoPendingUploads.push({ sessionId, sequenceNumber });
      await storageLocal.set({ echoPendingUploads });
    }
  } catch (e) {
    console.warn('Echo API upload-chunk error:', e);
    const { echoPendingUploads = [] } = await storageLocal.get('echoPendingUploads');
    echoPendingUploads.push({ sessionId, sequenceNumber });
    await storageLocal.set({ echoPendingUploads });
  }
}

/** PRD: If internet fails, audio is saved locally and uploads when online. */
async function retryPendingUploads() {
  if (!apiBaseUrl) return;
  const { echoPendingUploads = [] } = await storageLocal.get('echoPendingUploads');
  if (echoPendingUploads.length === 0) return;
  const remaining = [];
  for (const { sessionId, sequenceNumber } of echoPendingUploads) {
    try {
      const blob = await getChunk(sessionId, sequenceNumber);
      if (!blob) continue;
      const form = new FormData();
      form.append('sessionId', sessionId);
      form.append('sequenceNumber', String(sequenceNumber));
      form.append('file', blob, `chunk_${sequenceNumber}.webm`);
      const headers = {};
      if (authToken) headers['Authorization'] = 'Bearer ' + authToken;
      const res = await fetch(`${apiBaseUrl}/echo/upload-chunk`, { method: 'POST', headers, body: form });
      if (!res.ok) remaining.push({ sessionId, sequenceNumber });
    } catch (e) {
      remaining.push({ sessionId, sequenceNumber });
    }
  }
  await storageLocal.set({ echoPendingUploads: remaining });
}

async function flushChunks(isFinal) {
  await retryPendingUploads();

  if (!chunks.length || !currentSessionId) return;

  const blobType = mediaRecorder?.mimeType || 'audio/webm';
  const blob = new Blob(chunks, { type: blobType });
  chunks = [];

  try {
    // Save to IndexedDB (can handle large files, unlike chrome.storage.local)
    await saveChunk(currentSessionId, blob, chunkSequenceNumber++);
    
    console.log(`Saved chunk ${chunkSequenceNumber - 1} for session ${currentSessionId}, size: ${(blob.size / 1024 / 1024).toFixed(2)} MB`);
    
    // Notify background script that a chunk was saved (for UI updates)
    chrome.runtime.sendMessage({
      type: 'ECHO_CHUNK_SAVED',
      sessionId: currentSessionId,
      chunkNumber: chunkSequenceNumber - 1,
      size: blob.size
    }).catch(() => {}); // Ignore errors if background script isn't listening
    
    // Upload to Echo API so ChunkCount > 0 and worker is triggered on finish-session (even empty blobs).
    await uploadChunkToApi(currentSessionId, chunkSequenceNumber - 1, blob);
  } catch (err) {
    console.error('Failed to save chunk to IndexedDB:', err);
  }
}


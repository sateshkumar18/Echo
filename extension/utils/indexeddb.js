// IndexedDB helper for storing audio chunks
// This can handle GBs of data (unlike chrome.storage.local which has a 10MB limit)

const DB_NAME = 'EchoRecorderDB';
const DB_VERSION = 1;
const STORE_NAME = 'audioChunks';

let db = null;

export async function initDB() {
  if (db) return db;

  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      db = request.result;
      resolve(db);
    };

    request.onupgradeneeded = (event) => {
      const database = event.target.result;
      if (!database.objectStoreNames.contains(STORE_NAME)) {
        const objectStore = database.createObjectStore(STORE_NAME, { keyPath: 'id', autoIncrement: true });
        objectStore.createIndex('sessionId', 'sessionId', { unique: false });
        objectStore.createIndex('timestamp', 'timestamp', { unique: false });
      }
    };
  });
}

export async function saveChunk(sessionId, blob, sequenceNumber) {
  const database = await initDB();
  const arrayBuffer = await blob.arrayBuffer();
  const uint8Array = new Uint8Array(arrayBuffer);

  const chunkData = {
    sessionId,
    sequenceNumber,
    timestamp: Date.now(),
    data: Array.from(uint8Array),
    size: blob.size,
    mimeType: blob.type
  };

  return new Promise((resolve, reject) => {
    const transaction = database.transaction([STORE_NAME], 'readwrite');
    const store = transaction.objectStore(STORE_NAME);
    const request = store.add(chunkData);

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export async function getChunksBySession(sessionId) {
  const database = await initDB();
  
  return new Promise((resolve, reject) => {
    const transaction = database.transaction([STORE_NAME], 'readonly');
    const store = transaction.objectStore(STORE_NAME);
    const index = store.index('sessionId');
    const request = index.getAll(sessionId);

    request.onsuccess = () => {
      const chunks = request.result.sort((a, b) => a.sequenceNumber - b.sequenceNumber);
      resolve(chunks);
    };
    request.onerror = () => reject(request.error);
  });
}

/** Get one chunk by session and sequence (for offline upload retry). Returns Blob or null. */
export async function getChunk(sessionId, sequenceNumber) {
  const chunks = await getChunksBySession(sessionId);
  const chunk = chunks.find((c) => c.sequenceNumber === sequenceNumber);
  if (!chunk) return null;
  const blob = new Blob([new Uint8Array(chunk.data)], { type: chunk.mimeType || 'audio/webm' });
  return blob;
}

export async function getAllSessions() {
  const database = await initDB();
  
  return new Promise((resolve, reject) => {
    const transaction = database.transaction([STORE_NAME], 'readonly');
    const store = transaction.objectStore(STORE_NAME);
    const request = store.getAll();

    request.onsuccess = () => {
      // Group by sessionId
      const sessionsMap = new Map();
      request.result.forEach(chunk => {
        if (!sessionsMap.has(chunk.sessionId)) {
          sessionsMap.set(chunk.sessionId, {
            sessionId: chunk.sessionId,
            chunks: [],
            totalSize: 0,
            firstChunkTime: chunk.timestamp,
            lastChunkTime: chunk.timestamp
          });
        }
        const session = sessionsMap.get(chunk.sessionId);
        session.chunks.push(chunk);
        session.totalSize += chunk.size;
        if (chunk.timestamp < session.firstChunkTime) {
          session.firstChunkTime = chunk.timestamp;
        }
        if (chunk.timestamp > session.lastChunkTime) {
          session.lastChunkTime = chunk.timestamp;
        }
      });
      const sessions = Array.from(sessionsMap.values());
      sessions.sort((a, b) => b.firstChunkTime - a.firstChunkTime);
      resolve(sessions);
    };
    request.onerror = () => reject(request.error);
  });
}

export async function deleteSession(sessionId) {
  const database = await initDB();
  
  return new Promise((resolve, reject) => {
    const transaction = database.transaction([STORE_NAME], 'readwrite');
    const store = transaction.objectStore(STORE_NAME);
    const index = store.index('sessionId');
    const request = index.openKeyCursor(sessionId);

    request.onsuccess = (event) => {
      const cursor = event.target.result;
      if (cursor) {
        store.delete(cursor.primaryKey);
        cursor.continue();
      } else {
        resolve();
      }
    };
    request.onerror = () => reject(request.error);
  });
}

export async function downloadSessionAsFile(sessionId) {
  const chunks = await getChunksBySession(sessionId);
  if (chunks.length === 0) {
    throw new Error('No chunks found for this session');
  }

  // Convert chunks back to Blobs and merge them
  const blobParts = chunks.map(chunk => {
    const uint8Array = new Uint8Array(chunk.data);
    return uint8Array;
  });

  const mergedBlob = new Blob(blobParts, { type: chunks[0].mimeType || 'audio/webm' });
  
  // Create download link
  const url = URL.createObjectURL(mergedBlob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `echo_recording_${sessionId}_${new Date(chunks[0].timestamp).toISOString().split('T')[0]}.webm`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

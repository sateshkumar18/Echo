# 📜 PRD: Echo (The Unlimited Meeting Recorder)

**Version:** 1.0 (Hybrid Architecture)  
**Status:** 🔒 Locked for Development  
**Engine:** Audio Spy (Engine 2)

---

## 1. Product Overview

Echo is a browser-based utility that allows users to **record unlimited audio** from any browser tab (Zoom, Google Meet, Teams, YouTube), **transcribe** it, and generate **"Boss Summaries"** with action items.

### The Business Model

| Tier | Limit | Queue |
|------|--------|--------|
| **Free** | Capped at 3 hours/month | Standard Queue |
| **Arcade Pass** ($9/mo) / **Echo Pro** ($5/mo) | Unlimited recording | Priority AI processing |

---

## 2. Actors & System Definitions

| Actor / System | Description | Tech Stack |
|----------------|-------------|------------|
| **User (Worker/Student)** | The person in the meeting. Wants to hit "Record" and forget about it. | Chrome Extension |
| **The Extension (The Ear)** | Captures the tab's audio stream and sends data chunks to the server. | JavaScript (Chrome API) |
| **The Manager (API)** | Manages User Auth, Credits, and creates the "Recording Session". | .NET 8 (C#) |
| **The Bridge** | Buffers incoming audio chunks to prevent data loss. | Redis / WebSockets |
| **The Worker (AI)** | Runs the heavy AI models to transcribe and summarize. | Python 3.10 (GPU/CPU) |
| **The Dashboard (Web)** | Where users read summaries and download transcripts. | Next.js (React) |

---

## 3. User Flow & Technical Interaction

### Phase 1: The Capture (Extension)

1. User clicks the Arcade Extension icon while on a Zoom/Meet tab.
2. User clicks **"🔴 Start Recording"**.
3. Extension requests `tabCapture` permission.
4. Extension starts a **MediaRecorder** instance in the background.
5. **Critical:** It visualizes a **"Red Dot" or Timer overlay** so the user knows it's working.

### Phase 2: The Stream (Data Transport)

Chunked Upload method (v1) for stability.

1. Extension records audio in **5-minute chunks** (blobs).
2. Every 5 minutes (or when stopped), Extension sends the blob to .NET API (**POST /echo/upload-chunk**).
3. **Why chunks?** If the browser crashes after 2 hours, we don't lose the first 1 hour 55 mins.
4. .NET API appends these chunks to a temporary file in **MinIO (S3)**.

### Phase 3: The Brain (AI Processing)

1. User clicks **"⏹ Stop Recording"**.
2. Extension sends final "Stop" signal to .NET API.
3. .NET API creates a **Job Ticket in Redis Queue** (`queue:echo`).
4. Python Worker grabs the ticket.
5. Python Worker downloads all audio chunks and **merges** them into one .wav file (using **FFmpeg**).
6. **AI Pipeline Execution:**
   - **Step 1 (Transcribe):** Run **Whisper Large-v3** (GPU). Output: Full Text with Timestamps.
   - **Step 2 (Summarize):** Feed text to **Llama-3-8B** (CPU/GPU).
     - **Prompt:** "Summarize this meeting into: 1. Key Decisions, 2. Action Items, 3. Next Steps."
   - Python Worker saves **JSON result** (Transcript + Summary) to **PostgreSQL**.

### Phase 4: The Review (Web Dashboard)

1. User receives a **browser notification:** "✅ Meeting is ready."
2. User clicks and opens the **Next.js Dashboard**.
3. User sees:
   - **Audio Player** (to listen back).
   - **"Boss Summary"** (bullet points).
   - **Full Transcript** (searchable).
4. User **exports to PDF/Notion**.

---

## 4. Technical Specifications

### A. Chrome Extension (Dev 5)

- **Permission:** `tabCapture` (Captures system audio from the active tab).
- **Format:** Record in **audio/webm** (Standard for Chrome).
- **Safety:** Use **IndexedDB** locally to store chunks before upload. If internet fails, the audio is saved locally and uploads when online.

### B. Backend API (Dev 2 – .NET)

**Endpoints:**

- **POST /echo/start-session** — Returns `session_id`.
- **POST /echo/upload-chunk** — Accepts binary audio data + `session_id` + `sequence_number`.
- **POST /echo/finish-session** — Triggers the AI job.

**Storage:** MinIO bucket `echo-raw-audio`.

### C. AI Worker (Dev 3 & 4 – Python)

**Models:**

- **Whisper:** Use **faster-whisper** implementation for 4x speed on GPU.
- **Llama-3:** Use **Ollama** or **vLLM** for fast summarization.

**Handling Long Context:**

- If transcript **> 8,000 tokens**, split it into parts, summarize each part, then **summarize the summaries** (Map-Reduce strategy).

---

## 5. What to Watch For (Risks & Guardrails)

### Browser Memory Leaks (The 3-Hour Crash)

- **Risk:** Keeping a 3-hour recording in Chrome RAM will crash the browser.
- **Fix:** Must implement **Chunking**. Do not keep the full blob in memory. Flush to IndexedDB or Server every 5 minutes.

### "Silent" Recordings

- **Risk:** User thinks they are recording, but the tab is muted or the wrong audio device is selected.
- **Fix:** **Audio Visualizer.** The Extension popup MUST show a moving waveform bar. If the bar is flat, show a warning: **"No Audio Detected!"**

### Privacy/Legal

- **Risk:** Recording people without consent.
- **Fix:** This is a "User Tool," not a "Bot." The user is responsible for consent. Add a **disclaimer** in the UI: *"You are responsible for notifying participants."* (Echo does not join the meeting as a bot; it records the tab).

---

## 6. Developer Assignments

| Dev | Focus |
|-----|--------|
| **Dev 5** (Growth/Extension) | Build the tabCapture logic. Implement the "Chunk & Upload" loop (Critical for stability). Build the **Audio Visualizer** UI in the popup. |
| **Dev 2** (.NET Backend) | Create the EchoSession table in Postgres. Build the endpoint to accept multipart audio chunks and append them to MinIO. |
| **Dev 4** (Text AI) | Build the Summarization Pipeline. Write the Python logic to handle "Context Window Overflow" (when meetings are too long for one Llama prompt). |
| **Dev 1** (Frontend) | Build the "Meeting Notebook" view in the Web App (Player + Text side-by-side). |

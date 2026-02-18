# Echo PRD – Implementation Checklist

This checklist maps the [official PRD](docs/PRD.md) to the codebase. Use it to see what’s done and what to add.

---

## 1. Product Overview

| PRD item | Status | Notes |
|----------|--------|--------|
| Free: 3 hr/month cap | ✅ Done | Enforced on finish-session (403 `FREE_LIMIT_EXCEEDED`) |
| Arcade Pass ($9/mo) / Echo Pro ($5/mo): unlimited | ✅ Done | Tier in DB; paid users skip minute cap |
| Standard vs Priority queue | ⬜ To add | Today: single worker; PRD calls out priority for paid – needs queue (Redis) + priority lanes |

---

## 2. Actors & System Definitions

| Actor | Status | Notes |
|-------|--------|--------|
| User + Extension (The Ear) | ✅ Done | Chrome extension, tab capture, chunk upload |
| Manager (API) | ✅ Done | .NET 8, auth, credits (free limit), sessions |
| **The Bridge** (Redis / WebSockets) | ⬜ To add | PRD: buffer chunks; current: API → Worker via HTTP. Add Redis queue for job tickets + optional buffering |
| Worker (AI) | ✅ Done | Python, Whisper, summarization (Ollama), save to PostgreSQL |
| Dashboard (Web) | ✅ Done | Next.js in `dashboard/`: sessions, Boss Summary, transcript, export .txt |

---

## 3. User Flow & Technical Interaction

### Phase 1: The Capture (Extension)

| PRD requirement | Status | Notes |
|-----------------|--------|--------|
| Start Recording, tabCapture, MediaRecorder | ✅ Done | background/offscreen recording |
| Red Dot or Timer overlay | ✅ Done | Timer in popup; red dot in UI |
| 5-minute chunks, POST /echo/upload-chunk | ✅ Done | Chunked upload loop |
| Chunks to MinIO (or disk) | ✅ Done | API appends to MinIO or `Data/Chunks` |
| IndexedDB safety (upload when online) | ✅ Done | Chunks stored locally; upload when API available |

### Phase 2: The Stream (Data Transport)

| PRD requirement | Status | Notes |
|-----------------|--------|--------|
| Chunked upload every 5 min or on stop | ✅ Done | Extension + API |
| .NET appends chunks to MinIO | ✅ Done | MinIO or disk storage |

### Phase 3: The Brain (AI Processing)

| PRD requirement | Status | Notes |
|-----------------|--------|--------|
| Stop → signal to .NET | ✅ Done | POST /echo/finish-session |
| **Job Ticket in Redis Queue (queue:echo)** | ⬜ To add | Currently: API HTTP POST to Worker. PRD: Redis job ticket; Worker pulls from queue |
| Worker: download chunks, merge .wav (FFmpeg) | ✅ Done | Worker merges chunks, outputs WAV |
| Whisper (Large-v3 / faster-whisper), timestamps | ✅ Done | faster-whisper; optional timestamps |
| Llama summarization (Key Decisions, Action Items, Next Steps) | ✅ Done | Ollama/summary pipeline |
| Save Transcript + Summary to PostgreSQL | ✅ Done | Worker updates session in DB |

### Phase 4: The Review (Web Dashboard)

| PRD requirement | Status | Notes |
|-----------------|--------|--------|
| Browser notification: "✅ Meeting is ready" | ⬜ To add | Extension or dashboard can show when session is ready |
| Next.js Dashboard | ✅ Done | `dashboard/`: list sessions, session detail |
| Audio Player | ⬜ To add | In dashboard (or link to API/asset URL) |
| Boss Summary (bullet points) | ✅ Done | Shown on session detail from GET /echo/session/{id} |
| Full Transcript (searchable) | ✅ Done | Search + highlight on session detail |
| Export to PDF/Notion | ✅ Partial | Export as .txt done; PDF/Notion optional later |

---

## 4. Technical Specifications

### A. Chrome Extension

| Spec | Status | Notes |
|------|--------|--------|
| tabCapture | ✅ Done | |
| audio/webm | ✅ Done | MediaRecorder format |
| IndexedDB for chunks before upload | ✅ Done | Offline safety |

### B. Backend API

| Spec | Status | Notes |
|------|--------|--------|
| POST /echo/start-session | ✅ Done | Returns sessionId |
| POST /echo/upload-chunk | ✅ Done | sessionId, sequenceNumber, file |
| POST /echo/finish-session | ✅ Done | Triggers worker (HTTP today; PRD wants Redis) |
| MinIO bucket echo-raw-audio | ✅ Done | Or disk if MinIO not configured |

### C. AI Worker

| Spec | Status | Notes |
|------|--------|--------|
| faster-whisper | ✅ Done | |
| Ollama / vLLM summarization | ✅ Done | Summary pipeline |
| Long context: Map-Reduce (>8k tokens) | ✅ Done | Worker segments long transcripts |

---

## 5. Risks & Guardrails (PRD §5)

| Risk | PRD fix | Status | Notes |
|------|---------|--------|--------|
| 3-hour crash (memory) | Chunking; flush to IndexedDB/server every 5 min | ✅ Done | Chunked recording + upload |
| Silent recordings | Audio visualizer; if flat → "No Audio Detected!" | ✅ Done | Popup has bars + "Tab may be silent" warning |
| Privacy/consent | Disclaimer: "You are responsible for notifying participants" | ✅ Done | In UI + terms checkbox |

---

## 6. Developer Assignments (PRD §6)

| Dev | PRD task | Status |
|-----|----------|--------|
| Dev 5 (Extension) | tabCapture, Chunk & Upload loop, Audio Visualizer | ✅ Done |
| Dev 2 (.NET) | EchoSession table, multipart chunks to MinIO | ✅ Done |
| Dev 4 (Text AI) | Summarization pipeline, context overflow (Map-Reduce) | ✅ Done |
| Dev 1 (Frontend) | "Meeting Notebook" (Player + Text side-by-side) | ✅ Done |

---

## Summary: What to Add (by PRD)

1. **Redis Bridge (Phase 3)**  
   - Replace HTTP trigger with **Redis queue** (`queue:echo`).  
   - API: on finish-session, enqueue job ticket; Worker: poll or subscribe and process.  
   - Optional: priority lane for Arcade Pass / Echo Pro.

2. **Payments**  
   - Stripe (or similar) for Arcade Pass ($9/mo) and Echo Pro ($5/mo).  
   - Webhook to set `subscription_tier` in DB.

3. **Next.js Dashboard (Phase 4)**  
   - ✅ Auth (login with API, JWT in localStorage).  
   - ✅ List sessions (`GET /echo/sessions`).  
   - ✅ Session detail: Boss Summary, Full Transcript (searchable), Export .txt.  
   - ⬜ Audio Player (optional).  
   - ⬜ Export PDF/Notion (optional; .txt done).  
   - ⬜ "Meeting is ready" notification (optional).

4. **Optional: Priority queue**  
   - When Redis is in place, prioritize jobs for paid users (Arcade Pass / Echo Pro).

Reference: [docs/PRD.md](docs/PRD.md).

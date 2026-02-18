# 📘 Project Documentation – Echo

---

# 1. Project Overview

## 1.1 Purpose
Echo is a meeting notebook: it records tab audio (e.g. Zoom, Google Meet, YouTube) via a Chrome extension, uploads chunks to a .NET API, and an AI worker transcribes and summarizes sessions. Users view transcripts and “Boss Summary” (key decisions, action items, next steps) in the extension’s Recordings tab or in a Next.js dashboard.

## 1.2 Problem Statement
Users need a simple way to capture meeting audio from the browser, get accurate transcripts, and concise summaries without manually uploading files or switching tools. Echo solves this with a single-click recording flow, chunked upload, and automated Whisper + LLM processing.

## 1.3 High-Level Summary
1. User installs the Chrome extension and logs in (or registers) against the Echo API.  
2. On a meeting tab, the user clicks **Start Recording**; the extension captures tab audio with MediaRecorder, splits it into 5-minute chunks, and uploads them to the API (stored on disk or MinIO).  
3. When the user clicks **Stop Recording**, the extension calls the API to finish the session; the API marks the session as Finished and triggers the Python worker via HTTP.  
4. The worker merges chunks (FFmpeg), transcribes with Whisper, summarizes with an LLM (Ollama), and writes transcript + summary back to PostgreSQL.  
5. The user sees sessions, transcript, and Boss Summary in the extension’s Recordings tab or in the web dashboard.

---

# 2. Tech Stack

| Layer | Technology | Purpose |
|-------|------------|----------|
| **API** | C# / .NET 8 | REST API: auth, sessions, chunk storage, worker trigger |
| **API** | ASP.NET Core | Web host, middleware, controllers |
| **Database** | PostgreSQL | Users (`echo_users`), sessions (`echo_sessions`) |
| **ORM** | Entity Framework Core (Npgsql) | DbContext, migrations/EnsureCreated |
| **Worker** | Python 3.11+ | Flask HTTP server; process_session: FFmpeg, Whisper, LLM |
| **Worker** | faster-whisper, Ollama | Transcription and summarization |
| **Extension** | Chrome Extension (JS) | Popup UI, background script, offscreen document, tab capture, IndexedDB |
| **Dashboard** | Next.js 14, React 18, TypeScript | Login, sessions list, session detail (transcript, summary, export) |
| **Authentication** | JWT (Bearer) | Issued by API on login/register; validated on Echo routes |
| **Storage** | Disk or MinIO (S3-compatible) | Audio chunks (API writes; worker reads) |
| **Hosting** | Configurable | API and Worker can run on VPS/cloud; same DB for local and production |

---

# 3. Project Structure

```
Echo1.0/
├── api/                    # .NET 8 Web API
│   ├── Program.cs          # Entry point, DI, middleware, routes
│   ├── Controllers/        # AuthController, EchoController, PaymentsController, StripeWebhookController
│   ├── Data/               # EchoDbContext
│   ├── Models/             # EchoUser, EchoSession
│   ├── Services/           # IChunkStorage, DiskChunkStorage, MinioChunkStorage, WorkerTrigger
│   ├── Swagger/            # FormFileSchemaFilter
│   ├── appsettings.json, appsettings.Development.example.json, appsettings.Production.json
│   └── Scripts/            # SQL scripts (create tables, add users/auth)
├── worker/                 # Python AI worker
│   ├── app.py              # Flask app: /health, /process (entry for processing)
│   ├── config.py           # DB URL, chunk path, Whisper/MinIO env
│   ├── process_session.py # Merge → Whisper → summarize → DB update
│   ├── summarizer.py       # LLM summarization (Ollama)
│   └── .env.example, env-setup.md
├── extension/              # Chrome extension
│   ├── manifest.json
│   ├── background.js       # Session lifecycle, messaging, worker trigger coordination
│   ├── popup/              # popup.html, popup.js, popup.css (login, recording UI, Recordings tab)
│   └── offscreen/          # offscreen.html, offscreen.js (MediaRecorder, tab capture)
├── dashboard/             # Next.js app
│   ├── app/                # layout.tsx, page.tsx, login/page.tsx, sessions/page.tsx, sessions/[id]/page.tsx
│   ├── lib/                # api.ts, auth.ts
│   └── package.json
├── docs/                   # PRD.md, SESSION-STATUS.md, PAYMENTS.md
├── RUN-LOCALLY.md
├── PRODUCTION.md
└── run-api.ps1, run-worker.ps1
```

## Folder Responsibilities

| Folder | Responsibility |
|--------|-----------------|
| **api/Controllers** | Handle HTTP: validate request, call DbContext/Services, return response. |
| **api/Services** | Business logic: chunk storage (disk/MinIO), trigger worker HTTP call. |
| **api/Data** | EF Core DbContext; no “repository” layer – controllers use DbContext directly. |
| **api/Models** | Entity and DTO classes (EchoUser, EchoSession, request/response types). |
| **api** | No dedicated middleware folder; auth is JWT Bearer; global exception handler in Program.cs. |
| **api** | Config: appsettings + environment variables. |
| **worker** | Single process: Flask serves /process; process_session does all pipeline steps. |
| **extension** | Popup = UI; background = orchestration; offscreen = capture/record. |
| **dashboard** | App Router pages; lib = API client and auth (localStorage token). |

---

# 4. Application Entry Points

## 4.1 API – Main File
**File:** `api/Program.cs`

**What happens:**
1. `WebApplication.CreateBuilder(args)` loads configuration (appsettings + env).
2. Services: Controllers, Swagger, DbContext (Npgsql), MinIO or Disk chunk storage, HttpClient, WorkerTrigger, JWT Bearer auth, CORS.
3. `EnsureCreatedAsync()` on DbContext so tables exist.
4. Middleware: CORS → Authentication → Authorization → Exception handler (returns 500 JSON, hides details in production).
5. Routes: `GET /` → redirect to Swagger (if enabled); `MapControllers()` for `/auth/*`, `/echo/*`, etc.
6. `app.Run()` – Kestrel listens (e.g. port 5012).

## 4.2 Worker – Main File
**File:** `worker/app.py`

**What happens:**
1. Logging and Hugging Face verbosity set.
2. Flask app created; `/health` and `/process` (POST/GET) registered.
3. `/process` validates `sessionId`, deduplicates (thread lock), starts a background thread running `process_session(session_id)`, returns 202 Accepted.
4. `app.run(host="0.0.0.0", port=WORKER_PORT)` (default 5050).

## 4.3 Extension
**Entry:** `extension/manifest.json` → background script `background.js`; popup opens `popup/popup.html` (loads popup.js). Offscreen document `offscreen/offscreen.html` is created by background when recording starts.

## 4.4 Dashboard
**Entry:** Next.js dev server (`npm run dev`) or `next start` – `dashboard/app/layout.tsx` and `app/page.tsx` (and app router pages).

---

# 5. Application Execution Flow (Step-by-Step)

## 5.1 API Request Lifecycle
1. Client sends request (e.g. Extension or Dashboard with `Authorization: Bearer <JWT>`).
2. Kestrel receives; CORS runs; JWT middleware validates token (on protected routes).
3. Router matches (e.g. `POST /echo/finish-session`) → `EchoController.FinishSession`.
4. Controller reads `SessionId` from body, gets `UserId` from JWT, loads/creates session, enforces free-tier cap (3 hr/month), saves `FinishedAt` and `Status = "Finished"`, calls `WorkerTrigger.Trigger(session.Id)` (fire-and-forget HTTP POST to worker).
5. Controller returns 200 + `{ finished: true, sessionId }`.
6. No repository layer: Controller uses `EchoDbContext` and `IChunkStorage` / `WorkerTrigger` directly.

## 5.2 Worker Processing Lifecycle
1. API POSTs to `http://<Worker>:5050/process?sessionId=<guid>`.
2. Worker returns 202 immediately; a thread runs `process_session(session_id)`.
3. `process_session`: sets `status = 'Processing'` in DB; loads chunks from disk or MinIO; merges with FFmpeg; runs Whisper (faster-whisper); runs summarizer (Ollama); updates `echo_sessions` with `transcript`, `summary`, `status = 'Completed'`, `processed_at` (or `Failed` + `error_message`).

## 5.3 Extension Recording Flow
1. User clicks Start → popup sends message to background → background creates offscreen document, gets tab capture, starts MediaRecorder.
2. Chunks (e.g. 5 min) are stored in IndexedDB, then uploaded via `POST /echo/upload-chunk` (with JWT).
3. On Stop → background stops recorder, uploads final chunk, calls `POST /echo/finish-session`; API marks session Finished and triggers worker.

---

# 6. Architecture Overview

## 6.1 Architectural Pattern
- **API:** Layered: Controllers → DbContext / Services. No formal repository layer; EF Core is used directly in controllers.
- **Worker:** Single module: HTTP endpoint + one pipeline function (`process_session`).
- **Extension:** Message-based: popup ↔ background ↔ offscreen; background coordinates capture and API calls.
- **Dashboard:** Next.js App Router; server/client components; lib layer for API and auth.

## 6.2 Dependency Flow

**API:**
```
Controller → EchoDbContext (DB)
Controller → IChunkStorage (save chunks)
Controller → WorkerTrigger (HTTP to worker)
```

**Worker:**
```
Flask /process → process_session() → config (DB URL, paths), summarizer, DB (psycopg), FFmpeg, Whisper
```

---

# 7. Database Flow

## 7.1 Connection
- **API:** Connection string from `appsettings.json` / `appsettings.Development.json` → `ConnectionStrings:EchoDb`. Npgsql with retry and 60s command timeout.
- **Worker:** `ECHO_DATABASE_URL` (env or `.env`) or parsed from `api/appsettings.Development.json`; same PostgreSQL database as API. psycopg for raw SQL updates.

## 7.2 Schema
- **API:** EF Core `EnsureCreatedAsync()` on startup (or run `api/Scripts/*.sql` manually). Tables: `echo_users`, `echo_sessions`.
- **Worker:** Does not create schema; only UPDATE/SELECT on `echo_sessions` (and reads chunk files from disk or MinIO).

## 7.3 Data Lifecycle (Sessions)
- **Create:** Extension calls `POST /echo/start-session` (or first `upload-chunk` creates session) → API inserts `echo_sessions` with `Status = 'Recording'`.
- **Read:** Extension/Dashboard call `GET /echo/sessions` and `GET /echo/session/{id}`; API reads from DbContext.
- **Update:** Extension uploads chunks → API updates `ChunkCount`; `POST /echo/finish-session` sets `FinishedAt`, `Status = 'Finished'`; Worker sets `Status = 'Processing'` then `'Completed'` or `'Failed'`, and writes `transcript`, `summary`, `processed_at`, `error_message`.
- **Delete:** Not implemented (sessions are kept).

---

# 8. API Structure

## 8.1 Routing

| Method | Route | Auth | Purpose |
|--------|--------|------|--------|
| POST | /auth/register | No | Register user (email, password, displayName) |
| POST | /auth/login | No | Login → JWT + user info |
| GET | /echo/health | No | DB connectivity check |
| POST | /echo/start-session | JWT | Create session, return sessionId |
| POST | /echo/upload-chunk | JWT | Upload one audio chunk (form: sessionId, sequenceNumber, file) |
| POST | /echo/finish-session | JWT | Mark session Finished, trigger worker |
| GET | /echo/sessions | JWT | List current user’s sessions |
| GET | /echo/session/{id} | JWT | Session detail (transcript, summary) |
| (Payments/Stripe) | /payments/*, /webhooks/stripe | As per controller | Subscriptions / webhooks |

## 8.2 Controller Responsibility
- Validate input and JWT (via `[Authorize]` and `GetCurrentUserId()`).
- Use `EchoDbContext` for reads/writes; use `IChunkStorage` for chunk files; call `WorkerTrigger.Trigger(sessionId)` after finish-session.
- Return appropriate status codes and DTOs.

## 8.3 Middleware / Global Behavior
- **Authentication:** JWT Bearer; `[AllowAnonymous]` on auth and health.
- **Exception handler:** Catches unhandled exceptions; 500 JSON; message hidden in production.
- **CORS:** Configurable `AllowedOrigins`; dev allows localhost and chrome-extension.

---

# 9. Environment & Configuration

## 9.1 API (appsettings + env)

| Key | Purpose |
|-----|--------|
| ConnectionStrings:EchoDb | PostgreSQL connection string |
| Auth:JwtSecret / JWT_SECRET | Min 32 chars; used to sign JWT |
| Auth:JwtIssuer, Auth:JwtAudience | Token validation |
| Worker:Url | Base URL of worker (e.g. http://localhost:5050) |
| MinIO:Endpoint, AccessKey, SecretKey, Bucket | If set, chunks stored in MinIO; else ChunkStorage:Path (disk) |
| Cors:AllowedOrigins | Production origins (dashboard + extension) |
| Cors:SwaggerInProduction | Allow Swagger in prod (default false) |

## 9.2 Worker (env / .env)

| Variable | Purpose |
|----------|--------|
| ECHO_DATABASE_URL | PostgreSQL URL (same DB as API). Required in production. |
| ECHO_CHUNK_BASE_PATH | Where API stores chunks (default: ../api/Data/Chunks) |
| ECHO_WORKER_PORT | Flask port (default 5050) |
| ECHO_WHISPER_MODEL, ECHO_WHISPER_DEVICE | Whisper model and device (e.g. cuda) |
| ECHO_MINIO_* | If API uses MinIO, worker uses same to download chunks |
| LOG_LEVEL | INFO / WARNING etc. |

## 9.3 Dashboard
- `NEXT_PUBLIC_ECHO_API_URL` or user-entered API URL stored in localStorage (`echo_api_url`). Token stored in localStorage after login.

## 9.4 Configuration Flow
- API: ASP.NET Core configuration (appsettings + env vars; env override).
- Worker: `config.py` reads env and optionally `api/appsettings.Development.json` for DB URL.
- Extension: API base URL and JWT in `chrome.storage.local`.

---

# 10. Error Handling & Logging

## 10.1 API
- **Global:** `UseExceptionHandler`; 500 JSON; in production only generic message; in dev, exception message and server-side log.
- **Controllers:** Return 400/401/403/404/500 as appropriate; e.g. 403 with `FREE_LIMIT_EXCEEDED` when free tier exceeds 3 hr/month.

## 10.2 Worker
- Exceptions in `process_session` are logged; session is marked `Failed` with `error_message`; processing set is cleaned so session can be retried.
- Logging: Python `logging`; level from `LOG_LEVEL`.

## 10.3 Extension / Dashboard
- API errors surfaced in popup/dashboard (e.g. login error, 403 limit message). No centralized error handler; per-call handling.

---

# 11. Security Flow

- **Authentication:** JWT issued on login/register (BCrypt password verification). Stored in extension (`chrome.storage.local`) and dashboard (localStorage). Sent as `Authorization: Bearer <token>`.
- **Authorization:** Echo endpoints use `[Authorize]`; `GetCurrentUserId()` from JWT; session ownership checked (e.g. only own sessions for GET/POST).
- **Passwords:** BCrypt (work factor 12) in AuthController.
- **Input:** Validation in controllers (e.g. email/password length, sessionId format). File size limit on upload-chunk (100 MB).
- **Production:** JWT and DB from env; no secrets in repo; CORS restricted; Swagger off by default.

---

# 12. Application Startup Process (Deep Explanation)

**API:**
1. Runtime starts; `Program.cs` runs.
2. Builder loads config (appsettings + env).
3. DbContext, chunk storage (disk or MinIO), WorkerTrigger, JWT, CORS registered.
4. Build; then `EnsureCreatedAsync()` so DB and tables exist.
5. Middleware pipeline configured; routes mapped.
6. Kestrel binds to port (e.g. 5012); app is ready.

**Worker:**
1. Python runs `app.py`; config loaded from env (and optional appsettings.Development.json).
2. Flask app created; routes registered.
3. `app.run()` binds to 0.0.0.0:5050; ready to accept `/process` and `/health`.

**Extension:** Loaded by Chrome; background script starts; popup and offscreen load on user action.

**Dashboard:** `npm run dev` or `next start`; Next.js serves app and API proxy/config from env/localStorage.

---

# 13. Application Shutdown Process

- **API:** Ctrl+C or process stop; Kestrel stops accepting requests; in-process requests complete; DB connections disposed; process exits.
- **Worker:** Same; background threads may be daemon (process exit kills them).
- **Extension:** Browser closes or extension disabled.
- **Dashboard:** Process stop.

---

# 14. Deployment Process

## 14.1 Build

- **API:** `dotnet publish -c Release` (from `api/`).
- **Worker:** No build step; ensure Python deps installed (`pip install -r requirements.txt` or equivalent).
- **Dashboard:** `npm run build` in `dashboard/`; output in `.next`.
- **Extension:** Pack or “Load unpacked” from `extension/` folder.

## 14.2 Production Configuration
- API: Set `ASPNETCORE_ENVIRONMENT=Production`; set `ConnectionStrings__EchoDb`, `JWT_SECRET` (or `Auth__JwtSecret`), `Worker__Url`, MinIO if used, `Cors__AllowedOrigins`.
- Worker: Set `ECHO_DATABASE_URL` (required), MinIO vars if used, `LOG_LEVEL`.
- Use HTTPS and reverse proxy for API (and optionally worker); do not expose Kestrel directly.

## 14.3 Hosting
- API and Worker can run on same machine or separate (Worker URL must be reachable by API). Same PostgreSQL for both. Dashboard can be static export or Node server behind same domain. Extension is distributed via Chrome Web Store or sideload.

---

# 15. How to Run Locally

**Prerequisites:** .NET 8 SDK, Python 3.11+, Node 18+, PostgreSQL, Chrome (for extension). Optional: FFmpeg, Ollama for full worker pipeline.

**Steps:**
1. Clone repo; ensure PostgreSQL is running with a database (e.g. `Echo`).
2. **API:** Copy `api/appsettings.Development.example.json` to `api/appsettings.Development.json`; set `ConnectionStrings:EchoDb` and `Auth:JwtSecret` (min 32 chars). Run `.\run-api.ps1` from repo root (or `dotnet run` from `api/`).
3. **Worker:** Optionally set `worker/.env` with `ECHO_DATABASE_URL` (or leave unset to use same DB from API’s appsettings). From repo root run `.\run-worker.ps1` (or from `worker/`: `python app.py`).
4. **Extension:** Chrome → `chrome://extensions` → Load unpacked → select `extension` folder. Set API URL to `http://localhost:5012` in popup; register or log in.
5. **Dashboard (optional):** In `dashboard/`: `npm install` then `npm run dev`. Open http://localhost:3000; set API URL and log in.

**Test flow:** Start recording on a tab → stop → wait for worker to finish → open Recordings in extension or Dashboard to see transcript and Boss Summary.

---

# 16. Testing Strategy

- **Unit testing:** Not fully documented in repo; API controllers and Worker pipeline can be unit-tested with mocks (DbContext, IChunkStorage, WorkerTrigger).
- **Integration:** Manual or scripted: start API + Worker + DB; run through start-session → upload-chunk → finish-session → poll session until Completed.
- **API:** Swagger UI for ad-hoc calls (dev); Postman/curl with JWT for authenticated routes.
- **Extension:** Manual in Chrome; optional E2E with browser automation.

---

# 17. Performance Considerations

- **Chunks:** 5-minute chunks limit memory and allow incremental upload; IndexedDB in extension for offline resilience.
- **Worker:** Long sessions can be processed in segments (Whisper segment length, summary chunk cap) to bound memory and time.
- **DB:** Connection pooling (Npgsql default); retry on transient failures. Indexes on `user_id`, `created_at` for session list.
- **API:** Fire-and-forget worker trigger so finish-session responds quickly; no blocking on worker completion.

---

# 18. Common Issues & Debugging Tips

| Problem | Cause | Solution |
|--------|-------|----------|
| API won’t start | Missing/invalid appsettings.Development.json or DB | Copy example; set EchoDb and JwtSecret (min 32 chars). |
| DB connection failed | Wrong host/port/user/password | Check ConnectionStrings:EchoDb and PostgreSQL is running. |
| Worker “ECHO_DATABASE_URL not set” | Using remote DB without .env | Set ECHO_DATABASE_URL in worker/.env to same DB as API. |
| Extension can’t reach API | Wrong API URL or CORS | Set API URL to http://localhost:5012 (dev); ensure CORS allows chrome-extension. |
| Session stuck Recording/Finished | Worker not running or unreachable | Start worker; set Worker:Url in API config. |
| Session Failed | Whisper/FFmpeg/Ollama or DB error | Check worker logs and echo_sessions.error_message. |
| Free limit exceeded | > 3 hr in month on free tier | 403 with FREE_LIMIT_EXCEEDED; upgrade or wait for next month. |

---

# 19. Future Improvements

- Redis (or similar) job queue for worker instead of direct HTTP trigger; priority queue for paid users.
- “Meeting is ready” notification (browser or dashboard) when session becomes Completed.
- Audio playback in dashboard; export to PDF/Notion.
- Rate limiting on auth and upload endpoints; stricter CORS and worker auth in production.

---

# 20. Full System Summary (End-to-End Flow)

When the system starts: the API loads config and connects to PostgreSQL, ensures tables exist, and listens on its port. The worker loads config (same DB URL as API or from env), and Flask listens for `/process`. The extension is loaded by Chrome; the user sets the API URL and logs in, receiving a JWT stored in the extension.

When the user starts recording: the extension creates an offscreen document, captures the tab’s audio with MediaRecorder, and creates or reuses a session via the API. Every 5 minutes (and on stop) it uploads a chunk; the API saves it to disk or MinIO and updates the session’s chunk count. When the user stops, the extension calls finish-session; the API sets the session to Finished, enforces the free-tier cap, and triggers the worker with an HTTP POST. The worker returns 202 and processes in the background: it sets status to Processing, merges chunks (from disk or MinIO), transcribes with Whisper, summarizes with the LLM, and updates the session to Completed (or Failed with an error message). The user can then open the Recordings tab in the extension or the Dashboard, list sessions, and open a session to see the transcript and Boss Summary; the same JWT is used for all API calls. Shutdown is graceful: the API and worker stop accepting new work and close DB connections; the extension and dashboard stop when the browser or tab is closed.

---

# ✅ Conclusion

Echo is a meeting notebook that captures tab audio via a Chrome extension, stores it in chunk form through a .NET API (disk or MinIO), and uses a Python worker to transcribe (Whisper) and summarize (LLM) sessions, writing results back to a shared PostgreSQL database. The API handles auth (JWT), session lifecycle, and free-tier limits; the worker is triggered by HTTP and runs asynchronously. The extension and a Next.js dashboard consume the same API so users can record from the browser and review transcripts and Boss Summaries in either place. The structure separates capture (extension), orchestration and storage (API), and AI processing (worker), with one database and optional object storage for scalability. To maintain or extend: add API endpoints or worker steps in their respective codebases, keep DB schema in sync via API migrations or scripts, and configure env and CORS for production.

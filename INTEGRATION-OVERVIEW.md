# Echo – API Integration Overview

How the **Chrome Extension**, **Dashboard (Next.js)**, and **Worker (Python)** integrate with the **Echo API (ASP.NET Core)**.

---

## 1. High-Level Architecture

```
┌─────────────────────┐     HTTPS + JWT      ┌─────────────────────┐
│  Chrome Extension   │ ──────────────────►  │                     │
│  (popup, background,│                      │   Echo API           │
│   offscreen)        │ ◄──────────────────  │   (ASP.NET Core)   │
└─────────────────────┘                      │   /auth/*, /echo/*   │
                                             │                     │
┌─────────────────────┐     HTTPS + JWT      │   PostgreSQL        │
│  Dashboard          │ ──────────────────►  │   (sessions, users) │
│  (Next.js)          │ ◄──────────────────  │                     │
└─────────────────────┘                      └──────────┬──────────┘
                                                       │
                                                       │ HTTP POST (fire-and-forget)
                                                       ▼
                                             ┌─────────────────────┐
                                             │  Worker (Python)    │
                                             │  POST /process       │
                                             │  Whisper + LLM → DB  │
                                             └─────────────────────┘
```

- **Extension** and **Dashboard** talk only to the **API** (same base URL). They never call the Worker directly.
- **API** talks to **PostgreSQL** (sessions, users) and, after finish-session, calls the **Worker** at `Worker:Url` (e.g. `http://localhost:5050` or production worker URL).

---

## 2. Base URL and Authentication

| Client        | Base URL source                    | Auth |
|---------------|------------------------------------|------|
| **Extension** | User sets in popup; stored in `chrome.storage.local` as `echoApiBase` | JWT in `Authorization: Bearer <token>`; token from login/register, stored as `echoAuthToken`. |
| **Dashboard** | `localStorage.getItem('echo_api_url')` or `NEXT_PUBLIC_ECHO_API_URL` | JWT in `Authorization: Bearer <token>`; token from login, stored in localStorage. |
| **Worker**    | API calls Worker; URL from config `Worker:Url`. | No auth (today); in production you can add API key or VPN. |

**Example base URLs**

- Local: `http://localhost:5012`
- Production: `https://your-app.azurewebsites.net`

All requests below are relative to this base (e.g. `POST /auth/login`, `GET /echo/sessions`).

---

## 3. API Endpoints and Who Calls Them

### 3.1 Auth (no JWT required)

| Method | Endpoint           | Called by   | Purpose |
|--------|--------------------|------------|---------|
| POST   | `/auth/register`   | Extension, Dashboard | Create account; returns JWT + user. |
| POST   | `/auth/login`      | Extension, Dashboard | Sign in; returns JWT + user. |

### 3.2 Echo (JWT required)

| Method | Endpoint              | Called by   | Purpose |
|--------|------------------------|------------|---------|
| GET    | `/echo/health`        | Anyone (no auth) | DB connectivity check. |
| POST   | `/echo/start-session`  | Extension (background) | Start recording; returns `sessionId`. |
| POST   | `/echo/upload-chunk`   | Extension (offscreen) | Upload one audio chunk (form: SessionId, SequenceNumber, File). |
| POST   | `/echo/finish-session` | Extension (background) | Stop recording; API then triggers Worker. |
| GET    | `/echo/sessions`      | Extension, Dashboard | List current user’s sessions. |
| GET    | `/echo/session/{id}`  | Extension, Dashboard | Get one session (transcript, summary). |

### 3.3 Worker (called by API only)

| Method | Endpoint   | Called by | Purpose |
|--------|------------|-----------|---------|
| GET    | `/health`  | Optional  | Worker liveness. |
| POST   | `/process?sessionId=<guid>` | API (after finish-session) | Start processing; returns 202; runs Whisper + LLM and updates DB. |

---

## 4. Integration Flows

### 4.1 Authentication Flow (Extension and Dashboard)

1. User enters **email** and **password** (and optional display name for register).
2. Client calls **POST** `{baseUrl}/auth/login` or **POST** `{baseUrl}/auth/register` with JSON body:
   - Login: `{ "email": "...", "password": "..." }`
   - Register: `{ "email": "...", "password": "...", "confirmPassword": "...", "displayName": "..." }`
3. API returns **200** and body like:
   ```json
   { "token": "eyJ...", "expiresAt": "...", "user": { "id": "...", "email": "...", "displayName": "...", "subscriptionTier": "free" } }
   ```
4. Client stores **token** and uses it on every Echo request:
   - Header: `Authorization: Bearer <token>`
5. If API returns **401** on any Echo call, client clears token and shows login again.

**Extension:** token in `chrome.storage.local` (`echoAuthToken`).  
**Dashboard:** token in localStorage (see `dashboard/lib/auth.ts`).

---

### 4.2 Recording Flow (Extension → API → Worker)

1. **Start**
   - User clicks “Start Recording” in popup.
   - Popup sends message to **background**; background calls **POST** `{baseUrl}/echo/start-session` with `Authorization: Bearer <token>`.
   - API creates a row in `echo_sessions` (status `Recording`) and returns `{ "sessionId": "<guid>" }`.
   - Background opens **offscreen** document, starts tab capture and MediaRecorder, stores `sessionId`.

2. **During recording**
   - Offscreen builds audio chunks (e.g. every 5 minutes or on stop).
   - For each chunk: **POST** `{baseUrl}/echo/upload-chunk` with `Authorization: Bearer <token>` and **form data**: `SessionId`, `SequenceNumber`, `File` (audio blob).
   - API saves the file (disk or MinIO) and updates `echo_sessions.chunk_count`.

3. **Stop**
   - User clicks “Stop” (or tab closes); background calls **POST** `{baseUrl}/echo/finish-session` with body `{ "sessionId": "<guid>" }` and `Authorization: Bearer <token>`.
   - API sets session to `Finished`, enforces free-tier limit (3 hr/month), then calls **Worker**:
     - **POST** `{Worker:Url}/process?sessionId=<guid>` (fire-and-forget).
   - Worker returns **202** and processes in background (merge chunks → Whisper → LLM → update `echo_sessions` with transcript, summary, status `Completed` or `Failed`).

4. **View results**
   - Extension “Recordings” tab or Dashboard calls **GET** `{baseUrl}/echo/sessions` and **GET** `{baseUrl}/echo/session/{id}` with `Authorization: Bearer <token>` to show list and detail (transcript, Boss Summary).

---

### 4.3 Dashboard Flow (Next.js)

1. User opens Dashboard; enters **API base URL** (if not already stored) and **email / password**.
2. **POST** `{baseUrl}/auth/login` → store token (e.g. in localStorage).
3. **GET** `{baseUrl}/echo/sessions` with `Authorization: Bearer <token>` → show sessions list.
4. User clicks a session → **GET** `{baseUrl}/echo/session/{id}` → show transcript, summary, export.

All API calls go through `dashboard/lib/api.ts` (login, fetchSessions, fetchSession).

---

## 5. Request / Response Examples

### Auth

**POST /auth/login**

- Request:
  ```http
  POST /auth/login
  Content-Type: application/json

  { "email": "user@example.com", "password": "secret" }
  ```
- Response 200:
  ```json
  { "token": "eyJhbGc...", "expiresAt": "2025-02-18T12:00:00Z", "user": { "id": "...", "email": "user@example.com", "displayName": "User", "subscriptionTier": "free" } }
  ```

### Echo (all require header: `Authorization: Bearer <token>`)

**POST /echo/start-session**

- Response 200: `{ "sessionId": "2251c4bd-eca9-4a74-9bbe-5b6251438321" }`

**POST /echo/upload-chunk**

- Request: `multipart/form-data` with `SessionId` (guid), `SequenceNumber` (int), `File` (audio file).
- Response 200: `{ "saved": true, "sequenceNumber": 0 }`

**POST /echo/finish-session**

- Request: `{ "sessionId": "<guid>" }`
- Response 200: `{ "finished": true, "sessionId": "<guid>" }`  
- Response 403 (free limit): `{ "error": "...", "code": "FREE_LIMIT_EXCEEDED", ... }`

**GET /echo/sessions**

- Response 200: array of `{ "id", "createdAt", "finishedAt", "chunkCount", "status" }`

**GET /echo/session/{id}**

- Response 200: `{ "id", "createdAt", "finishedAt", "chunkCount", "status", "transcript", "summary", "processedAt", "errorMessage" }`

### Worker (called by API)

**POST /process?sessionId=<guid>**

- Response 202: `{ "ok": true, "sessionId": "<guid>", "status": "accepted" }` (or `"already_processing"`).

---

## 6. CORS and Host Permissions

- **API** must allow the **origin** of the Dashboard (e.g. `https://your-dashboard.vercel.app`) and the **Chrome extension origin** (`chrome-extension://<extension-id>`) in `Cors:AllowedOrigins`. Otherwise the browser blocks requests.
- **Extension** needs **host_permissions** in `manifest.json` for the API base URL (e.g. `https://your-app.azurewebsites.net/*`, `http://localhost:5012/*`).

---

## 7. Summary Table

| Component    | Integrates with API via                    | Main APIs used |
|-------------|--------------------------------------------|----------------|
| **Extension** | Same base URL + JWT in header              | /auth/login, /auth/register, /echo/start-session, /echo/upload-chunk, /echo/finish-session, /echo/sessions, /echo/session/{id} |
| **Dashboard** | Same base URL + JWT in header              | /auth/login, /echo/sessions, /echo/session/{id} |
| **API**       | Calls Worker at Worker:Url                | POST Worker/process?sessionId= |
| **Worker**    | Reads DB (same PostgreSQL as API), writes transcript/summary | N/A (no direct API calls back to Echo API) |

All integration is done **through the Echo API**; the single production URL (e.g. `https://your-app.azurewebsites.net`) is what you configure in the Extension and Dashboard.

# How session status works

The `echo_sessions.status` column tracks where a recording is in its lifecycle. Both the **API** and the **Worker** update it.

---

## Status values (in order)

| Status       | Set by   | Meaning |
|-------------|----------|--------|
| **Recording** | API     | User started recording. Session was created (start-session or first upload-chunk). |
| **Finished**  | API     | User clicked Stop. finish-session was called. API then triggers the worker. |
| **Processing**| Worker  | Worker picked up the job and is merging chunks → transcribe → summarize. |
| **Completed** | Worker  | Worker finished. Transcript and summary are saved; ready to view in Dashboard/Recordings. |
| **Failed**    | Worker  | Worker hit an error (e.g. DB connection, Whisper, disk). `error_message` is set. |

---

## Flow (who sets what)

1. **Extension: Start Recording**  
   → API `POST /echo/start-session`  
   → New row: `status = 'Recording'`, `chunk_count = 0`.

2. **Extension: every 5 min or on Stop**  
   → API `POST /echo/upload-chunk`  
   → Same session: `chunk_count` updated; `status` stays `Recording`.

3. **Extension: Stop Recording**  
   → API `POST /echo/finish-session`  
   → Session: `finished_at = now`, **`status = 'Finished'`**.  
   → API then calls Worker (HTTP POST to `/process?sessionId=...`).

4. **Worker receives /process**  
   → Worker runs `process_session(session_id)`  
   → **First:** `UPDATE echo_sessions SET status = 'Processing'` (only if current status is one of `Finished`, `Failed`, `Completed`, `Processing` — so it can retry).  
   → If session was still `Recording`, worker **skips** (does not process).

5. **Worker finishes successfully**  
   → **`UPDATE echo_sessions SET status = 'Completed', transcript = ..., summary = ..., processed_at = NOW()`**.

6. **Worker hits an error**  
   → **`UPDATE echo_sessions SET status = 'Failed', error_message = ..., processed_at = NOW()`**.

---

## Summary

- **API** sets: `Recording` (start/upload), `Finished` (finish-session).
- **Worker** sets: `Processing` (when it starts), `Completed` (success), `Failed` (error).
- **Recording** → **Finished** → **Processing** → **Completed** or **Failed**.

The Dashboard and Recordings tab show `status` so you can see “Processing” vs “Completed” vs “Failed”.

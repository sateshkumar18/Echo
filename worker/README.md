# Echo AI Worker (Python)

Runs after you click **Stop** in the extension: merges audio chunks → Whisper (transcribe) → Llama (Boss Summary) → saves to PostgreSQL.

## Prerequisites (local)

- **Python 3.11 or 3.12** (recommended). Python 3.14 may require Rust to build `faster-whisper` deps; use 3.11/3.12 to get prebuilt wheels.
- **FFmpeg** – must be on PATH ([download](https://ffmpeg.org/download.html))
- **PostgreSQL** – same `echo` database as the API (already have it)
- **Ollama** (optional) – for LLM summary. [Install](https://ollama.ai), then run: `ollama pull llama3.2`  
  If Ollama is not running, the worker still transcribes and saves a placeholder summary.

**Use one venv only:** The project uses a **single** virtual environment at the **project root** named **`.venv`** (see [START_HERE.md](../START_HERE.md)). Do not create `venv` or a second venv inside `worker/` – use the root `.venv` and run `.\run-worker.ps1` from the project folder, or activate `.venv` then `cd worker` and `python app.py`.

## Setup

**Option A – full (transcription + summary):**

From the **echo** folder (project root):

```powershell
py -3.12 -m venv .venv
.\.venv\Scripts\Activate.ps1
cd worker
pip install -r requirements.txt
cd ..
```

Then run the worker with `.\run-worker.ps1` (from echo folder) or `cd worker` + `python app.py`.

**Option B – core only (if `pip install -r requirements.txt` fails, e.g. Rust/tokenizers on Python 3.14):**

```powershell
.\.venv\Scripts\Activate.ps1
cd worker
pip install -r requirements-core.txt
cd ..
```

Worker runs; transcription is skipped (session gets a placeholder transcript). Use Python 3.11/3.12 and full `requirements.txt` when you can for real transcription.

## Config (works for both local and production)

- **ECHO_DATABASE_URL** – PostgreSQL URL (same DB as the API).
  - **Local:** If unset, the worker uses `postgresql://postgres:postgres@localhost:5432/Echo`. If your DB is elsewhere (e.g. remote host), create `worker/.env` (copy from `worker/.env.example`) and set this to your URL.
  - **Production:** Set in the server environment; never commit the real URL.
- **ECHO_CHUNK_BASE_PATH** – Folder where the API saves chunks. Default: `../api/Data/Chunks` (relative to worker folder).
- **ECHO_WORKER_PORT** – Port for the worker HTTP server. Default: `5050`.

### Production: fast defaults (CPU and GPU)

Defaults are tuned for **fast production**: Whisper **medium** model (good quality, much faster than large-v3 on CPU). If you have an **NVIDIA GPU**, set `ECHO_WHISPER_DEVICE=cuda` and optionally `ECHO_WHISPER_MODEL=large-v3` for best quality. On CPU-only, the worker uses **medium** so 10–15 min of audio finishes in a few minutes.

### Long recordings (3–4 hours): faster transcription and bounded summary

If 3 minutes of audio takes too long, 3–4 hours would be much worse without these settings:

| Env var | Purpose | Suggested |
|--------|--------|-----------|
| **ECHO_WHISPER_DEVICE** | Use GPU for Whisper (10–50× faster than CPU). | `cuda` if you have an NVIDIA GPU; else `cpu`. |
| **ECHO_WHISPER_MODEL** | Smaller = faster, less accurate. For long files, `medium` or `base` is often enough. | `base` or `medium` on CPU; `large-v3` on GPU. |
| **ECHO_WHISPER_SEGMENT_MINUTES** | Split audio into N‑minute segments; processes one by one with progress. Set `0` to disable. | `10` (default) for 3–4 hr so you see `[Whisper] Segment 1/24` etc. |
| **ECHO_SUMMARY_MAX_CHUNKS** | Cap how many transcript chunks are sent to the LLM (summary step). For 3–4 hr we sample evenly so summary time is bounded. | `12` (default); set `0` for no cap. |

Example for a **3–4 hour** meeting (GPU available):

```powershell
$env:ECHO_WHISPER_DEVICE = "cuda"
$env:ECHO_WHISPER_MODEL = "large-v3"
$env:ECHO_WHISPER_SEGMENT_MINUTES = "10"
$env:ECHO_SUMMARY_MAX_CHUNKS = "12"
.\run-worker.ps1
```

Example for **CPU only** (slower; use smaller model and segments):

```powershell
$env:ECHO_WHISPER_DEVICE = "cpu"
$env:ECHO_WHISPER_MODEL = "base"
$env:ECHO_WHISPER_SEGMENT_MINUTES = "10"
.\run-worker.ps1
```

## Run

```powershell
python app.py
```

Worker listens on **http://localhost:5050**. The API calls `POST /process?sessionId=xxx` when you finish a session.

## New recordings – automatic

For **every new recording** you do **not** need to call the worker manually. As long as:

1. **API is running** (e.g. `.\run-api.ps1` from the echo folder).
2. **Worker is running** (e.g. `.\run-worker.ps1` from the echo folder).
3. You **stop the recording** from the extension (click **Stop** or close the tab).

Then the flow is automatic: extension → finish-session → API sets **Finished** and triggers the worker → worker processes (merge → transcribe → summarize) and updates the session. You only need to manually call `POST /process?sessionId=...` if you want to **re-process** an old session (e.g. after fixing FFmpeg or Ollama).

## DB columns

If your `echo_sessions` table was created before transcript/summary was added, run in pgAdmin (echo DB):

```sql
-- From api/Scripts/add_transcript_columns.sql
ALTER TABLE echo_sessions ADD COLUMN IF NOT EXISTS transcript TEXT NULL;
ALTER TABLE echo_sessions ADD COLUMN IF NOT EXISTS summary TEXT NULL;
ALTER TABLE echo_sessions ADD COLUMN IF NOT EXISTS processed_at TIMESTAMP NULL;
ALTER TABLE echo_sessions ADD COLUMN IF NOT EXISTS error_message TEXT NULL;
```

## Flow

1. Extension → **Stop** → API `POST /echo/finish-session`.
2. API sets session status to **Finished**, then calls worker `POST http://localhost:5050/process?sessionId=...`.
3. Worker: merge chunks (FFmpeg) → transcribe (faster-whisper) → summarize (Ollama) → update `echo_sessions` (transcript, summary, status=Completed).
4. Dashboard (or `GET /echo/session/{id}`) can show transcript and summary.

## Get full transcript and real summary

By default the worker runs with **requirements-core.txt** (no Whisper, no Ollama), so you see placeholders. To get **full transcript** and **real AI summary**:

1. **Python 3.11 or 3.12** (required for faster-whisper wheels). If you use 3.14, create a venv with 3.12:
   ```powershell
   cd C:\Users\SateshKumarReddy\Desktop\echo
   Remove-Item -Recurse -Force .venv -ErrorAction SilentlyContinue
   py -3.12 -m venv .venv
   .\.venv\Scripts\Activate.ps1
   cd worker
   pip install -r requirements.txt
   cd ..
   ```
2. **Ollama** (for summary): install from [ollama.ai](https://ollama.ai), run it, then:
   ```powershell
   ollama pull llama3.2
   ```
3. **Restart the worker** (Ctrl+C, then `.\run-worker.ps1` from the echo folder).
4. **Re-process the session** (same session can be re-run to overwrite transcript/summary):
   ```powershell
   Invoke-RestMethod -Method Post -Uri "http://localhost:5050/process?sessionId=YOUR-SESSION-ID"
   ```
   Then call `GET /echo/session/{id}` or check pgAdmin — you should see full transcript and Boss Summary.

## Troubleshooting

- **"Unable to open file 'model.bin'" or status Failed (Whisper cache)**  
  Corrupted Whisper cache. Delete `%USERPROFILE%\.cache\huggingface\hub\models--Systran--faster-whisper-large-v3` and re-run the worker, or set `$env:ECHO_WHISPER_MODEL = "base"`. See [START_HERE.md](../START_HERE.md).

- **"The system cannot find the file specified" or status Failed with no transcript**  
  FFmpeg is missing or not on PATH. On Windows: download from [ffmpeg.org](https://ffmpeg.org/download.html) (e.g. the "Windows builds" gyan.dev or BtbN), unzip, and add the `bin` folder (e.g. `C:\ffmpeg\bin`) to your system **PATH**. Restart the terminal and run the worker again, then retry processing the session (e.g. `POST /process?sessionId=...` or use the API’s trigger).

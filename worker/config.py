"""Worker config: DB and chunk path. Set via env or .env (optional: pip install python-dotenv)."""
import json
import os
import logging

try:
    from dotenv import load_dotenv
    load_dotenv()
except ImportError:
    pass

# Production: set LOG_LEVEL=INFO or WARNING to reduce noise
_log_level = os.environ.get("LOG_LEVEL", "INFO").upper()
logging.basicConfig(
    level=getattr(logging, _log_level, logging.INFO),
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S",
)


def _connection_string_to_url(cs: str) -> str:
    """Convert .NET-style ConnectionStrings:EchoDb to postgresql:// URL."""
    if not cs or not cs.strip():
        return ""
    parts = [p.strip() for p in cs.strip().split(";") if p.strip()]
    kv = {}
    for p in parts:
        if "=" in p:
            k, v = p.split("=", 1)
            kv[k.strip().lower()] = v.strip()
    host = kv.get("host", "localhost")
    port = kv.get("port", "5432")
    database = kv.get("database", "Echo")
    user = kv.get("username", "postgres")
    password = kv.get("password", "")
    if password:
        from urllib.parse import quote_plus
        password = quote_plus(password)
    return f"postgresql://{user}:{password}@{host}:{port}/{database}"


def _read_api_db_url() -> str:
    """If ECHO_DATABASE_URL not set, try same DB as API from appsettings.Development.json."""
    api_dir = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "api")
    path = os.path.join(api_dir, "appsettings.Development.json")
    if not os.path.isfile(path):
        return ""
    try:
        with open(path, "r", encoding="utf-8") as f:
            data = json.load(f)
        conn = (data.get("ConnectionStrings") or {}).get("EchoDb") or ""
        return _connection_string_to_url(conn)
    except Exception:
        return ""


# PostgreSQL (same as API). Same DB for local and production:
# - Local: ECHO_DATABASE_URL in worker/.env, OR read from api/appsettings.Development.json (same as API).
# - Production: set ECHO_DATABASE_URL in environment (never commit real URL).
_default_local = "postgresql://postgres:postgres@localhost:5432/Echo"
DATABASE_URL = os.environ.get("ECHO_DATABASE_URL", "").strip()
if not DATABASE_URL:
    DATABASE_URL = _read_api_db_url()
if not DATABASE_URL:
    DATABASE_URL = _default_local
    import sys
    print("Note: ECHO_DATABASE_URL not set and no api/appsettings.Development.json — using default local DB. "
          "Set worker/.env or use API config for your real DB.", file=sys.stderr)

# Where the API saves chunks (disk). Must match API ChunkStorage:Path.
# Resolve to absolute path so it works regardless of CWD when running the worker.
_default_chunk_base = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "api", "Data", "Chunks")
CHUNK_BASE_PATH = os.path.abspath(os.environ.get("ECHO_CHUNK_BASE_PATH", _default_chunk_base))

# Flask server (API will POST here)
WORKER_PORT = int(os.environ.get("ECHO_WORKER_PORT", "5050"))

# Trim this many seconds from the start of merged audio to correct tab-capture delay (video starts before audio).
# Default 0 (disabled) so we don't cut any speech unless explicitly configured.
TRIM_START_SECONDS = float(os.environ.get("ECHO_TRIM_START_SECONDS", "0.0"))

# MinIO (S3-compatible) – when set, worker downloads chunks from MinIO instead of local disk.
# Must match API MinIO config. Leave endpoint empty to use disk (ECHO_CHUNK_BASE_PATH).
MINIO_ENDPOINT = os.environ.get("ECHO_MINIO_ENDPOINT", "").strip()
MINIO_ACCESS_KEY = os.environ.get("ECHO_MINIO_ACCESS_KEY", "").strip()
MINIO_SECRET_KEY = os.environ.get("ECHO_MINIO_SECRET_KEY", "").strip()
MINIO_BUCKET = os.environ.get("ECHO_MINIO_BUCKET", "echo-raw-audio").strip()
USE_MINIO = bool(MINIO_ENDPOINT)

# Whisper: default "medium" = fast on CPU/GPU and good quality. For best quality with NVIDIA GPU set ECHO_WHISPER_MODEL=large-v3.
WHISPER_MODEL = os.environ.get("ECHO_WHISPER_MODEL", "medium").strip()
WHISPER_DEVICE = os.environ.get("ECHO_WHISPER_DEVICE", "cuda").strip().lower()
WHISPER_COMPUTE_TYPE = os.environ.get("ECHO_WHISPER_COMPUTE_TYPE", "").strip() or (
    "float16" if WHISPER_DEVICE == "cuda" else "int8"
)
# PRD: "Output: Full Text with Timestamps". When True, transcript includes [HH:MM:SS] per segment.
TRANSCRIPT_INCLUDE_TIMESTAMPS = os.environ.get("ECHO_TRANSCRIPT_INCLUDE_TIMESTAMPS", "true").strip().lower() in ("1", "true", "yes")

# Long recordings (3–4 hours): process audio in segments to limit memory and show progress.
# Segment length in minutes (e.g. 10 = 10-min chunks). Set 0 to transcribe whole file at once.
WHISPER_SEGMENT_MINUTES = max(0, int(os.environ.get("ECHO_WHISPER_SEGMENT_MINUTES", "10")))

# Summary: max number of transcript chunks to send to LLM (partial summaries). For 3–4 hr we cap to bound time.
# Extra chunks are sampled evenly (beginning/middle/end). Set 0 for no cap.
SUMMARY_MAX_CHUNKS = max(0, int(os.environ.get("ECHO_SUMMARY_MAX_CHUNKS", "12")))

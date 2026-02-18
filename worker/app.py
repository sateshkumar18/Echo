"""
Echo AI Worker – HTTP server.
API calls POST /process?sessionId=xxx to trigger processing.
Returns 202 Accepted immediately and processes in background so the API trigger does not timeout.
"""
# Suppress Hugging Face "unauthenticated requests" warning before any HF code runs (set HF_TOKEN for faster downloads)
import os
import warnings
os.environ.setdefault("HF_HUB_VERBOSITY", "error")
warnings.filterwarnings("ignore", message=".*[Uu]nauthenticated.*[Hh]ub.*")
warnings.filterwarnings("ignore", message=".*HF Hub.*")

import logging
logging.getLogger("huggingface_hub").setLevel(logging.ERROR)
logging.getLogger("httpx").setLevel(logging.ERROR)
logging.getLogger("urllib3").setLevel(logging.ERROR)

import threading
import uuid

from flask import Flask, request

from config import WORKER_PORT
from process_session import process_session, HAS_WHISPER

app = Flask(__name__)
log = logging.getLogger(__name__)

# Deduplicate: only one processing run per session at a time (API/extension may trigger twice).
_processing_sessions = set()
_processing_lock = threading.Lock()


@app.route("/health")
def health():
    return {"ok": True}


@app.route("/process", methods=["POST", "GET"])
def process():
    """Accept session, return 202 immediately, process in background (merge → Whisper → LLM → DB)."""
    session_id_str = request.args.get("sessionId") or (request.get_json() or {}).get("sessionId")
    if not session_id_str:
        return {"error": "Missing sessionId"}, 400
    try:
        session_id = uuid.UUID(session_id_str)
    except ValueError:
        return {"error": "Invalid sessionId"}, 400

    with _processing_lock:
        if session_id in _processing_sessions:
            log.info("Session %s already processing, skipping duplicate trigger.", session_id)
            return {"ok": True, "sessionId": str(session_id), "status": "already_processing"}, 202
        _processing_sessions.add(session_id)

    def run():
        try:
            log.info("Processing session %s (Whisper: %s)", session_id, "yes" if HAS_WHISPER else "no")
            if process_session(session_id):
                log.info("Session %s completed.", session_id)
        except Exception as e:
            log.exception("Session %s failed: %s", session_id, e)
        finally:
            with _processing_lock:
                _processing_sessions.discard(session_id)

    threading.Thread(target=run, daemon=True).start()
    return {"ok": True, "sessionId": str(session_id), "status": "accepted"}, 202


if __name__ == "__main__":
    import config
    log.info("Echo worker: chunk path = %s", config.CHUNK_BASE_PATH)
    db = config.DATABASE_URL
    if "@" in db:
        db_short = "..." + db[db.rindex("@"):]
    else:
        db_short = db
    log.info("Echo worker: database = %s", db_short)
    if HAS_WHISPER:
        log.info("Echo worker: Whisper model=%s, device=%s", config.WHISPER_MODEL, config.WHISPER_DEVICE)
    else:
        log.warning("Echo worker: Whisper NOT available – transcript will be placeholder")
    app.run(host="0.0.0.0", port=WORKER_PORT, debug=False)

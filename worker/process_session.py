"""
Process one session: merge chunks → Whisper → LLM summary → save to DB.
Run by the Flask /process endpoint.
"""

import os
import re
import subprocess
import tempfile
import uuid
from datetime import datetime, timezone
from pathlib import Path
import shutil

import psycopg

import logging

import config
from summarizer import summarize_long_transcript

log = logging.getLogger(__name__)

# ---------------------------------------------------------
# Whisper availability
# ---------------------------------------------------------
try:
    from faster_whisper import WhisperModel
    HAS_WHISPER = True
except (ImportError, FileNotFoundError, OSError):
    WhisperModel = None
    HAS_WHISPER = False


# ---------------------------------------------------------
# Helpers
# ---------------------------------------------------------

def get_chunk_dir(session_id: uuid.UUID) -> Path:
    return Path(config.CHUNK_BASE_PATH) / session_id.hex


def download_chunks_from_minio(session_id: uuid.UUID) -> Path:
    from minio import Minio

    endpoint = config.MINIO_ENDPOINT.strip()
    bucket = config.MINIO_BUCKET or "echo-raw-audio"
    access = config.MINIO_ACCESS_KEY or None
    secret = config.MINIO_SECRET_KEY or None

    secure = endpoint.startswith("https://")
    host = endpoint.replace("https://", "").replace("http://", "").strip("/")

    client = Minio(host, access_key=access, secret_key=secret, secure=secure)
    prefix = f"{session_id.hex}/"

    temp_dir = Path(tempfile.mkdtemp(prefix="echo_minio_"))
    try:
        for obj in client.list_objects(bucket, prefix=prefix, recursive=True):
            if obj.object_name.endswith(".webm"):
                local_path = temp_dir / Path(obj.object_name).name
                client.fget_object(bucket, obj.object_name, str(local_path))
        return temp_dir
    except Exception:
        shutil.rmtree(temp_dir, ignore_errors=True)
        raise


def resolve_ffmpeg() -> str:
    exe = os.environ.get("ECHO_FFMPEG_PATH") or shutil.which("ffmpeg")
    if exe:
        return exe

    userprofile = os.environ.get("USERPROFILE", "")
    for c in [
        os.path.join(userprofile, "scoop", "shims", "ffmpeg.exe"),
        os.path.join(userprofile, "scoop", "apps", "ffmpeg", "current", "bin", "ffmpeg.exe"),
    ]:
        if os.path.exists(c):
            return c

    raise FileNotFoundError("FFmpeg not found. Install FFmpeg and add it to PATH.")


def merge_chunks_to_wav(chunk_dir: Path) -> str:
    chunks = sorted(chunk_dir.glob("chunk_*.webm"))
    if not chunks:
        raise ValueError(f"No audio chunks found in {chunk_dir}")

    with tempfile.NamedTemporaryFile(suffix=".wav", delete=False) as f:
        wav_path = f.name

    list_path = wav_path + ".list"
    with open(list_path, "w", encoding="utf-8") as f:
        for c in chunks:
            f.write(f"file '{str(c.absolute()).replace('\\', '/')}'\n")

    subprocess.run(
        [
            resolve_ffmpeg(),
            "-y",
            "-f",
            "concat",
            "-safe",
            "0",
            "-i",
            list_path,
            "-acodec",
            "pcm_s16le",
            "-ar",
            "16000",
            "-ac",
            "1",
            wav_path,
        ],
        check=True,
        capture_output=True,
    )

    os.unlink(list_path)
    return wav_path


def get_wav_duration_seconds(wav_path: str) -> float:
    """Get duration of WAV in seconds via FFmpeg (no extra deps)."""
    out = subprocess.run(
        [
            resolve_ffmpeg(),
            "-i",
            wav_path,
            "-f",
            "null",
            "-",
        ],
        capture_output=True,
        text=True,
        timeout=30,
    )
    # FFmpeg writes duration to stderr: "Duration: 00:05:23.45"
    for line in (out.stderr or "").splitlines():
        m = re.search(r"Duration:\s*(\d+):(\d+):(\d+)\.(\d+)", line)
        if m:
            h, m_, s, cs = int(m.group(1)), int(m.group(2)), int(m.group(3)), int(m.group(4))
            return h * 3600 + m_ * 60 + s + cs / 100.0
    return 0.0


def split_wav_into_segments(wav_path: str, segment_seconds: int) -> list[str]:
    """Split WAV into segment_seconds-long files. Returns list of temp file paths. Caller must unlink."""
    duration = get_wav_duration_seconds(wav_path)
    if duration <= 0 or segment_seconds <= 0:
        return [wav_path]
    out_dir = tempfile.mkdtemp(prefix="echo_whisper_segments_")
    pattern = os.path.join(out_dir, "seg_%03d.wav")
    subprocess.run(
        [
            resolve_ffmpeg(),
            "-y",
            "-i",
            wav_path,
            "-f",
            "segment",
            "-segment_time",
            str(segment_seconds),
            "-acodec",
            "pcm_s16le",
            "-ar",
            "16000",
            "-ac",
            "1",
            "-reset_timestamps",
            "1",
            pattern,
        ],
        check=True,
        capture_output=True,
        timeout=int(duration) + 60,
    )
    segs = sorted(Path(out_dir).glob("seg_*.wav"))
    return [str(s) for s in segs]


def _format_timestamp(seconds: float) -> str:
    """Format seconds as [HH:MM:SS] for PRD timestamped transcript."""
    h = int(seconds // 3600)
    m = int((seconds % 3600) // 60)
    s = int(seconds % 60)
    return f"[{h:02d}:{m:02d}:{s:02d}]"


def _transcribe_one_file(wav_path: str, model, offset_seconds: float = 0.0) -> str:
    """Transcribe a single WAV file; optional offset for timestamps (used when processing segments)."""
    segments, _ = model.transcribe(wav_path)
    segments = list(segments)
    include_ts = config.TRANSCRIPT_INCLUDE_TIMESTAMPS
    if not segments:
        return ""
    parts = []
    prev_end = 0.0
    for seg in segments:
        text = (seg.text or "").strip()
        if not text:
            continue
        if parts and seg.start - prev_end >= 1.5:
            parts.append("\n\n")
        elif parts:
            parts.append(" ")
        if include_ts:
            parts.append(_format_timestamp(seg.start + offset_seconds))
            parts.append(" ")
        parts.append(text)
        prev_end = seg.end
    return "".join(parts).strip()


def _load_whisper_model(model_name: str, device: str, compute_type: str):
    """Load Whisper model. On corrupted cache (e.g. model.bin missing), fall back to 'base' and hint cache fix."""
    try:
        return WhisperModel(model_name, device=device, compute_type=compute_type)
    except Exception as e:
        err_msg = str(e).lower()
        if "model.bin" in err_msg or "unable to open file" in err_msg or "faster-whisper" in err_msg:
            cache_hint = (
                "Corrupted or incomplete Whisper cache. Fix: delete folder\n"
                "  %USERPROFILE%\\.cache\\huggingface\\hub\\models--Systran--faster-whisper-*\n"
                "then run again, or use a smaller model: set ECHO_WHISPER_MODEL=base"
            )
            if model_name != "base":
                log.warning("Whisper failed to load '%s': %s; trying fallback 'base'", model_name, e)
                try:
                    return WhisperModel("base", device=device, compute_type="int8" if device == "cpu" else compute_type)
                except Exception:
                    log.error("Whisper fallback also failed. %s", cache_hint)
                    raise RuntimeError(f"Whisper model load failed: {e}. {cache_hint}") from e
            raise RuntimeError(f"Whisper model load failed: {e}. {cache_hint}") from e
        raise


def transcribe(wav_path: str) -> str:
    if not HAS_WHISPER:
        return "(Transcription skipped – Whisper not installed.)"

    log.info("Loading Whisper model (first run or large model can take 1–2 min)")
    device = config.WHISPER_DEVICE
    compute_type = config.WHISPER_COMPUTE_TYPE
    model_name = config.WHISPER_MODEL
    segment_minutes = config.WHISPER_SEGMENT_MINUTES
    segment_seconds = segment_minutes * 60 if segment_minutes > 0 else 0

    if device == "cuda":
        try:
            model = _load_whisper_model(model_name, "cuda", compute_type)
        except Exception:
            device = "cpu"
            compute_type = "int8"
            # On CPU, large-v3 is very slow; use medium for production-friendly speed
            cpu_model = "medium" if model_name == "large-v3" else model_name
            if cpu_model != model_name:
                log.info("No GPU: using '%s' on CPU for speed (set ECHO_WHISPER_DEVICE=cuda if you have NVIDIA GPU)", cpu_model)
            model = _load_whisper_model(cpu_model, "cpu", compute_type)
    else:
        # If user set CPU and large-v3, still use medium on CPU so production is fast
        if device == "cpu" and model_name == "large-v3":
            log.info("Using 'medium' on CPU for speed (large-v3 on CPU is very slow). Set ECHO_WHISPER_DEVICE=cuda for large-v3.")
            model_name = "medium"
        model = _load_whisper_model(model_name, device, compute_type)

    segment_paths = []
    if segment_seconds > 0:
        segment_paths = split_wav_into_segments(wav_path, segment_seconds)
    if not segment_paths:
        segment_paths = [wav_path]
    # If split returned the original path only (duration 0 or no split), we have nothing to clean
    created_segment_dir = segment_seconds > 0 and segment_paths and segment_paths[0] != wav_path

    try:
        all_parts = []
        for i, seg_path in enumerate(segment_paths):
            if created_segment_dir and len(segment_paths) > 0:
                log.info("Whisper segment %s/%s (%s min each)", i + 1, len(segment_paths), segment_minutes)
            offset = i * segment_seconds if segment_seconds > 0 else 0.0
            text = _transcribe_one_file(seg_path, model, offset_seconds=offset)
            if text:
                if all_parts:
                    all_parts.append("\n\n")
                all_parts.append(text)
        result = "".join(all_parts).strip()
        return result if result else "(no speech detected)"
    finally:
        if created_segment_dir and segment_paths:
            seg_dir = os.path.dirname(segment_paths[0])
            if seg_dir and "echo_whisper_segments" in seg_dir:
                shutil.rmtree(seg_dir, ignore_errors=True)


# ---------------------------------------------------------
# MAIN ENTRY
# ---------------------------------------------------------

def process_session(session_id: uuid.UUID) -> bool:
    """Merge → transcribe → summarize → update DB. Returns True if processed, False if skipped."""

    # Mark session Processing (allow retry when stuck in 'Processing' from a previous run)
    with psycopg.connect(config.DATABASE_URL) as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                UPDATE echo_sessions
                SET status = 'Processing', error_message = NULL
                WHERE id = %s
                  AND status IN ('Finished', 'Failed', 'Completed', 'Processing')
                """,
                (str(session_id),),
            )
            if cur.rowcount == 0:
                cur.execute("SELECT status FROM echo_sessions WHERE id = %s", (str(session_id),))
                row = cur.fetchone()
                current = row[0] if row else "?"
                log.info("Session %s skipped (status=%s). Run when Finished/Failed/Completed or retry if stuck in Processing.", session_id, current)
                return False
        conn.commit()

    chunk_dir = get_chunk_dir(session_id)
    temp_minio_dir = None
    wav_path = None

    try:
        if config.USE_MINIO:
            temp_minio_dir = download_chunks_from_minio(session_id)
            chunk_dir = temp_minio_dir

        log.info("Merging chunks for %s", session_id)
        wav_path = merge_chunks_to_wav(chunk_dir)
        log.info("Merged WAV ready, starting transcription")
        transcript = transcribe(wav_path)
        log.info("Transcription done (%s chars), starting summary", len(transcript))
        summary = summarize_long_transcript(transcript)

        processed_at_utc = datetime.now(timezone.utc)
        with psycopg.connect(config.DATABASE_URL) as conn:
            with conn.cursor() as cur:
                cur.execute(
                    """
                    UPDATE echo_sessions
                    SET status = 'Completed',
                        transcript = %s,
                        summary = %s,
                        processed_at = %s
                    WHERE id = %s
                    """,
                    (transcript, summary, processed_at_utc, str(session_id)),
                )
            conn.commit()

        log.info("Completed %s (transcript=%s chars, summary=%s chars)", session_id, len(transcript), len(summary))
        return True

    except Exception as e:
        processed_at_utc = datetime.now(timezone.utc)
        with psycopg.connect(config.DATABASE_URL) as conn:
            with conn.cursor() as cur:
                cur.execute(
                    """
                    UPDATE echo_sessions
                    SET status = 'Failed',
                        error_message = %s,
                        processed_at = %s
                    WHERE id = %s
                    """,
                    (str(e), processed_at_utc, str(session_id)),
                )
            conn.commit()
        raise

    finally:
        if wav_path and os.path.exists(wav_path):
            os.unlink(wav_path)
        if temp_minio_dir:
            shutil.rmtree(temp_minio_dir, ignore_errors=True)

# worker/summarizer.py
import logging

MAX_CHARS = 6000
log = logging.getLogger(__name__)


def chunk_text(text: str, size: int = MAX_CHARS):
    return [text[i:i + size] for i in range(0, len(text), size)]


def _sample_chunks_evenly(chunks: list[str], max_chunks: int) -> list[str]:
    """For long transcripts: take up to max_chunks, evenly spaced (beginning, middle, end)."""
    if not chunks or max_chunks <= 0 or len(chunks) <= max_chunks:
        return chunks
    if max_chunks == 1:
        return [chunks[0]]
    # Indices so we cover start, end, and spread in between
    n = len(chunks)
    step = (n - 1) / (max_chunks - 1) if max_chunks > 1 else 0
    indices = [min(int(round(i * step)), n - 1) for i in range(max_chunks)]
    return [chunks[i] for i in sorted(set(indices))]


def summarize_with_llm(text: str) -> str:
    import ollama

    prompt = (
        "Summarize this meeting transcript into a Boss Summary with:\n"
        "1. Key Decisions\n"
        "2. Action Items\n"
        "3. Next Steps\n\n"
        "Use concise bullet points.\n\n"
        "Transcript:\n"
        + text
    )

    response = ollama.chat(
        model="llama3.2",
        messages=[{"role": "user", "content": prompt}],
    )

    return response["message"]["content"]


def summarize_long_transcript(transcript: str) -> str:
    import config

    transcript = (transcript or "").strip()
    if not transcript:
        return "(No transcript available to summarize.)"

    chunks = chunk_text(transcript)
    max_chunks = getattr(config, "SUMMARY_MAX_CHUNKS", 0)
    if max_chunks > 0 and len(chunks) > max_chunks:
        chunks = _sample_chunks_evenly(chunks, max_chunks)
        log.info("Using %s sampled chunks (cap=%s) for long transcript", len(chunks), max_chunks)

    if len(chunks) == 1:
        return summarize_with_llm(chunks[0])

    partial_summaries = []
    for i, chunk in enumerate(chunks):
        log.info("Summary chunk %s/%s", i + 1, len(chunks))
        partial_summaries.append(summarize_with_llm(chunk))

    combined = "\n\n".join(partial_summaries)

    final_prompt = (
        "Combine the following partial meeting summaries into ONE Boss Summary with:\n"
        "1. Key Decisions\n"
        "2. Action Items\n"
        "3. Next Steps\n\n"
        "Use concise bullet points.\n\n"
        + combined
    )

    import ollama
    response = ollama.chat(
        model="llama3.2",
        messages=[{"role": "user", "content": final_prompt}],
    )

    return response["message"]["content"]

namespace Echo.Api.Models;

/// <summary>
/// One recording session (one "Start" until "Stop").
/// Chunks are stored on disk/MinIO; this table holds metadata + AI output.
/// </summary>
public class EchoSession
{
    public Guid Id { get; set; }
    public Guid? UserId { get; set; }
    public EchoUser? User { get; set; }
    public DateTime CreatedAt { get; set; }
    public DateTime? FinishedAt { get; set; }
    /// <summary>Total number of chunks uploaded for this session.</summary>
    public int ChunkCount { get; set; }
    /// <summary>Status: Recording, Finished, Processing, Completed, Failed.</summary>
    public string Status { get; set; } = "Recording";
    /// <summary>Full transcript from Whisper (after AI worker runs).</summary>
    public string? Transcript { get; set; }
    /// <summary>Boss Summary JSON: key decisions, action items, next steps (from LLM).</summary>
    public string? Summary { get; set; }
    /// <summary>When the AI worker finished (or null if failed/not run).</summary>
    public DateTime? ProcessedAt { get; set; }
    /// <summary>Error message if Status = Failed.</summary>
    public string? ErrorMessage { get; set; }
}

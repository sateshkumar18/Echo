using System.Security.Claims;
using Echo.Api.Data;
using Echo.Api.Models;
using Echo.Api.Services;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;

namespace Echo.Api.Controllers;

[ApiController]
[Route("echo")]
[Authorize]
public class EchoController : ControllerBase
{
    private readonly EchoDbContext _db;
    private readonly IChunkStorage _chunkStorage;
    private readonly WorkerTrigger _workerTrigger;
    private readonly ILogger<EchoController> _logger;

    public EchoController(EchoDbContext db, IChunkStorage chunkStorage, WorkerTrigger workerTrigger, ILogger<EchoController> logger)
    {
        _db = db;
        _chunkStorage = chunkStorage;
        _workerTrigger = workerTrigger;
        _logger = logger;
    }

    /// <summary>
    /// Check database connection. GET /echo/health
    /// </summary>
    [HttpGet("health")]
    [AllowAnonymous]
    [ProducesResponseType(typeof(HealthResponse), StatusCodes.Status200OK)]
    [ProducesResponseType(typeof(HealthErrorResponse), StatusCodes.Status500InternalServerError)]
    public async Task<ActionResult<HealthResponse>> Health(CancellationToken ct)
    {
        try
        {
            _ = await _db.Database.CanConnectAsync(ct);
            return Ok(new HealthResponse { Ok = true, Database = "connected" });
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Database health check failed");
            return StatusCode(500, new HealthErrorResponse { Ok = false, Error = ex.Message });
        }
    }

    /// <summary>
    /// Start a new recording session. Extension calls this when user clicks Start.
    /// </summary>
    [HttpPost("start-session")]
    public async Task<ActionResult<StartSessionResponse>> StartSession(CancellationToken ct)
    {
        var userId = GetCurrentUserId();
        if (userId == null)
            return Unauthorized();
        try
        {
            var session = new EchoSession
            {
                Id = Guid.NewGuid(),
                UserId = userId,
                CreatedAt = DateTime.UtcNow,
                Status = "Recording",
                ChunkCount = 0
            };
            _db.EchoSessions.Add(session);
            await _db.SaveChangesAsync(ct);
            _logger.LogInformation("StartSession: created {SessionId}", session.Id);
            return Ok(new StartSessionResponse { SessionId = session.Id });
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "StartSession failed");
            return StatusCode(500, new ErrorResponse { Error = "Database error: " + ex.Message });
        }
    }

    /// <summary>
    /// Upload one audio chunk. PRD: extension sends one chunk every 5 minutes (and a final chunk on stop).
    /// If the session does not exist (e.g. start-session failed), it is created on first chunk.
    /// </summary>
    [HttpPost("upload-chunk")]
    [RequestSizeLimit(100_000_000)] // 100 MB per request
    public async Task<ActionResult> UploadChunk([FromForm] UploadChunkRequest request, CancellationToken ct)
    {
        if (request.File == null)
            return BadRequest("No file.");
        // Allow empty file so very short recordings still get ChunkCount > 0 and worker is triggered.

        var sessionId = request.SessionId;
        var sequenceNumber = request.SequenceNumber;
        var file = request.File;

        var userId = GetCurrentUserId();
        if (userId == null)
            return Unauthorized();
        var session = await _db.EchoSessions.FindAsync([sessionId], ct);
        if (session == null)
        {
            session = new EchoSession
            {
                Id = sessionId,
                UserId = userId,
                CreatedAt = DateTime.UtcNow,
                Status = "Recording",
                ChunkCount = 0
            };
            _db.EchoSessions.Add(session);
            await _db.SaveChangesAsync(ct);
            _logger.LogInformation("UploadChunk: created missing session {SessionId}", sessionId);
        }
        if (session.UserId != userId)
            return Forbid();

        try
        {
            var contentType = file.ContentType ?? "audio/webm";
            await using var stream = file.OpenReadStream();
            await _chunkStorage.SaveChunkAsync(sessionId, sequenceNumber, stream, file.Length, contentType, ct);

            session.ChunkCount = Math.Max(session.ChunkCount, sequenceNumber + 1);
            await _db.SaveChangesAsync(ct);
            _logger.LogInformation("UploadChunk: saved session {SessionId} chunk {Seq}", sessionId, sequenceNumber);
            return Ok(new UploadChunkResponse { Saved = true, SequenceNumber = sequenceNumber });
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "UploadChunk failed for session {SessionId}", sessionId);
            return StatusCode(500, new ErrorResponse { Error = ex.Message });
        }
    }

    /// <summary>
    /// Finish the session. Extension calls this when user clicks Stop.
    /// Later: enqueue job for AI worker (transcribe + summarize).
    /// </summary>
    [HttpPost("finish-session")]
    public async Task<ActionResult> FinishSession(
        [FromBody] FinishSessionRequest body,
        CancellationToken ct)
    {
        var userId = GetCurrentUserId();
        if (userId == null)
            return Unauthorized();
        var session = await _db.EchoSessions.FindAsync([body.SessionId], ct);
        if (session == null)
        {
            session = new EchoSession
            {
                Id = body.SessionId,
                UserId = userId,
                CreatedAt = DateTime.UtcNow,
                FinishedAt = DateTime.UtcNow,
                Status = "Finished",
                ChunkCount = 0
            };
            _db.EchoSessions.Add(session);
        }
        else
        {
            if (session.UserId != userId)
                return Forbid();
            session.FinishedAt = DateTime.UtcNow;
            session.Status = "Finished";
        }

        // PRD: Free tier = 3 hours/month. Arcade Pass / Echo Pro = unlimited.
        var user = await _db.EchoUsers.FindAsync([userId], ct);
        if (user != null && string.Equals(user.SubscriptionTier, "free", StringComparison.OrdinalIgnoreCase))
        {
            var now = DateTime.UtcNow;
            var startOfMonth = new DateTime(now.Year, now.Month, 1, 0, 0, 0, DateTimeKind.Utc);
            var minutesFromOtherSessions = await _db.EchoSessions
                .Where(s => s.UserId == userId && s.FinishedAt >= startOfMonth && s.Id != session.Id)
                .SumAsync(s => s.ChunkCount * 5, ct);
            var minutesThisSession = session.ChunkCount * 5;
            var totalMinutesThisMonth = minutesFromOtherSessions + minutesThisSession;
            const int freeLimitMinutes = 180; // 3 hours
            if (totalMinutesThisMonth > freeLimitMinutes)
            {
                _logger.LogInformation("FinishSession: user {UserId} over free limit ({Total} min)", userId, totalMinutesThisMonth);
                return StatusCode(403, new
                {
                    error = "Free tier is limited to 3 hours of recording per month.",
                    code = "FREE_LIMIT_EXCEEDED",
                    minutesUsed = totalMinutesThisMonth,
                    limitMinutes = freeLimitMinutes,
                    upgradeUrl = "/#upgrade"
                });
            }
        }

        await _db.SaveChangesAsync(ct);
        _logger.LogInformation("FinishSession: {SessionId} (chunks: {ChunkCount})", body.SessionId, session.ChunkCount);
        _workerTrigger.Trigger(session.Id);
        return Ok(new FinishSessionResponse { Finished = true, SessionId = session.Id });
    }

    /// <summary>
    /// List current user's sessions (for Recordings tab – only this user's data).
    /// </summary>
    [HttpGet("sessions")]
    public async Task<ActionResult<List<SessionListItemResponse>>> ListSessions(CancellationToken ct)
    {
        var userId = GetCurrentUserId();
        if (userId == null)
            return Unauthorized();
        var list = await _db.EchoSessions
            .Where(s => s.UserId == userId)
            .OrderByDescending(s => s.CreatedAt)
            .Select(s => new SessionListItemResponse
            {
                Id = s.Id,
                CreatedAt = s.CreatedAt,
                FinishedAt = s.FinishedAt,
                ChunkCount = s.ChunkCount,
                Status = s.Status ?? ""
            })
            .ToListAsync(ct);
        return Ok(list);
    }

    /// <summary>
    /// Get one session with transcript and summary (for dashboard).
    /// </summary>
    [HttpGet("session/{id:guid}")]
    public async Task<ActionResult<SessionDetailResponse>> GetSession(Guid id, CancellationToken ct)
    {
        var userId = GetCurrentUserId();
        if (userId == null)
            return Unauthorized();
        var session = await _db.EchoSessions.FindAsync([id], ct);
        if (session == null)
            return NotFound();
        if (session.UserId != userId)
            return Forbid();
        return Ok(new SessionDetailResponse
        {
            Id = session.Id,
            CreatedAt = session.CreatedAt,
            FinishedAt = session.FinishedAt,
            ChunkCount = session.ChunkCount,
            Status = session.Status ?? "",
            Transcript = session.Transcript,
            Summary = session.Summary,
            ProcessedAt = session.ProcessedAt,
            ErrorMessage = session.ErrorMessage
        });
    }

    private Guid? GetCurrentUserId()
    {
        var sub = User.FindFirst(ClaimTypes.NameIdentifier)?.Value;
        return Guid.TryParse(sub, out var id) ? id : null;
    }
}

public class StartSessionResponse
{
    public Guid SessionId { get; set; }
}

public class UploadChunkRequest
{
    public Guid SessionId { get; set; }
    public int SequenceNumber { get; set; }
    public IFormFile? File { get; set; }
}

public class FinishSessionRequest
{
    public Guid SessionId { get; set; }
}

public class HealthResponse
{
    public bool Ok { get; set; }
    public string Database { get; set; } = "";
}

public class HealthErrorResponse
{
    public bool Ok { get; set; }
    public string Error { get; set; } = "";
}

public class ErrorResponse
{
    public string Error { get; set; } = "";
}

public class UploadChunkResponse
{
    public bool Saved { get; set; }
    public int SequenceNumber { get; set; }
}

public class FinishSessionResponse
{
    public bool Finished { get; set; }
    public Guid SessionId { get; set; }
}

public class SessionListItemResponse
{
    public Guid Id { get; set; }
    public DateTime CreatedAt { get; set; }
    public DateTime? FinishedAt { get; set; }
    public int ChunkCount { get; set; }
    public string Status { get; set; } = "";
}

public class SessionDetailResponse
{
    public Guid Id { get; set; }
    public DateTime CreatedAt { get; set; }
    public DateTime? FinishedAt { get; set; }
    public int ChunkCount { get; set; }
    public string Status { get; set; } = "";
    public string? Transcript { get; set; }
    public string? Summary { get; set; }
    public DateTime? ProcessedAt { get; set; }
    public string? ErrorMessage { get; set; }
}

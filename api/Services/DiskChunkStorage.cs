namespace Echo.Api.Services;

/// <summary>
/// Stores audio chunks on local disk. Used when MinIO is not configured (e.g. local dev).
/// </summary>
public class DiskChunkStorage : IChunkStorage
{
    private readonly string _basePath;
    private readonly ILogger<DiskChunkStorage> _logger;

    public DiskChunkStorage(IWebHostEnvironment env, IConfiguration config, ILogger<DiskChunkStorage> logger)
    {
        var path = config["ChunkStorage:Path"] ?? "Data/Chunks";
        var root = env.ContentRootPath ?? ".";
        _basePath = Path.GetFullPath(Path.Combine(root, path));
        _logger = logger;
        _logger.LogInformation("Chunk storage path: {Path}", _basePath);
    }

    public async Task SaveChunkAsync(Guid sessionId, int sequenceNumber, Stream data, long size, string contentType, CancellationToken ct = default)
    {
        var dir = Path.Combine(_basePath, sessionId.ToString("N"));
        Directory.CreateDirectory(dir);
        var filePath = Path.Combine(dir, $"chunk_{sequenceNumber:D5}.webm");
        await using var fs = File.Create(filePath);
        await data.CopyToAsync(fs, ct).ConfigureAwait(false);
        _logger.LogInformation("Disk: saved session {SessionId} chunk {Seq}", sessionId, sequenceNumber);
    }
}

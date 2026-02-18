namespace Echo.Api.Services;

/// <summary>
/// Stores audio chunks for a session. PRD: extension sends one chunk every 5 minutes (and on stop);
/// .NET API appends chunks to MinIO (S3) or disk when MinIO is not configured.
/// </summary>
public interface IChunkStorage
{
    Task SaveChunkAsync(Guid sessionId, int sequenceNumber, Stream data, long size, string contentType, CancellationToken ct = default);
}

using Minio;
using Minio.DataModel.Args;

namespace Echo.Api.Services;

/// <summary>
/// Stores audio chunks in MinIO bucket echo-raw-audio (PRD). Object key: {sessionId}/chunk_{seq}.webm
/// </summary>
public class MinioChunkStorage : IChunkStorage
{
    private readonly IMinioClient _client;
    private readonly string _bucket;
    private readonly ILogger<MinioChunkStorage> _logger;
    private bool _bucketEnsured;

    public MinioChunkStorage(IMinioClient client, IConfiguration config, ILogger<MinioChunkStorage> logger)
    {
        _client = client;
        _bucket = config["MinIO:Bucket"] ?? "echo-raw-audio";
        _logger = logger;
    }

    public async Task SaveChunkAsync(Guid sessionId, int sequenceNumber, Stream data, long size, string contentType, CancellationToken ct = default)
    {
        await EnsureBucketExistsAsync(ct).ConfigureAwait(false);
        var objectName = $"{sessionId:N}/chunk_{sequenceNumber:D5}.webm";
        if (data.CanSeek)
            data.Position = 0;
        await _client.PutObjectAsync(new PutObjectArgs()
            .WithBucket(_bucket)
            .WithObject(objectName)
            .WithStreamData(data)
            .WithObjectSize(size)
            .WithContentType(contentType), ct).ConfigureAwait(false);
        _logger.LogInformation("MinIO: saved {ObjectName}", objectName);
    }

    private async Task EnsureBucketExistsAsync(CancellationToken ct)
    {
        if (_bucketEnsured) return;
        var exists = await _client.BucketExistsAsync(new BucketExistsArgs().WithBucket(_bucket), ct).ConfigureAwait(false);
        if (!exists)
        {
            await _client.MakeBucketAsync(new MakeBucketArgs().WithBucket(_bucket), ct).ConfigureAwait(false);
            _logger.LogInformation("MinIO: created bucket {Bucket}", _bucket);
        }
        _bucketEnsured = true;
    }
}

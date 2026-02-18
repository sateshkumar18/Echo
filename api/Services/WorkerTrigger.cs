namespace Echo.Api.Services;

/// <summary>
/// Calls the AI worker (Python) to process a session after finish-session. Fire-and-forget.
/// Set Worker:Url in appsettings (e.g. http://localhost:5050) to enable.
/// </summary>
public class WorkerTrigger
{
    private readonly string _baseUrl;
    private readonly IHttpClientFactory _httpClientFactory;
    private readonly ILogger<WorkerTrigger> _logger;

    public WorkerTrigger(string baseUrl, IHttpClientFactory httpClientFactory, ILogger<WorkerTrigger> logger)
    {
        _baseUrl = baseUrl?.TrimEnd('/') ?? "";
        _httpClientFactory = httpClientFactory;
        _logger = logger;
    }

    /// <summary>Trigger worker to process this session. No-op if Worker:Url is empty.</summary>
    public void Trigger(Guid sessionId)
    {
        if (string.IsNullOrEmpty(_baseUrl)) return;
        _ = Task.Run(async () =>
        {
            try
            {
                using var client = _httpClientFactory.CreateClient();
                client.Timeout = TimeSpan.FromSeconds(10);
                var url = $"{_baseUrl}/process?sessionId={sessionId}";
                var res = await client.PostAsync(url, null);
                _logger?.LogInformation("Worker trigger: {SessionId} -> {Status}", sessionId, res.StatusCode);
            }
            catch (Exception ex)
            {
                _logger?.LogWarning(ex, "Worker trigger failed for {SessionId}", sessionId);
            }
        });
    }
}

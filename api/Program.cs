using System.Text;
using System.Text.Json;
using System.Text.Json.Serialization;
using Echo.Api.Data;
using Echo.Api.Services;
using Microsoft.AspNetCore.Authentication.JwtBearer;
using Microsoft.AspNetCore.Hosting;
using Microsoft.EntityFrameworkCore;
using Microsoft.IdentityModel.Tokens;
using Minio;

var builder = WebApplication.CreateBuilder(args);

builder.Services.AddControllers()
    .AddJsonOptions(options =>
    {
        // Serialize all DateTime as UTC with "Z" so the frontend gets exact time (no timezone confusion).
        options.JsonSerializerOptions.Converters.Add(new JsonConverterForDateTime());
        options.JsonSerializerOptions.Converters.Add(new JsonConverterForNullableDateTime());
    });
builder.Services.AddEndpointsApiExplorer();
builder.Services.AddSwaggerGen(options =>
{
    options.CustomSchemaIds(type => type.Name);
    options.SchemaFilter<Echo.Api.Swagger.FormFileSchemaFilter>();
});

builder.Services.AddDbContext<EchoDbContext>(options =>
{
    var connectionString = builder.Configuration.GetConnectionString("EchoDb");
    options.UseNpgsql(connectionString, npgsql =>
    {
        // Retry on transient failures (e.g. "connection forcibly closed by remote host" when using remote DB).
        npgsql.EnableRetryOnFailure(maxRetryCount: 3, maxRetryDelay: TimeSpan.FromSeconds(5), errorCodesToAdd: null);
        // Allow longer for slow or high-latency remote DB (default 30s).
        npgsql.CommandTimeout(60);
    });
});

// PRD: .NET API appends chunks to MinIO (echo-raw-audio). If MinIO not configured, use disk (local dev).
var minioEndpoint = builder.Configuration["MinIO:Endpoint"];
if (!string.IsNullOrWhiteSpace(minioEndpoint))
{
    builder.Services.AddSingleton<IMinioClient>(sp =>
    {
        var config = sp.GetRequiredService<IConfiguration>();
        var accessKey = config["MinIO:AccessKey"];
        var secretKey = config["MinIO:SecretKey"];
        var b = new MinioClient().WithEndpoint(minioEndpoint.Trim());
        if (!string.IsNullOrWhiteSpace(accessKey))
            b = b.WithCredentials(accessKey.Trim(), (secretKey ?? "").Trim());
        return b.Build();
    });
    builder.Services.AddScoped<IChunkStorage, MinioChunkStorage>();
}
else
{
    builder.Services.AddScoped<IChunkStorage, DiskChunkStorage>();
}

builder.Services.AddHttpClient();
builder.Services.AddSingleton<WorkerTrigger>(sp =>
{
    var config = sp.GetRequiredService<IConfiguration>();
    var url = config["Worker:Url"]?.Trim() ?? "";
    var factory = sp.GetRequiredService<IHttpClientFactory>();
    var logger = sp.GetRequiredService<ILogger<WorkerTrigger>>();
    return new WorkerTrigger(url, factory, logger);
});

// CORS: production sets Cors:AllowedOrigins (e.g. ["https://app.echo.com","chrome-extension://id"]); dev allows localhost + chrome-extension
var allowedOrigins = builder.Configuration.GetSection("Cors:AllowedOrigins").Get<string[]>() ?? [];
// JWT: production sets Auth:JwtSecret in config or JWT_SECRET env (min 32 chars)
var jwtSecret = builder.Configuration["Auth:JwtSecret"] ?? Environment.GetEnvironmentVariable("JWT_SECRET") ?? "";
if (!string.IsNullOrEmpty(jwtSecret))
{
    var key = new SymmetricSecurityKey(Encoding.UTF8.GetBytes(jwtSecret));
    builder.Services.AddAuthentication(JwtBearerDefaults.AuthenticationScheme)
        .AddJwtBearer(options =>
        {
            options.TokenValidationParameters = new TokenValidationParameters
            {
                ValidateIssuerSigningKey = true,
                IssuerSigningKey = key,
                ValidateIssuer = true,
                ValidIssuer = builder.Configuration["Auth:JwtIssuer"] ?? "Echo",
                ValidateAudience = true,
                ValidAudience = builder.Configuration["Auth:JwtAudience"] ?? "Echo",
                ValidateLifetime = true,
                ClockSkew = TimeSpan.Zero
            };
        });
    builder.Services.AddAuthorization();
}

builder.Services.AddCors(options =>
{
    options.AddDefaultPolicy(policy =>
    {
        policy.AllowAnyMethod().AllowAnyHeader();
        if (allowedOrigins.Length > 0)
            policy.WithOrigins(allowedOrigins);
        else
            policy.SetIsOriginAllowed(origin =>
                origin == null ||
                origin.StartsWith("http://localhost", StringComparison.OrdinalIgnoreCase) ||
                origin.StartsWith("chrome-extension://", StringComparison.OrdinalIgnoreCase));
    });
});

var app = builder.Build();

var isProduction = app.Environment.IsProduction();
var swaggerInProduction = builder.Configuration.GetValue<bool>("Cors:SwaggerInProduction");
var swaggerBasePath = (builder.Configuration["Swagger:BasePath"] ?? "swagger").Trim().TrimEnd('/');
if (!isProduction || swaggerInProduction)
{
    app.UseSwagger(c => c.RouteTemplate = $"{swaggerBasePath}/{{documentName}}/swagger.json");
    app.UseSwaggerUI(c =>
    {
        c.SwaggerEndpoint($"/{swaggerBasePath}/v1/swagger.json", "Echo API");
        c.RoutePrefix = swaggerBasePath;
    });
}

using (var scope = app.Services.CreateScope())
{
    var db = scope.ServiceProvider.GetRequiredService<EchoDbContext>();
    var logger = scope.ServiceProvider.GetRequiredService<ILogger<Program>>();
    try
    {
        await db.Database.EnsureCreatedAsync();
        logger.LogInformation("Database ensured: echo_sessions table ready.");
    }
    catch (Exception ex)
    {
        logger.LogError(ex, "Database ensure failed. Run api/Scripts/create_echo_sessions.sql manually on your 'echo' database.");
    }
}

app.UseCors();
app.UseAuthentication();
app.UseAuthorization();

// Global exception handler: production must not leak exception details to clients
app.UseExceptionHandler(err =>
{
    err.Run(async ctx =>
    {
        ctx.Response.StatusCode = 500;
        ctx.Response.ContentType = "application/json";
        var ex = ctx.Features.Get<Microsoft.AspNetCore.Diagnostics.IExceptionHandlerFeature>()?.Error;
        var isProduction = ctx.RequestServices.GetRequiredService<IWebHostEnvironment>().IsProduction();
        var message = isProduction ? "An error occurred. Please try again later." : (ex?.Message ?? "An error occurred.");
        if (ex != null && !isProduction)
            ctx.RequestServices.GetRequiredService<ILogger<Program>>()?.LogError(ex, "Unhandled exception");
        await ctx.Response.WriteAsJsonAsync(new { error = message });
    });
});

// Root: redirect to Swagger when enabled, else 404
app.MapGet("/", () =>
{
    if (!isProduction || swaggerInProduction)
        return Results.Redirect($"/{swaggerBasePath}", permanent: false);
    return Results.NotFound();
});

app.MapControllers();

app.Run();

/// <summary>Serialize DateTime as UTC with "Z" so the frontend always gets exact time.</summary>
file sealed class JsonConverterForDateTime : JsonConverter<DateTime>
{
    public override DateTime Read(ref Utf8JsonReader reader, Type typeToConvert, JsonSerializerOptions options)
        => DateTime.Parse(reader.GetString()!);

    public override void Write(Utf8JsonWriter writer, DateTime value, JsonSerializerOptions options)
    {
        var utc = value.Kind == DateTimeKind.Utc ? value : DateTime.SpecifyKind(value, DateTimeKind.Utc);
        writer.WriteStringValue(utc.ToString("O"));
    }
}

file sealed class JsonConverterForNullableDateTime : JsonConverter<DateTime?>
{
    public override DateTime? Read(ref Utf8JsonReader reader, Type typeToConvert, JsonSerializerOptions options)
        => reader.TokenType == JsonTokenType.Null ? null : DateTime.Parse(reader.GetString()!);

    public override void Write(Utf8JsonWriter writer, DateTime? value, JsonSerializerOptions options)
    {
        if (value == null) { writer.WriteNullValue(); return; }
        var v = value.GetValueOrDefault();
        var utc = v.Kind == DateTimeKind.Utc ? v : DateTime.SpecifyKind(v, DateTimeKind.Utc);
        writer.WriteStringValue(utc.ToString("O"));
    }
}

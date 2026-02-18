# Echo API (.NET 8)

Backend for Echo: manages recording sessions and stores chunk metadata in PostgreSQL.  
**PRD:** Audio chunks are stored in MinIO bucket `echo-raw-audio`. If MinIO is not configured, chunks are stored on disk under `Data/Chunks/{sessionId}/`.

## Prerequisites

- .NET 8 SDK
- PostgreSQL running locally with database `echo` and user `postgres` (no password for localhost)

## Run

```powershell
cd api
dotnet restore
dotnet run
```

API will be at **http://localhost:5012** (see `Properties/launchSettings.json`).

- **Swagger:** http://localhost:5012/swagger
- **Health (check DB):** `GET http://localhost:5012/echo/health` — should return `{ "ok": true, "database": "connected" }`
- **Start session:** `POST /echo/start-session`
- **Upload chunk:** `POST /echo/upload-chunk` (form: sessionId, sequenceNumber, file)
- **Finish session:** `POST /echo/finish-session` (body: `{ "sessionId": "guid" }`)

## Connection string

In `appsettings.json`:

```json
"ConnectionStrings": {
  "EchoDb": "Host=localhost;Port=5432;Database=echo;Username=postgres;"
}
```

If you add a password later, use: `Password=yourpassword;`

## MinIO (optional, PRD)

To store chunks in MinIO (S3-compatible) instead of disk, set in `appsettings.json` or `appsettings.Development.json`:

```json
"MinIO": {
  "Endpoint": "localhost:9000",
  "AccessKey": "minioadmin",
  "SecretKey": "minioadmin",
  "Bucket": "echo-raw-audio"
}
```

Leave `Endpoint` empty to use disk storage (local dev). The API creates the bucket if it does not exist.

## First run

On first run, the API creates the `echo_sessions` table in your `echo` database automatically.

## Extension integration

When the Echo extension records, it will:

1. Call `POST /echo/start-session` when you click **Start** → gets `sessionId` and stores it in PostgreSQL.
2. Call `POST /echo/upload-chunk` every 5 minutes (and on stop) → saves audio chunks to MinIO (or disk if MinIO not configured).
3. Call `POST /echo/finish-session` when you click **Stop** → marks the session as finished in the DB.

**Make sure the API is running** (`dotnet run` in the `api` folder) before you start recording, or the extension will fall back to local-only (IndexedDB) and still save recordings in the browser.

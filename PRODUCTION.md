# Production checklist – Echo

Use this list before deploying to production.

## Secrets (critical)

- **API**
  - Do **not** commit `api/appsettings.Development.json` (it is gitignored). Use `appsettings.Development.example.json` as a template for local dev.
  - In production, set secrets via **environment variables** or a secure config store (e.g. Azure Key Vault, AWS Secrets Manager), not in committed files:
    - `ConnectionStrings__EchoDb` or override in appsettings.Production (if not committed)
    - `JWT_SECRET` or `Auth__JwtSecret` (min 32 characters)
    - MinIO: `MinIO__Endpoint`, `MinIO__AccessKey`, `MinIO__SecretKey` if using object storage
  - `appsettings.Production.json` has empty placeholders by design; fill via env in production.

- **Worker**
  - **Production:** You **must** set `ECHO_DATABASE_URL` in the server environment. If you don’t, the worker falls back to `postgresql://postgres:postgres@localhost:5432/Echo`, which is wrong in production (and can point at the wrong DB or fail). No secrets are in the repo; the default is for local dev only.
  - **Local:** Use `worker/.env` (copy from `worker/.env.example`) or leave unset to use the default localhost URL.

## API

- **HTTPS**: Run behind a reverse proxy (IIS, nginx, Caddy) with TLS. Do not expose Kestrel directly to the internet without HTTPS.
- **CORS**: Set `Cors:AllowedOrigins` in production to your dashboard origin and Chrome extension origin (e.g. `chrome-extension://YOUR_EXTENSION_ID`). Empty array means only localhost + chrome-extension are allowed (acceptable if extension is the only client).
- **Swagger**: Disabled by default in production (`Cors:SwaggerInProduction: false`). Do not enable on a public URL without auth.
- **Errors**: In production, the API returns a generic message for unhandled exceptions; details are logged server-side only.
- **Environment**: Set `ASPNETCORE_ENVIRONMENT=Production`.

## Extension

- **API URL**: Users set the production API base URL in the extension (no hardcoded production URL).
- **Token**: Stored in `chrome.storage.local`; no secrets in code.
- **Host permissions**: `*://*/*` and localhost; for production you may restrict `host_permissions` to your API domain once fixed.

## Database

- You can use the **same** database for both local and production: API and worker point at it (local: appsettings.Development.json + worker/.env; production: env vars for both).
- Run all scripts in `api/Scripts/` in order (create tables, add users/auth, subscription_tier) on that DB.
- Use a dedicated DB user with minimal required privileges (no superuser in production).
- Prefer connection pooling and a managed DB (e.g. Azure PostgreSQL, RDS) with backups.

## Worker

- Set `ECHO_DATABASE_URL`, and if using MinIO set `ECHO_MINIO_*` (or use disk storage).
- Run behind a firewall or private network; the API calls the worker by URL (`Worker:Url`). Prefer HTTPS and authentication for worker endpoints in production.
- Set `LOG_LEVEL=WARNING` or `INFO` in production to reduce log volume.

## Quick “production safe” summary

| Item | Status |
|------|--------|
| JWT from config/env, not hardcoded | Yes |
| DB / Stripe / MinIO secrets from env or secure config | Yes. In production always set ECHO_DATABASE_URL (worker default is localhost only). |
| Production API hides exception details | Yes |
| CORS configurable for production | Yes |
| Swagger off in production by default | Yes |
| BCrypt for passwords | Yes |
| Auth on Echo endpoints + ownership checks | Yes |
| HTTPS / reverse proxy | You must configure |
| Rate limiting | Not implemented (consider for login/register) |
| Extension API URL user-configurable | Yes |

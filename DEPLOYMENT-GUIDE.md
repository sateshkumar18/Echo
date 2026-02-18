# ASP.NET Core Backend: Complete Deployment & DevOps Guide

A step-by-step professional guide for initializing your project on GitHub, preparing for production, deploying (IIS / Azure / Docker), exposing the API publicly, connecting Chrome/Edge extensions, and testing end-to-end.

---

# Part 1: Initialize and Push to GitHub

## 1.1 Initialize Git

From your project root (e.g. `Echo1.0`):

```powershell
cd C:\Users\YourName\Desktop\Echo1.0
git init
```

**What this does:** Creates a `.git` folder and makes the current folder a Git repository. All version history will live here.

---

## 1.2 Create .gitignore for ASP.NET Core

Create or update `.gitignore` in the project root so build outputs, secrets, and IDE files are never committed.

**Recommended .gitignore (merge with existing content):**

```gitignore
# ========== ASP.NET Core ==========
[Bb]in/
[Oo]bj/
[Ll]og/
[Ll]ogs/
[Dd]ebug/
[Rr]elease/
*.user
*.userosscache
*.suo
*.cache
*.dll
*.exe
*.pdb
*.log
*.vspscc
*.vssscc
.builds
*.pidb
*.scc
*.sln.docstates
project.lock.json
project.fragment.lock.json
artifacts/
**/Properties/launchSettings.json

# Publish output
**/publish/
**/PublishProfiles/

# ========== Secrets & local config ==========
# Never commit real connection strings or JWT secrets
api/appsettings.Development.json
**/appsettings.*.local.json
*.pfx

# ========== Environment ==========
.env
.env.local
.env.*.local
worker/.env

# ========== Python ==========
.venv/
venv/
__pycache__/
*.pyc

# ========== Node / Next.js ==========
dashboard/node_modules/
dashboard/.next/
dashboard/.env.local

# ========== IDE / OS ==========
.vs/
.idea/
*.swp
.DS_Store
Thumbs.db

# ========== Optional (uncomment if you use) ==========
# api/Data/Chunks/
# *.zip
```

**Why it matters:**  
- `bin/`, `obj/` are regenerated on build; committing them bloats the repo and causes merge noise.  
- `appsettings.Development.json` often contains DB passwords and JWT secrets; must stay local.  
- `.env` and worker `.env` hold production URLs and keys; never in Git.

---

## 1.3 First Commit

```powershell
git add .
git status
```

Review the list; ensure no `appsettings.Development.json`, `.env`, or `bin/` appear. If they do, add them to `.gitignore` and run `git add .` again.

```powershell
git commit -m "Initial commit: ASP.NET Core API, worker, extension, dashboard"
```

**Best practice:** One logical unit per commit. First commit = full working codebase (minus secrets).

---

## 1.4 Connect to Remote Repository

**On GitHub:** Create a new repository (e.g. `Echo` or `echo-backend`). Do **not** initialize with README if you already have code.

Then in your project folder:

```powershell
git remote add origin https://github.com/YOUR_USERNAME/YOUR_REPO_NAME.git
```

Example:

```powershell
git remote add origin https://github.com/yourorg/echo.git
```

Verify:

```powershell
git remote -v
```

You should see `origin` pointing to your GitHub URL.

---

## 1.5 Push Code

```powershell
git branch -M main
git push -u origin main
```

- `git branch -M main` renames the current branch to `main` (GitHub default).  
- `git push -u origin main` uploads your commits and sets `origin/main` as the upstream for `main`.

If GitHub prompts for auth, use a **Personal Access Token** (Settings → Developer settings → Personal access tokens) as the password when using HTTPS.

---

## 1.6 Branching Best Practices

| Branch      | Use for |
|------------|---------|
| `main`     | Production-ready code only. Protected; all changes via Pull Requests. |
| `develop`  | Integration branch for features (optional). |
| `feature/*`| New features, e.g. `feature/payments`. |
| `fix/*`    | Bug fixes, e.g. `fix/cors-extension`. |
| `release/*`| Release prep and version bumps (optional). |

**Example workflow:**

```powershell
# New feature
git checkout -b feature/my-feature
# ... make changes ...
git add .
git commit -m "Add my feature"
git push -u origin feature/my-feature
# Then open a Pull Request on GitHub: feature/my-feature → main
```

**Rule of thumb:** Never commit secrets. Never force-push to `main`. Use PRs and (optional) branch protection.

---

# Part 2: Prepare the Project for Production

## 2.1 Production Configuration

**Environment:** The API must run with `ASPNETCORE_ENVIRONMENT=Production` so that:

- `appsettings.Production.json` is loaded (and overrides `appsettings.json`).
- Development exception pages are disabled.
- Optimizations and production behaviors are used.

**Set in deployment:**

- **IIS:** Set in Application Pool or web.config (see Part 3.1).  
- **Azure App Service:** Application settings → `ASPNETCORE_ENVIRONMENT` = `Production`.  
- **Docker:** `ENV ASPNETCORE_ENVIRONMENT=Production` in Dockerfile or `-e ASPNETCORE_ENVIRONMENT=Production` at runtime.

---

## 2.2 Environment Variables (Preferred in Production)

**Principle:** Keep secrets and environment-specific values out of committed files. Use environment variables or a secret store (Azure Key Vault, AWS Secrets Manager).

**ASP.NET Core** reads env vars with double underscore as hierarchy:

- `ConnectionStrings__EchoDb` → `Configuration["ConnectionStrings:EchoDb"]`
- `Auth__JwtSecret` → `Configuration["Auth:JwtSecret"]`

**Example (PowerShell, for local test):**

```powershell
$env:ASPNETCORE_ENVIRONMENT = "Production"
$env:ConnectionStrings__EchoDb = "Host=my-db.server.com;Port=5432;Database=echo;Username=echo_app;Password=SECURE_PASSWORD;SSL Mode=Require;"
$env:Auth__JwtSecret = "YourProductionJwtSecretAtLeast32CharactersLong"
dotnet run --project api
```

**Example (Linux / Docker):**

```bash
export ASPNETCORE_ENVIRONMENT=Production
export ConnectionStrings__EchoDb="Host=db;Port=5432;Database=echo;..."
export Auth__JwtSecret="YourProductionJwtSecretAtLeast32CharactersLong"
dotnet api/Echo.Api.dll
```

---

## 2.3 appsettings Configuration

**Keep in repo (no secrets):**

- `appsettings.json` – defaults, empty or placeholder values.  
- `appsettings.Production.json` – empty or placeholders; real values from env or secret store.

**Example `appsettings.Production.json` (placeholders only):**

```json
{
  "ConnectionStrings": {
    "EchoDb": ""
  },
  "Auth": {
    "JwtSecret": "",
    "JwtIssuer": "Echo",
    "JwtAudience": "Echo"
  },
  "Worker": {
    "Url": ""
  },
  "Cors": {
    "AllowedOrigins": [],
    "SwaggerInProduction": false
  },
  "Logging": {
    "LogLevel": {
      "Default": "Warning",
      "Microsoft.AspNetCore": "Warning"
    }
  }
}
```

**In production,** set real values via:

- Environment variables (e.g. `ConnectionStrings__EchoDb`, `Auth__JwtSecret`, `Cors__AllowedOrigins__0`, `Cors__AllowedOrigins__1` for arrays), or  
- Secure config (Key Vault, etc.) and load in code if needed.

**Array in env (e.g. CORS origins):**

- Azure: Application settings → `Cors__AllowedOrigins__0` = `https://app.echo.com`, `Cors__AllowedOrigins__1` = `chrome-extension://abcdefghijklmnop`.  
- Docker: `-e Cors__AllowedOrigins__0=https://app.echo.com` `-e Cors__AllowedOrigins__1=chrome-extension://...`

---

## 2.4 Database Connection Setup

**Production checklist:**

1. Use a **dedicated DB user** with minimal privileges (no superuser).  
2. **SSL:** Prefer `SSL Mode=Require` (or `Prefer`) in the connection string for managed Postgres (e.g. Azure, AWS RDS).  
3. **Connection string** only in env or secret store, never in committed appsettings.  
4. **Connection pooling:** Default in Npgsql is fine; for high load, tune pool size if needed.

**Example production-style connection string (value from env):**

```
Host=your-db.postgres.database.azure.com;Port=5432;Database=echo;Username=echo_app;Password=YOUR_PASSWORD;SSL Mode=Require;Trust Server Certificate=false;Timeout=60;
```

---

## 2.5 Build Configuration (Release Mode)

Always publish in **Release** for production:

```powershell
cd api
dotnet publish -c Release -o ./publish
```

- `-c Release` – Release configuration (optimizations, no debug symbols in output).  
- `-o ./publish` – Output folder (can be different, e.g. for IIS or Docker).

**Self-contained (optional):** If the server doesn’t have .NET runtime:

```powershell
dotnet publish -c Release -r win-x64 --self-contained true -o ./publish
# or for Linux:
dotnet publish -c Release -r linux-x64 --self-contained true -o ./publish
```

For most hosting (IIS with runtime, Azure, Docker with runtime image), **framework-dependent** publish (no `-r`) is enough.

---

## 2.6 Security Best Practices

| Item | Action |
|------|--------|
| **JWT secret** | Min 32 characters; cryptographically random; from env or secret store. |
| **HTTPS** | Always in production; use a reverse proxy (IIS, nginx, Azure) with TLS. |
| **CORS** | Explicit allowlist: dashboard origin + `chrome-extension://YOUR_EXTENSION_ID`. Never `*` in production. |
| **Errors** | Don’t return stack traces or internal details to clients; log them server-side. |
| **Passwords** | BCrypt (or similar); never store plain text. |
| **DB** | Least-privilege user; connection string only in env/secrets. |
| **Swagger** | Disabled in production by default; enable only behind auth if needed. |
| **Headers** | Consider HSTS, X-Content-Type-Options, etc. (often added by reverse proxy). |

---

# Part 3: Deploy the Backend

## 3.1 Option 1: Deploy to IIS (Windows Server)

**Prerequisites:** Windows Server with IIS and ASP.NET Core Hosting Bundle installed.

**Step 1 – Install .NET runtime (if not using self-contained):**

- Download and install **.NET 8 Runtime (Hosting Bundle)** from Microsoft.  
- Restart IIS: `iisreset` (or recycle app pool).

**Step 2 – Publish the API:**

```powershell
cd C:\Users\YourName\Desktop\Echo1.0\api
dotnet publish -c Release -o C:\inetpub\echo-api
```

(Use a path your server can read; e.g. `C:\inetpub\echo-api` or a dedicated app folder.)

**Step 3 – Create the site in IIS:**

1. Open **IIS Manager** → Sites → Add Website.  
2. **Site name:** e.g. `EchoApi`.  
3. **Physical path:** `C:\inetpub\echo-api` (or your publish path).  
4. **Binding:** Leave port 80 for now (HTTPS in Part 4).  
5. **Application Pool:** Create new; .NET CLR = “No Managed Code”; Start application pool = true.

**Step 4 – Set environment and permissions:**

- Application Pool → Advanced Settings → set **Environment Variables** (optional):  
  `ASPNETCORE_ENVIRONMENT` = `Production`.  
- Or in `web.config` (see below).  
- Ensure the app pool identity has **read** access to the site folder.

**Step 5 – web.config (created by publish; verify):**

Publish creates `web.config`. It should look similar to:

```xml
<?xml version="1.0" encoding="utf-8"?>
<configuration>
  <location path="." inheritInChildApplications="false">
    <system.webServer>
      <handlers>
        <add name="aspNetCore" path="*" verb="*" modules="AspNetCoreModuleV2" resourceType="Unspecified" />
      </handlers>
      <aspNetCore processPath="dotnet"
                  arguments=".\Echo.Api.dll"
                  stdoutLogEnabled="false"
                  stdoutLogFile=".\logs\stdout"
                  hostingModel="inprocess" />
    </system.webServer>
  </location>
</configuration>
```

To set environment in web.config, add inside `<aspNetCore>`:

```xml
<environmentVariables>
  <environmentVariable name="ASPNETCORE_ENVIRONMENT" value="Production" />
  <environmentVariable name="ConnectionStrings__EchoDb" value="YOUR_CONNECTION_STRING" />
  <environmentVariable name="Auth__JwtSecret" value="YOUR_JWT_SECRET" />
</environmentVariables>
```

**Better:** Don’t put secrets in web.config; use **Machine-level environment variables** or IIS Application Pool → Advanced → Environment Variables so they aren’t in the folder.

**Step 6 – Start site and test:**

- Start the site; browse to `http://localhost` (or your binding).  
- Example: `http://localhost/echo/health` should return JSON.

---

## 3.2 Option 2: Deploy to Azure App Service

**Step 1 – Create the App Service:**

- Azure Portal → Create a resource → Web App.  
- Runtime: **.NET 8 (LTS)**.  
- Region, plan (B1 or higher for always-on if needed).  
- Create.

**Step 2 – Configure Application settings (env vars):**

In the App Service → Configuration → Application settings, add:

| Name | Value |
|------|--------|
| `ASPNETCORE_ENVIRONMENT` | `Production` |
| `ConnectionStrings__EchoDb` | Your Postgres connection string |
| `Auth__JwtSecret` | Your JWT secret (min 32 chars) |
| `Auth__JwtIssuer` | `Echo` |
| `Auth__JwtAudience` | `Echo` |
| `Worker__Url` | e.g. `https://your-worker.azurewebsites.net` |
| `Cors__AllowedOrigins__0` | `https://your-dashboard.azurestaticapps.net` |
| `Cors__AllowedOrigins__1` | `chrome-extension://YOUR_EXTENSION_ID` |

For arrays, use `__0`, `__1`, etc. Save.

**Step 3 – Deploy code:**

**Option A – From local publish:**

```powershell
cd api
dotnet publish -c Release -o ./publish
# Then use Azure CLI or VS Code Azure extension to deploy the ./publish folder, or
# zip the publish folder and use "Deploy to App Service" in Portal (Advanced) with the zip.
```

**Option B – GitHub Actions (example):**

Create `.github/workflows/deploy-api.yml`:

```yaml
name: Deploy API to Azure
on:
  push:
    branches: [main]
    paths:
      - 'api/**'
jobs:
  build-and-deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-dotnet@v4
        with:
          dotnet-version: '8.0.x'
      - run: dotnet publish api/Echo.Api.csproj -c Release -o publish
      - uses: azure/webapps-deploy@v2
        with:
          app-name: 'YOUR_APP_SERVICE_NAME'
          publish-profile: ${{ secrets.AZURE_WEBAPP_PUBLISH_PROFILE }}
          package: ./publish
```

Add `AZURE_WEBAPP_PUBLISH_PROFILE` in repo Secrets (download from App Service → Get publish profile).

**Step 4 – Test:** Open `https://YOUR_APP.azurewebsites.net/echo/health`.

---

## 3.3 Option 3: Deploy to VPS Using Docker

**Step 1 – Dockerfile for the API (in repo root or `api/`):**

Create `api/Dockerfile`:

```dockerfile
FROM mcr.microsoft.com/dotnet/aspnet:8.0 AS base
WORKDIR /app
EXPOSE 80
EXPOSE 443

FROM mcr.microsoft.com/dotnet/sdk:8.0 AS build
WORKDIR /src
COPY ["api/Echo.Api.csproj", "api/"]
RUN dotnet restore "api/Echo.Api.csproj"
COPY api/ api/
WORKDIR "/src/api"
RUN dotnet build "Echo.Api.csproj" -c Release -o /app/build

FROM build AS publish
RUN dotnet publish "Echo.Api.csproj" -c Release -o /app/publish /p:UseAppHost=false

FROM base AS final
WORKDIR /app
COPY --from=publish /app/publish .
ENV ASPNETCORE_URLS=http://+:80
ENV ASPNETCORE_ENVIRONMENT=Production
ENTRYPOINT ["dotnet", "Echo.Api.dll"]
```

**Step 2 – Build and run on the VPS (or from CI):**

```bash
# On the VPS (or build and push to a registry)
cd /path/to/Echo1.0
docker build -t echo-api:latest -f api/Dockerfile .

docker run -d --name echo-api \
  -p 5000:80 \
  -e ASPNETCORE_ENVIRONMENT=Production \
  -e ConnectionStrings__EchoDb="Host=postgres;Port=5432;Database=echo;Username=echo;Password=SECRET;SSL Mode=Require" \
  -e Auth__JwtSecret="YOUR_JWT_SECRET_MIN_32_CHARS" \
  -e Worker__Url="http://worker:5050" \
  -e Cors__AllowedOrigins__0="https://app.echo.com" \
  -e Cors__AllowedOrigins__1="chrome-extension://YOUR_EXTENSION_ID" \
  --restart unless-stopped \
  echo-api:latest
```

**Step 3 – With docker-compose (API + DB + optional worker):**

Example `docker-compose.yml` at repo root:

```yaml
version: '3.8'
services:
  api:
    build:
      context: .
      dockerfile: api/Dockerfile
    ports:
      - "5000:80"
    environment:
      - ASPNETCORE_ENVIRONMENT=Production
      - ConnectionStrings__EchoDb=Host=db;Port=5432;Database=echo;Username=echo;Password=${DB_PASSWORD}
      - Auth__JwtSecret=${JWT_SECRET}
      - Worker__Url=http://worker:5050
      - Cors__AllowedOrigins__0=https://app.echo.com
      - Cors__AllowedOrigins__1=chrome-extension://YOUR_EXTENSION_ID
    depends_on:
      - db
    restart: unless-stopped

  db:
    image: postgres:16-alpine
    environment:
      POSTGRES_DB: echo
      POSTGRES_USER: echo
      POSTGRES_PASSWORD: ${DB_PASSWORD}
    volumes:
      - pgdata:/var/lib/postgresql/data
    restart: unless-stopped

  # worker:
  #   build: ./worker
  #   environment:
  #     ECHO_DATABASE_URL: postgresql://echo:${DB_PASSWORD}@db:5432/echo
  #   depends_on:
  #     - db

volumes:
  pgdata:
```

Run: `docker-compose --env-file .env up -d`. Use `.env` for `DB_PASSWORD`, `JWT_SECRET` (not committed).

---

# Part 4: Make the API Publicly Accessible

## 4.1 Domain Setup

- **IIS:** Bind the site to a host name (e.g. `api.echo.com`) and ensure DNS A or CNAME points to the server IP.  
- **Azure:** Custom domain in App Service → Add custom domain; add the CNAME or A record as shown.  
- **VPS/Docker:** Point your domain’s A record to the VPS IP; in nginx/Caddy use `server_name api.echo.com`.

---

## 4.2 HTTPS Configuration

**Principle:** Terminate TLS at the reverse proxy (IIS, nginx, Caddy, or Azure front end). Don’t expose Kestrel directly to the internet.

**IIS:**

1. Install the certificate (e.g. from Let’s Encrypt or your CA) in the server’s certificate store.  
2. In IIS → Site → Bindings → Add: https, port 443, select the certificate.  
3. Optionally add a redirect from HTTP to HTTPS (or use URL Rewrite).

**Azure:** App Service → TLS/SSL → Bind a custom domain with a certificate (App Service Managed Certificate or your own).

**VPS (Caddy example):**

```text
api.echo.com {
    reverse_proxy echo-api:80
}
```

Caddy obtains and renews TLS automatically. The API runs behind it on port 80 inside the network.

---

## 4.3 CORS Configuration for Chrome/Edge Extension

**Important:** Browser extensions use an origin like `chrome-extension://EXTENSION_ID`. You must allow that exact origin; wildcards don’t match it.

**In your API (already in Echo):**

- When `Cors:AllowedOrigins` is non-empty, the API uses that list.  
- Add exactly:
  - Your dashboard origin: `https://app.echo.com` (or your real URL).  
  - Extension origin: `chrome-extension://YOUR_EXTENSION_ID` (and for Edge: `extension://...` if different).

**How to get the extension ID:**

- Chrome: `chrome://extensions` → enable Developer mode → ID under the extension.  
- Edge: `edge://extensions` → same.  
- For **published** extensions, the ID is fixed. For unpacked dev, it can change when you reload; use the same ID in CORS that the browser sends in the `Origin` header.

**Production config example:**

- Env: `Cors__AllowedOrigins__0=https://app.echo.com`  
- Env: `Cors__AllowedOrigins__1=chrome-extension://abcdefghijklmnopqrstuvwxyz123456`  
- Env: `Cors__AllowedOrigins__2=extension://abcdefghijklmnopqrstuvwxyz123456` (if you need Edge with a different scheme)

**Never use `*` for CORS in production** when the API uses credentials (e.g. JWT in headers). Explicit allowlist only.

---

# Part 5: Connect Backend to Chrome and Edge Extensions

## 5.1 CORS Summary

- Backend must respond with `Access-Control-Allow-Origin: chrome-extension://YOUR_ID` (and your dashboard origin).  
- Backend must allow the methods you use (GET, POST, etc.) and headers (`Authorization`, `Content-Type`).  
- Your Echo API already uses `AllowAnyMethod()` and `AllowAnyHeader()` with `WithOrigins(allowedOrigins)` when origins are configured; that is correct for extension + dashboard.

---

## 5.2 manifest.json (Host Permissions)

Extensions need **host_permissions** for the API base URL so they can call it from the service worker or popup.

**Example (Chrome Manifest V3):**

```json
{
  "manifest_version": 3,
  "name": "Echo – Meeting Recorder",
  "version": "1.0.0",
  "host_permissions": [
    "https://api.echo.com/*",
    "http://localhost:5012/*"
  ],
  "permissions": ["storage", "activeTab"]
}
```

- `https://api.echo.com/*` – production API.  
- `http://localhost:5012/*` – local dev.  
- Use your real API base URL; the extension will send requests to the URL the user configures (often stored in `chrome.storage` and used as base for all API calls).

---

## 5.3 Calling the API from the Extension (fetch)

**Get API base URL from storage (user-configurable):**

```javascript
const base = (await chrome.storage.local.get('echoApiBase')).echoApiBase || 'https://api.echo.com';
const token = (await chrome.storage.local.get('echoAuthToken')).echoAuthToken;
```

**Example – GET (list sessions):**

```javascript
const response = await fetch(`${base.replace(/\/$/, '')}/echo/sessions`, {
  method: 'GET',
  headers: {
    'Authorization': `Bearer ${token}`,
    'Content-Type': 'application/json',
  },
});
if (!response.ok) throw new Error(await response.text());
const sessions = await response.json();
```

**Example – POST (login):**

```javascript
const response = await fetch(`${base.replace(/\/$/, '')}/auth/login`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ email, password }),
});
const data = await response.json();
if (!response.ok) throw new Error(data.error || 'Login failed');
// Store token: chrome.storage.local.set({ echoAuthToken: data.token });
```

**Example – POST with FormData (upload chunk):**

```javascript
const form = new FormData();
form.append('SessionId', sessionId);
form.append('SequenceNumber', sequenceNumber);
form.append('File', blob, 'chunk.webm');
const response = await fetch(`${base}/echo/upload-chunk`, {
  method: 'POST',
  headers: { 'Authorization': `Bearer ${token}` },
  body: form,
});
```

**CORS:** Browser will send `Origin: chrome-extension://YOUR_ID`. Your API must include that in `Access-Control-Allow-Origin` (see Part 4.3).

---

## 5.4 Handling Authentication (JWT)

- **Login/Register:** POST to `/auth/login` or `/auth/register`; receive `token` and optionally `user`.  
- **Storage:** Save token in `chrome.storage.local` (e.g. `echoAuthToken`) and API base in `echoApiBase`.  
- **Every API request:** Add header `Authorization: Bearer <token>`.  
- **Expiry:** If the API returns 401, clear token and show login again; optionally implement refresh if your API supports it.  
- **Logout:** Clear `echoAuthToken` (and related keys) from `chrome.storage.local`.

---

# Part 6: Test Everything End-to-End

## 6.1 Test Locally

1. **API:**  
   - Set `api/appsettings.Development.json` (or env) with DB and JWT.  
   - Run: `.\run-api.ps1` or `dotnet run --project api`.  
   - Open: `http://localhost:5012/echo/health` and `http://localhost:5012/swagger`.

2. **Extension:**  
   - Load unpacked from `extension` folder.  
   - Set API URL to `http://localhost:5012`.  
   - Register/Login, start/stop recording, check Recordings tab.

3. **Worker (if used):**  
   - Start worker; trigger `/process?sessionId=...`; confirm session moves to Completed.

---

## 6.2 Test Deployed API

1. **Health:**  
   `https://api.echo.com/echo/health` (or your URL) → expect `{"ok":true,"database":"connected"}` or similar.

2. **Auth:**  
   POST `https://api.echo.com/auth/login` with JSON body `{ "email": "...", "password": "..." }` → expect 200 and a JWT.

3. **Protected route:**  
   GET `https://api.echo.com/echo/sessions` with header `Authorization: Bearer <token>` → expect 200 and session list or `[]`.

4. **CORS (browser):**  
   From a page or extension on your allowed origin, run the same requests; there must be no CORS errors in the console.

---

## 6.3 Test from Browser Extension

1. Set the extension’s API URL to your production API (`https://api.echo.com`).  
2. Log in; confirm token is stored and sessions load.  
3. If you have recording: start/stop, then check that the session appears and (after worker) shows transcript/summary.  
4. Open DevTools (F12) for the popup or background; ensure no CORS or 401/403 errors.

---

# Part 7: Folder Structure Best Practices for Deployment

**Keep in repo:**

- Source code: `api/`, `worker/`, `extension/`, `dashboard/`.  
- Config templates: `appsettings.json`, `appsettings.Production.json` (no secrets), `appsettings.Development.example.json`.  
- Scripts: `api/Scripts/`, `run-api.ps1`, `run-worker.ps1`.  
- Docs and CI: `README.md`, `DEPLOYMENT-GUIDE.md`, `.github/workflows/`.

**Never in repo:**

- `appsettings.Development.json`, `.env`, any file with real connection strings or JWT.  
- `bin/`, `obj/`, `publish/`, `node_modules/`, `.next/`, large binary or generated assets unless intentional.

**Deployment layout (example – IIS):**

- Publish output only: `dotnet publish -o C:\inetpub\echo-api` → that folder contains `Echo.Api.dll`, `appsettings.json`, `web.config`, and dependencies. No source `.cs` files needed.  
- Same idea for Docker: image contains only runtime + publish output.

---

# Full Deployment Checklist

Use this before and after each production deploy.

## Repository & code

- [ ] Git repo initialized; `.gitignore` includes ASP.NET, secrets, and env files.
- [ ] No secrets in committed files (`appsettings.Development.json`, `.env`, connection strings, JWT in repo).
- [ ] `main` (or production branch) is protected; changes via PRs.

## Production configuration

- [ ] `ASPNETCORE_ENVIRONMENT=Production` set in the deployment environment.
- [ ] Connection string from env or secret store; SSL for DB where required.
- [ ] `Auth:JwtSecret` (min 32 chars) from env or secret store.
- [ ] `Cors:AllowedOrigins` set to dashboard URL + `chrome-extension://EXTENSION_ID` (and Edge if needed).
- [ ] `Worker:Url` set if you use the worker.
- [ ] Swagger disabled in production (or behind auth).

## Build & deploy

- [ ] Build with `dotnet publish -c Release`.
- [ ] For IIS: Hosting Bundle installed; app pool “No Managed Code”; correct path and permissions.
- [ ] For Azure: App settings (env vars) configured; deploy from publish or CI.
- [ ] For Docker: Image built from Dockerfile; env vars passed at run; restart policy set.

## Public access & security

- [ ] API behind HTTPS (reverse proxy or Azure).
- [ ] Domain/DNS points to the correct host.
- [ ] CORS allowlist only (no `*`); extension origin and dashboard origin included.
- [ ] Exception details not returned to clients; only generic message in production.

## Extension & dashboard

- [ ] `host_permissions` in manifest include production API URL.
- [ ] Extension uses correct API base URL and sends `Authorization: Bearer <token>`.
- [ ] Dashboard (if used) uses same API URL and token storage; CORS includes dashboard origin.

## Testing

- [ ] `/echo/health` returns 200.
- [ ] Login returns JWT; GET `/echo/sessions` with that JWT returns 200.
- [ ] From extension: login, load sessions, no CORS errors.
- [ ] End-to-end: record → finish → worker processes → session shows transcript/summary (if applicable).

## Post-go-live

- [ ] Logs and metrics monitored; DB backups and retention in place.
- [ ] Secrets rotated on schedule; dependency updates and security patches planned.

---

*End of guide. Adjust URLs, extension IDs, and paths to match your project and environment.*

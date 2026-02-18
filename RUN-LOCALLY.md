# Run Echo locally

Use this to run and test everything on your machine.

---

## One database and same tables for local and production

Use the **same** PostgreSQL database and the **same tables** for both local and production. The API and worker both connect to it and use the existing tables (`echo_sessions`, `echo_users`) — no extra or duplicate schema.

| Where you run | API connection | Worker connection |
|---------------|----------------|--------------------|
| **Local** | `api/appsettings.Development.json` → `ConnectionStrings:EchoDb` | `worker/.env` → `ECHO_DATABASE_URL` |
| **Production** | Environment: `ConnectionStrings__EchoDb` (or appsettings.Production) | Environment: `ECHO_DATABASE_URL` |

Use the **same** host, database name, user, and password in both so they share one DB and the same tables (API creates/reads sessions and users; worker updates `echo_sessions` with transcript and summary).

---

## 1. One-time setup

### API
- **Database:** One PostgreSQL instance with database `Echo` (same DB for local and production if you prefer).
- **Config:** Copy `api/appsettings.Development.example.json` to `api/appsettings.Development.json` and set:
  - `ConnectionStrings:EchoDb` – your Postgres connection string (e.g. `Host=YOUR_HOST;Port=5432;Database=Echo;Username=postgres;Password=YOUR_PASSWORD;...`).
  - `Auth:JwtSecret` – any string **at least 32 characters** (e.g. `Echo-Dev-Secret-Key-Min32Chars-ChangeInProduction`).

### Worker (same database as API)
- **Python:** 3.11 or 3.12, with `.venv` at project root (see worker/README.md).
- **DB URL:** The worker uses the **same** DB as the API. If `api/appsettings.Development.json` exists with `ConnectionStrings:EchoDb`, the worker reads it automatically — no `worker/.env` needed for local. Otherwise set **`ECHO_DATABASE_URL`** in **`worker/.env`** (see **`worker/env-setup.md`**).

### Extension
- Load the `extension` folder in Chrome: `chrome://extensions` → “Load unpacked” → select the `extension` folder.

### Dashboard (optional)
- From `dashboard/`: run `npm install` once, then `npm run dev` when you want to use it.

---

## 2. Run (every time)

Open **3 terminals** (or run API and Worker in background).

| Step | Command | Where |
|------|--------|--------|
| **1. API** | `.\run-api.ps1` | Project root (Echo1.0) |
| **2. Worker** | `.\run-worker.ps1` | Project root |
| **3. Dashboard** (optional) | `npm run dev` | From `dashboard/` |

- **API** → http://localhost:5012 (Swagger: http://localhost:5012/swagger)
- **Worker** → http://localhost:5050 (API calls this to process sessions)
- **Dashboard** → http://localhost:3000 (log in with API URL `http://localhost:5012` and your Echo account)

---

## 3. Test flow

1. Open the **Echo extension** → set API URL to `http://localhost:5012` → **Register** or **Log in**.
2. Go to a meeting tab (e.g. Zoom/Meet or a YouTube video) → click **Start Recording**.
3. Wait a bit or click **Stop Recording**.
4. **Worker** will process the session (transcript + summary). When status is “done”, open **Recordings** in the extension or the **Dashboard** (http://localhost:3000) to see the session and Boss Summary.

---

## 4. If something fails

- **API won’t start:** Check that `api/appsettings.Development.json` exists and has a valid `ConnectionStrings:EchoDb` and `Auth:JwtSecret` (min 32 chars).
- **Worker:** If you see “ECHO_DATABASE_URL not set” and you use a **remote** DB, create `worker/.env` and set `ECHO_DATABASE_URL` to the same DB as your API (see `worker/env-setup.md`). Same fix if you see "password authentication failed for user postgres".
- **Extension:** Ensure API URL is `http://localhost:5012` and the API is running.
- **Dashboard:** Use the same API URL and credentials as in the extension.

You can run and check everything locally with this setup.

# Same database and same tables for API and Worker (local and production)

The **API** and **worker** use the **same** PostgreSQL database and the **same tables** (`echo_sessions`, `echo_users`) that already exist. No separate or duplicate schema. You can use this one database for both **local** and **production**; only where you set the connection string changes.

| Environment | API | Worker |
|-------------|-----|--------|
| **Local** | `api/appsettings.Development.json` → `ConnectionStrings:EchoDb` | `worker/.env` → `ECHO_DATABASE_URL` |
| **Production** | Env: `ConnectionStrings__EchoDb` | Env: `ECHO_DATABASE_URL` |

Use the same host, database, user, and password in both so they share one DB.

---

## Fix: "password authentication failed for user postgres"

That error means the worker is using the default `postgres:postgres@localhost` but your real DB is elsewhere. Point the worker at the **same** DB as the API.

1. Create **`worker/.env`** (copy from `worker/.env.example` if you like).
2. Set **`ECHO_DATABASE_URL`** to the **same** database your **API** uses.

**Convert API connection string → URL**

- API format (from appsettings):  
  `Host=MY_HOST;Port=5432;Database=Echo;Username=postgres;Password=MY_PASSWORD;...`
- Worker format (for .env):  
  `ECHO_DATABASE_URL=postgresql://postgres:MY_PASSWORD@MY_HOST:5432/Echo`

Example (replace with your real host and password):

```env
ECHO_DATABASE_URL=postgresql://postgres:YOUR_ACTUAL_PASSWORD@YOUR_HOST:5432/Echo
```

If your password contains `@`, `#`, or `%`, URL-encode it (e.g. `@` → `%40`).

3. Restart the worker: stop it (Ctrl+C) and run `.\run-worker.ps1` again.

After this, both API and worker use the same DB (local and production can use the same database).

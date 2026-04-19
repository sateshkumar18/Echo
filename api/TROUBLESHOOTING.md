# Echo API – Troubleshooting

## 0. "Page cannot be displayed" / "Please contact your service provider"

**Cause:** The browser cannot load the page. Usually the API is not running, the URL/port is wrong, or (if deployed) the server or reverse proxy is misconfigured.

**Fix (step by step):**

1. **Confirm the API is running**
   - From project root: `.\run-api.ps1` (or from `api` folder: `dotnet run`).
   - You should see output like: `Now listening on: http://localhost:5012` (or 5011). Leave this window open.

2. **Use the correct URL**
   - **Local:** `http://localhost:5012` (not https, and use the port shown in the API window).
   - **Swagger:** `http://localhost:5012/swagger` (dev) or `http://localhost:5012/product/swagger` if you set that base path in dev.

3. **Test with PowerShell (no browser):**
   ```powershell
   Invoke-RestMethod -Uri "http://localhost:5012/echo/health" -Method GET
   ```
   If this returns something like `{ ok: true, database: "connected" }`, the API is fine; the issue is the URL you use in the browser or a firewall/antivirus blocking the browser.

4. **If deployed (IIS / Azure / VPS):**
   - Ensure the app process is running (IIS: app pool started; Azure: app is running; VPS: process or container is up).
   - Ensure firewall allows the port (e.g. 80, 443, or your API port).
   - Try the health URL: `https://your-domain.com/echo/health`. If that fails, the request is not reaching the API.

5. **Port in use:** If the API fails to start with "address already in use", see **Section 2** below.

---

## 1. "password authentication failed for user postgres"

**Cause:** The password in `appsettings.Development.json` does not match the Postgres user `postgres`.

**Fix:**

1. **Get or set the correct password**
   - In **pgAdmin**: Servers → your server → Login/Group Roles → **postgres** → right‑click → **Properties** → **Definition** tab → set **Password** → Save.
   - Or in **psql**: `ALTER USER postgres PASSWORD 'YourNewPassword';`

2. **Put that same password in the API**
   - Open `api/appsettings.Development.json`.
   - Set:
     ```json
     "EchoDb": "Host=localhost;Port=5432;Database=echo;Username=postgres;Password=YOUR_ACTUAL_PASSWORD"
     ```
   - Use the **exact** password you use in pgAdmin/psql (no extra spaces).

3. Restart the API.

---

## 2. "address already in use" / "Failed to bind to ... 5012"

**Cause:** Something is already using the API port (often a previous run that didn’t close).

**Fix:**

**Option A – Run the stop script (from the `api` folder):**
```powershell
.\stop-api.ps1
```
Then start the API again with `.\run-api.ps1`.

**Option B – Stop the process manually (PowerShell as Administrator):**
```powershell
$conn = Get-NetTCPConnection -LocalPort 5012 -ErrorAction SilentlyContinue
if ($conn) { Stop-Process -Id $conn.OwningProcess -Force }
```

**Option C – Find and kill by PID:**
```powershell
netstat -ano | findstr 5012
```
Note the last number (PID). Then: `taskkill /PID <that_number> /F`

---

## 3. "No data in pgAdmin" after recording

**Cause:** The extension saves recordings to IndexedDB (so you see them in the popup), but rows in PostgreSQL are only created when the API is called successfully.

**Check:**

1. **Table name** – In pgAdmin, use the **echo** database and the table **echo_sessions** (not "EchoSessions" or another name).

2. **API running** – The Echo API must be running (`.\run-api.ps1` from the `api` folder) on `http://localhost:5012` when you click **Start** and **Stop**. If the API is down, the extension still records locally but no rows are created.

3. **At least one chunk** – A row is created when:
   - **start-session** succeeds (when you click Start), or
   - **upload-chunk** runs (when a chunk is saved, e.g. when you click Stop).
   If you record for only 1–2 seconds, there may be no chunk to upload; try recording for 5–10 seconds then Stop.

4. **Extension host permission** – The extension needs to call `http://localhost:5012`. Reload the extension (chrome://extensions → Echo → Reload) after pulling changes so host permissions apply.

---

## 4. Sessions stuck in "Recording" status

**Cause:** A session is set to **Recording** when you click **Start** and to **Finished** when you click **Stop** (or when the recording tab is closed). If you close the tab, close the browser, or reload the extension without clicking **Stop**, the API never receives **finish-session**, so the row stays **Recording**.

**What we do:** The extension now calls **finish-session** when the tab that was being recorded is closed, so the DB will be updated to **Finished** in that case. Reload the extension to get this behavior.

**Existing rows:** For sessions that are already stuck as **Recording**, you can either:
- In pgAdmin: run `UPDATE echo_sessions SET status = 'Finished', finished_at = NOW() WHERE status = 'Recording';`
- Or leave them; they are just metadata and do not affect new recordings.

---

## 5. Quick checklist

- [ ] Postgres is running.
- [ ] Database **echo** exists.
- [ ] Table **echo_sessions** exists (run `api/Scripts/create_echo_sessions.sql` if not).
- [ ] Password in `appsettings.Development.json` matches the **postgres** user.
- [ ] No other app (or previous API run) is using port 5012; if it is, run `.\kill-port-5011.ps1` or stop that process.

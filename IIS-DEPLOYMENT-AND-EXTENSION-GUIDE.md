# Deploy Echo to Your IIS Server and How Users Use the Extension

Step-by-step: deploy the **Echo API** (and optionally the **Worker**) on your **IIS server**, then how **users get and use the Chrome extension** so it talks to your server correctly.

---

## Part 1: How It All Works (Big Picture)

```
┌─────────────────────────────────────────────────────────────────────────┐
│  YOUR IIS SERVER                                                        │
│  ┌─────────────────────┐    ┌─────────────────────┐                    │
│  │  Echo API (IIS)      │    │  Worker (optional)  │                    │
│  │  https://api.        │    │  e.g. port 5050     │                    │
│  │  yourdomain.com      │───►│  or Windows Service │                    │
│  └──────────┬──────────┘    └──────────┬──────────┘                    │
│             │                          │                                │
│             │         PostgreSQL (on server or remote)                  │
└─────────────┼──────────────────────────┼───────────────────────────────┘
              │                          │
              │  HTTPS + JWT             │
              │                          │
┌─────────────▼──────────────────────────▼───────────────────────────────┐
│  USER'S PC                                                               │
│  ┌─────────────────────┐                                                │
│  │  Chrome browser     │                                                │
│  │  + Echo extension  │  User sets "API URL" = https://api.yourdomain.com
│  │  (installed once)   │  User registers/logs in → records → sees list   │
│  └─────────────────────┘                                                │
└──────────────────────────────────────────────────────────────────────────┘
```

- **You:** Deploy the API (and optionally Worker) on IIS. The API has a public URL (e.g. `https://api.yourdomain.com`).
- **Users:** Install the **Chrome extension** (one time). Then they **Log in** or **Register** (same as local). Start/Stop recording and Recordings all go to your server.
- **API URL:** You can ship the extension so users **never** type an API URL: set the built-in URL in the extension (see **Part 7a**). Then the popup shows only Email / Password and Log in / Register, like on local. Optionally you can leave the API URL field visible so one extension works with many backends.
- **Extension:** Does **not run** on IIS. Users must **get** the extension from somewhere (zip or Chrome Web Store), then install it in Chrome. You can still **host the zip on your IIS server** so users download it from you (see **Part 7.1**).

---

## Part 2: What You Need on the Server

| Item | Purpose |
|------|--------|
| **Windows Server** with **IIS** | Host the Echo API. |
| **.NET 8 Hosting Bundle** | Lets IIS run ASP.NET Core. |
| **PostgreSQL** | Can be on the same server, or a remote DB the server can reach. |
| **HTTPS** (recommended) | Certificate and binding so users hit `https://api.yourdomain.com`. |
| **Domain (optional)** | e.g. `api.yourdomain.com` pointing to the server’s IP. |

---

## Part 3: Prepare the Server (One-Time)

### Step 3.1 – Install IIS

1. Server Manager → **Add roles and features**.
2. Role: **Web Server (IIS)**; include **Application Development** → **ASP.NET 4.8** (or as needed); **Management Tools**.
3. Complete the wizard.

### Step 3.2 – Install .NET 8 Hosting Bundle

1. Download: **.NET 8.0 Hosting Bundle** from https://dotnet.microsoft.com/download/dotnet/8.0 (under “Hosting Bundle”).
2. Run the installer on the server.
3. Restart IIS (optional but good): open CMD as Administrator → `iisreset`.

### Step 3.3 – PostgreSQL

- **Option A:** Install PostgreSQL on the same server; create database `echo`; run your scripts from `api/Scripts/` (e.g. `create_echo_sessions.sql`, `add_users_and_auth.sql`).
- **Option B:** Use an existing PostgreSQL (e.g. on another machine). Ensure the **IIS server can reach it** (firewall, connection string host/port).

You will need the **connection string** for the next part (e.g. `Host=localhost;Port=5432;Database=echo;Username=postgres;Password=...` or your remote host).

---

## Part 4: Deploy the Echo API on IIS

### Step 4.1 – Publish the API (On Your Dev PC)

On the machine where you have the Echo source (e.g. from GitHub):

```powershell
cd C:\Users\SateshKumarReddy\Desktop\Echo1.0\api
dotnet publish -c Release -o .\publish
```

Copy the **entire `publish` folder** to the server (e.g. `C:\inetpub\echo-api` or `D:\Echo\api`). You can use RDP, shared folder, or copy via network.

### Step 4.2 – Create the Website in IIS (On the Server)

1. Open **IIS Manager**.
2. **Sites** → right‑click → **Add Website**.
3. **Site name:** e.g. `EchoApi`.
4. **Physical path:** folder where you copied the publish output (e.g. `C:\inetpub\echo-api`).
5. **Binding:**
   - Type: **http** or **https** (if you already have a certificate).
   - Port: **80** (http) or **443** (https).
   - Host name: leave empty, or set e.g. `api.yourdomain.com` if DNS points to this server.
6. **Application pool:** Create new (e.g. `EchoApiPool`). After creation, set:
   - **.NET CLR version:** **No Managed Code**.
   - **Start application pool:** true.
7. Click **OK** and **Start** the site.

### Step 4.3 – Set Configuration (Secrets and URLs)

**Do not put real secrets in web.config in the folder.** Use one of these:

**Option A – Application Pool environment variables (recommended)**

1. IIS Manager → **Application Pools** → select **EchoApiPool** → **Advanced Settings**.
2. **Process Model** → **Identity:** use a dedicated user (e.g. `IIS AppPool\EchoApiPool` or a domain account).
3. Set **Environment Variables** (if your IIS version supports it) or use **Option B**.

**Option B – Machine / system environment variables**

1. Server: **System** → **Advanced system settings** → **Environment Variables**.
2. Under **System variables**, add (adjust names to match your app; use `__` for `:` in .NET):

   - `ASPNETCORE_ENVIRONMENT` = `Production`
   - `ConnectionStrings__EchoDb` = `Host=...;Port=5432;Database=echo;Username=...;Password=...;`
   - `Auth__JwtSecret` = (min 32 characters, random string)
   - `Auth__JwtIssuer` = `Echo`
   - `Auth__JwtAudience` = `Echo`
   - `Worker__Url` = `http://localhost:5050` (if Worker runs on same server) or your Worker URL

3. Restart the application pool (or IIS) so the API reads the new variables.

**Option C – web.config (only if you cannot use env vars)**

Edit `web.config` in the site folder, inside `<aspNetCore ...>`:

```xml
<environmentVariables>
  <environmentVariable name="ASPNETCORE_ENVIRONMENT" value="Production" />
  <environmentVariable name="ConnectionStrings__EchoDb" value="YOUR_CONNECTION_STRING" />
  <environmentVariable name="Auth__JwtSecret" value="YOUR_JWT_SECRET_MIN_32_CHARS" />
  <environmentVariable name="Worker__Url" value="http://localhost:5050" />
</environmentVariables>
```

Restrict file permissions on the folder so only the app pool identity can read it.

### Step 4.4 – CORS for the Chrome Extension

The API must allow requests from the extension’s origin. Extension origin looks like: `chrome-extension://abcdefghijklmnop`.

Add to environment variables (or in a config that supports arrays):

- `Cors__AllowedOrigins__0` = `chrome-extension://YOUR_EXTENSION_ID`

**How to get Extension ID:** After you package or load the extension (see Part 6), open `chrome://extensions`, enable **Developer mode**, and copy the **ID** under your extension. Use that exact value in CORS.

If you also have a web dashboard:

- `Cors__AllowedOrigins__1` = `https://your-dashboard-domain.com`

(Add more `__2`, `__3` if needed.)

### Step 4.5 – Permissions and Test

1. Ensure the **application pool identity** has **Read** permission on the site folder (and **Read/Write** on `Data\Chunks` if you use disk storage).
2. In a browser on the server (or from your PC if the site is reachable):  
   `http://your-server-ip/echo/health` or `https://api.yourdomain.com/echo/health`  
   You should see something like: `{"ok":true,"database":"connected"}`.

If you get 502/503, check: Application pool is running, .NET 8 Hosting Bundle is installed, `stdout` logs in the site folder (if enabled in web.config).

---

## Part 5: Worker (Optional, on Same Server)

The Worker does transcription and summarization. You can run it on the same IIS server (or another machine).

**Option A – Run as a console app (e.g. for testing)**

1. On the server, install **Python 3.11+** and create a venv; install dependencies from `worker/requirements.txt`.
2. Set **ECHO_DATABASE_URL** (same PostgreSQL as the API) and optionally **ECHO_CHUNK_BASE_PATH** (path where the API stores chunks; if API uses disk, point to that folder).
3. Run: `python app.py` (or your start script). Worker listens on port 5050 by default.
4. In the API config, set **Worker__Url** = `http://localhost:5050`.

**Option B – Run as a Windows Service**

Use **NSSM** or **sc.exe** to run `python app.py` (or a wrapper) as a service so it starts with the server and restarts on failure.

Once the Worker is running and **Worker__Url** is set, when a user clicks **Stop** in the extension, the API will call the Worker; after processing, sessions will show transcript and summary in the extension and dashboard.

---

## Part 6: HTTPS and Domain (Recommended for Production)

1. **Domain:** In your DNS, create an **A** (or **CNAME**) record, e.g. `api.yourdomain.com` → your server’s public IP.
2. **Certificate:** Get an SSL certificate (e.g. from your CA or Let’s Encrypt). Bind it in IIS: **Sites** → **EchoApi** → **Bindings** → **Add** → **https**, port **443**, select the certificate, host name `api.yourdomain.com`.
3. **Redirect (optional):** Add a binding for **http** port 80 and use **URL Rewrite** to redirect to **https**.

Then your **production API URL** is: **`https://api.yourdomain.com`**.

---

## Part 7: How Users “Get” the Extension and Use It

Users do **not** download the API from your server. They install the **Chrome extension**; the extension then talks to your API (using a built-in URL you set, or one the user enters).

### Part 7a – “Just login” like local (no API URL field)

If you want users to **only** see Log in / Register (no API URL box), set your server URL once in the extension and redistribute:

1. Open **`extension/config.js`** in the repo.
2. Set **`BUILTIN_API_URL`** to your production API URL, for example:
   ```js
   export const BUILTIN_API_URL = 'https://api.yourdomain.com';
   ```
3. Save, then zip the **`extension`** folder and give that build to users (or publish to the Chrome Web Store).

With that build, the API URL row is **hidden** and the extension always uses your server. Users open the popup → enter email/password → Log in or Register. Same flow as local.

- **Leave `BUILTIN_API_URL` empty** (`''`) if you want the API URL field visible (e.g. one extension for local and production, or multiple backends).

### Step 7.1 – How Users Download the Extension

The extension does **not run** on IIS; it runs in the user’s Chrome. Users need to **get** the extension from somewhere. You can **host the zip on your IIS server** so they download it from your domain (same server as the API).

**Option A – Host the zip on your IIS server**

1. Zip the **`extension`** folder (e.g. `echo-extension.zip`).
2. On the server, create a folder IIS can serve (e.g. `C:\inetpub\echo-api\downloads`) and copy the zip there.
3. Give users: **`https://api.yourdomain.com/downloads/echo-extension.zip`** (or a page with a “Download Echo extension” link).
4. User downloads zip → unzips → Chrome → `chrome://extensions` → Developer mode ON → **Load unpacked** → select the **extension** folder.


**Option B – Internal / corporate (Load unpacked, zip from shared drive or email)**

1. You **zip** the `extension` folder from your repo (no need to include `.git` or build artifacts).
2. You put the zip on a shared drive, intranet, or link from your server (e.g. “Download Echo extension”).
3. User **downloads and unzips** the folder.
4. User opens Chrome → `chrome://extensions` → **Developer mode** ON → **Load unpacked** → selects the unzipped **extension** folder.
5. The extension is installed. Its **ID** will be generated by Chrome (and can change if they remove and load again). Use that ID in **Cors__AllowedOrigins__0** on the server; for many internal users you may allow a pattern or document “use this ID in CORS.”

**Option C – Chrome Web Store (public or unlisted)**

1. You **package** the extension (zip the `extension` folder) and upload to the Chrome Web Store (developer account).
2. After review, the extension gets a **fixed ID**. You set **Cors__AllowedOrigins__0** = `chrome-extension://THAT_FIXED_ID` on your API.
3. Users install from the store (“Add to Chrome”). No need to load unpacked.

### Step 7.2 – What the User Does After Installing

**If you set BUILTIN_API_URL (Part 7a):**

1. User clicks the **Echo** icon in Chrome (opens the popup).
2. Popup shows **Log in** / **Register** and email/password only (no API URL field).
3. User enters email/password and clicks **Log in** or **Register**. The extension calls your server; API returns JWT; extension stores it.
4. **Start Recording**, **Stop**, and **Recordings** all use your server. Same experience as local.

**If you leave BUILTIN_API_URL empty:**

1. User clicks the **Echo** icon; popup shows **API URL** and Log in / Register.
2. User enters your server URL (e.g. `https://api.yourdomain.com`) and then email/password; Log in or Register.
3. From then on, all recording and Recordings go to that API URL.

So: **“Download by user through extension”** = user **installs the extension** (from your zip or the store). With a built-in URL they just **log in**; without it they enter the API URL once then log in.

### Step 7.3 – host_permissions (If You Restrict Later)

Your `manifest.json` currently has `"*://*/*"` in `host_permissions`, so the extension can call **any** API URL the user types. For a locked-down build (e.g. only your domain), you can change to:

```json
"host_permissions": [
  "https://api.yourdomain.com/*",
  "http://localhost:5012/*"
]
```

Then repackage and redistribute. Most deployments keep `*://*/*` so users can point to different environments (e.g. staging).

---

## Part 8: End-to-End Checklist

**Server**

- [ ] IIS and .NET 8 Hosting Bundle installed.
- [ ] PostgreSQL available; DB `echo` created; scripts run.
- [ ] API published and copied to server; IIS site and app pool created; app pool = No Managed Code.
- [ ] Environment variables (or web.config) set: `ASPNETCORE_ENVIRONMENT`, `ConnectionStrings__EchoDb`, `Auth__JwtSecret`, `Worker__Url`, and CORS (`Cors__AllowedOrigins__0` = extension origin).
- [ ] HTTPS binding and domain (e.g. `https://api.yourdomain.com`) if production.
- [ ] `/echo/health` returns 200 with database connected.

**Worker (if used)**

- [ ] Worker running (console or Windows Service); **Worker__Url** set in API config.
- [ ] ECHO_DATABASE_URL and chunk path correct; API and Worker use same DB.

**Extension for users**

- [ ] Extension zip or store listing prepared; users can install (Load unpacked or from store).
- [ ] Users know the **API URL** to enter (e.g. `https://api.yourdomain.com`).
- [ ] CORS on the API includes the extension’s origin (`chrome-extension://...`).

**User flow**

- [ ] User installs extension → opens popup → enters API URL → Register or Login → Start/Stop recording → Recordings list and detail work.

---

## Part 9: Quick Reference – User Flow

| Step | User action | What happens |
|------|-------------|--------------|
| 1 | Downloads extension zip from your server/link | Gets the extension folder. |
| 2 | Load unpacked (or install from store) | Extension appears in Chrome. |
| 3 | Clicks Echo icon, enters API URL (e.g. `https://api.yourdomain.com`) | Extension saves URL; all API calls use it. |
| 4 | Register or Login | Extension calls your API; receives JWT; stores it. |
| 5 | Clicks Start Recording on a tab | Extension calls POST /echo/start-session; records audio; uploads chunks to POST /echo/upload-chunk. |
| 6 | Clicks Stop | Extension calls POST /echo/finish-session; API triggers Worker; Worker processes and updates DB. |
| 7 | Opens Recordings tab | Extension calls GET /echo/sessions and GET /echo/session/{id}; shows list and transcript/summary from your server. |

This is how deployment on your IIS server and correct use of the app by users (through the extension) work end to end.

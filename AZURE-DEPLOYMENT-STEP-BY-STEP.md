# Deploy Echo API to Azure – Step-by-Step (No Azure Experience)

This guide gets your Echo API from GitHub onto Azure so you have a **production URL** (e.g. `https://echo-api-xxxx.azurewebsites.net`). You can follow it even if you have never used Azure.

---

## What You’ll Have When Done

- Echo API running on Azure with **HTTPS**
- A **production URL** like `https://your-app-name.azurewebsites.net`
- Swagger at `https://your-app-name.azurewebsites.net/product/swagger` (if you enable it)
- Option to use **Azure PostgreSQL** or your **existing PostgreSQL** for the database

---

## Part 1: What You Need Before Starting

1. **Microsoft account** (Outlook.com / Microsoft 365) – used to sign in to Azure.
2. **GitHub repo** – your Echo code is already at `https://github.com/sateshkumar18/Echo`.
3. **Credit card** – Azure free tier may require it for identity check; you can set spending limits so you’re not charged.
4. **Database** – Either:
   - **Option A:** Create **Azure Database for PostgreSQL** (we’ll do it below), or  
   - **Option B:** Use your **existing PostgreSQL** (e.g. on your PC or another server). You’ll need its **host, port, database name, user, password**.

---

## Part 2: Create an Azure Account (If You Don’t Have One)

1. Go to: **https://azure.microsoft.com/free**
2. Click **Start free**.
3. Sign in with your Microsoft account (or create one).
4. Complete the form (phone, card for verification – free tier has limits so you often pay nothing).
5. When done, you’re in the **Azure portal**: https://portal.azure.com

---

## Part 3: Create a Resource Group (Folder for Your Resources)

1. In the Azure portal, open the **search bar** at the top and type **Resource groups**.
2. Click **Resource groups** → **+ Create**.
3. **Subscription:** Keep default (e.g. Free Trial).
4. **Resource group:** e.g. `echo-rg`.
5. **Region:** Choose one near you (e.g. East US, West Europe).
6. Click **Review + create** → **Create**.

---

## Part 4: Create the Database (Azure PostgreSQL)

You need a PostgreSQL database for the API. If you prefer to use your **existing** Postgres, skip to Part 5 and use that connection string later.

1. In the search bar, type **Azure Database for PostgreSQL**.
2. Click **Azure Database for PostgreSQL** → **+ Create**.
3. Choose **Flexible server** → **Create**.
4. Fill in:

   | Field | Example |
   |-------|--------|
   | Subscription | Your subscription |
   | Resource group | `echo-rg` (same as above) |
   | Server name | `echo-db` (must be unique; Azure will add `.postgres.database.azure.com`) |
   | Region | Same as resource group |
   | PostgreSQL version | 16 |
   | Workload type | Development (for learning; use Production for real use) |
   | Compute + storage | Leave default (Burstable B1ms is fine to start) |

5. **Administrator account:**
   - **Admin username:** e.g. `echoadmin` (remember it).
   - **Password:** Choose a strong password and **save it** (e.g. in a password manager).

6. Click **Review + create** → **Create**. Wait a few minutes until deployment finishes.

7. **Allow Azure services:**  
   After the server is created, go to the server → **Networking** (under Settings).  
   - **Firewall rules** → **+ Add current client IP** (so you can connect from your PC).  
   - Enable **Allow public access from any Azure service within Azure to this server** (so the Web App can connect).  
   Save.

8. **Create the database:**  
   Go to the server → **Databases** → **+ Add** → Name: `echo` → OK.

9. **Connection string (save this):**  
   Server → **Connection strings** (or **Settings** → **Connection strings**). You’ll see something like:
   ```
   Host=echo-db.postgres.database.azure.com;Port=5432;Database=echo;Username=echoadmin;Password=YOUR_PASSWORD;SSL Mode=Require;
   ```
   Replace `YOUR_PASSWORD` with the admin password you set. **Keep this secret;** you’ll paste it into Azure App Service in Part 6.

---

## Part 5: Create the Web App (Where Your API Will Run)

1. In the search bar, type **App Services**.
2. Click **App Services** → **+ Create** → **Web App**.
3. Fill in:

   | Field | Example |
   |-------|--------|
   | Subscription | Your subscription |
   | Resource group | `echo-rg` |
   | Name | `echo-api-yourname` (must be globally unique; becomes `echo-api-yourname.azurewebsites.net`) |
   | Publish | Code |
   | Runtime stack | **.NET 8 (LTS)** |
   | Operating System | Windows |
   | Region | Same as resource group |

4. **App Service Plan:**  
   Click **Create new** → Name: `echo-plan`, Region: same, **Pricing:** Free F1 (or B1 if you want always-on).  
   Click **OK**.

5. Click **Review + create** → **Create**. Wait until deployment finishes.

6. **Your production URL:**  
   After creation, open the Web App → **Overview**. The **URL** (e.g. `https://echo-api-yourname.azurewebsites.net`) is your **production API base URL**. Save it.

---

## Part 6: Connect GitHub and Deploy the Code

1. In your Web App, go to **Deployment Center** (left menu).
2. **Source:** **GitHub** → Authorize if asked (sign in to GitHub, allow Azure).
3. **Organization:** Your GitHub user (e.g. `sateshkumar18`).
4. **Repository:** **Echo**.
5. **Branch:** **main**.
6. **Build Provider:** **GitHub Actions** (recommended).  
   Azure will create a workflow file in your repo (e.g. `.github/workflows/main_echo-api-yourname.yml`).
7. Click **Save**. Azure will run the first deployment; this can take 5–10 minutes.
8. Under **Deployment Center** → **Logs**, you can watch the run. When status is **Success**, the API is deployed.

**If the workflow fails:** Azure may generate a workflow that doesn’t point to the `api` folder. Fix it like this:

1. In your repo, create the file `.github/workflows/main_echo-api.yml` (name can match what Azure created).
2. Put this inside (replace `YOUR_WEB_APP_NAME` with your Azure Web App name, e.g. `echo-api-yourname`):

```yaml
name: Deploy Echo API to Azure
on:
  push:
    branches: [main]
    paths:
      - 'api/**'
  workflow_dispatch:
jobs:
  build-and-deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-dotnet@v4
        with:
          dotnet-version: '8.0.x'
      - name: Publish API
        run: dotnet publish api/Echo.Api.csproj -c Release -o publish
      - name: Deploy to Azure Web App
        uses: azure/webapps-deploy@v2
        with:
          app-name: 'YOUR_WEB_APP_NAME'
          publish-profile: ${{ secrets.AZURE_WEBAPP_PUBLISH_PROFILE }}
          package: ./publish
```

3. In Azure: Web App → **Get publish profile** (Overview or Deployment Center). Download the file.
4. In GitHub: repo → **Settings** → **Secrets and variables** → **Actions** → **New repository secret**. Name: `AZURE_WEBAPP_PUBLISH_PROFILE`. Value: paste the **entire contents** of the publish profile file. Save.
5. Push a small change to `main` (or run the workflow manually from the Actions tab) to trigger deployment again.

---

## Part 7: Set Application Settings (Secrets and Config)

The API needs the database connection string, JWT secret, and (optionally) CORS. You set these as **Application settings** in Azure (they become environment variables).

1. In your Web App, go to **Configuration** (under Settings).
2. Open the **Application settings** tab.
3. Click **+ New application setting** and add **one by one** (names and values below).

**Required:**

| Name | Value | Notes |
|------|--------|--------|
| `ASPNETCORE_ENVIRONMENT` | `Production` | Tells the API it’s in production |
| `ConnectionStrings__EchoDb` | (see below) | Your PostgreSQL connection string |

**Connection string value:**  
- If you created **Azure PostgreSQL** in Part 4, use the string you saved, e.g.:  
  `Host=echo-db.postgres.database.azure.com;Port=5432;Database=echo;Username=echoadmin;Password=YOUR_PASSWORD;SSL Mode=Require;`  
- If you use **your own Postgres**, use the same format with your host, database, user, and password.

| Name | Value |
|------|--------|
| `Auth__JwtSecret` | A long random string (at least 32 characters). Example: `Echo-Prod-Secret-ChangeThisToRandom32CharsOrMore` |
| `Auth__JwtIssuer` | `Echo` |
| `Auth__JwtAudience` | `Echo` |

**Optional (you can add later):**

| Name | Value |
|------|--------|
| `Worker__Url` | Your worker URL if you deploy it (e.g. `https://echo-worker.azurewebsites.net`). Leave empty if no worker yet. |
| `Cors__AllowedOrigins__0` | Your dashboard URL, e.g. `https://your-dashboard.azurestaticapps.net` (or leave empty). |
| `Cors__AllowedOrigins__1` | Your Chrome extension origin, e.g. `chrome-extension://YOUR_EXTENSION_ID` (get ID from chrome://extensions). |
| `Cors__SwaggerInProduction` | `true` if you want Swagger on in production (optional). |

4. Click **Save** at the top. Azure will restart the app so the new settings apply.

---

## Part 8: Create Database Tables (First-Time Setup)

Your API uses tables like `echo_sessions` and `echo_users`. You must create them once in the database.

**If you use Azure PostgreSQL:**

1. From your PC you can connect with **pgAdmin**, **Azure Data Studio**, or **psql** using the same connection string (host, port 5432, database `echo`, user, password).  
   Ensure the server’s **Networking** has your IP allowed (and “Allow Azure services” if the app is on Azure).
2. Run the SQL scripts from your repo in this order (path relative to repo root):
   - `api/Scripts/create_echo_sessions.sql`
   - `api/Scripts/add_users_and_auth.sql`  
   (and any other scripts in `api/Scripts/` that your project needs.)

**If you already have a database** with these tables (e.g. from local dev), you don’t need to run them again; just use that database’s connection string in Part 7.

---

## Part 9: Test Your Production URL

1. Open: `https://your-app-name.azurewebsites.net/echo/health`  
   (replace `your-app-name` with the Web App name from Part 5.)
2. You should see something like: `{"ok":true,"database":"connected"}`.  
   If you see **502** or **503**, wait a minute (cold start) and try again.  
   If you see **500**, check **Log stream** or **Log Analytics** in the Web App; often the connection string or JWT secret is wrong.
3. **Swagger (if you set `Cors__SwaggerInProduction` = true):**  
   Open: `https://your-app-name.azurewebsites.net/product/swagger`

**Your production API base URL is:**  
`https://your-app-name.azurewebsites.net`  
(no slash at the end.)

Use this URL in:
- **Chrome extension:** User sets “API URL” to this.
- **Dashboard:** Set the same URL where your dashboard config expects the API (e.g. env or UI).

---

## Part 10: Summary Checklist

- [ ] Azure account created.
- [ ] Resource group created (e.g. `echo-rg`).
- [ ] PostgreSQL created (Azure or existing) and connection string saved.
- [ ] Web App created (.NET 8), production URL noted.
- [ ] GitHub connected in Deployment Center; deployment succeeded.
- [ ] Application settings set: `ASPNETCORE_ENVIRONMENT`, `ConnectionStrings__EchoDb`, `Auth__JwtSecret`, `Auth__JwtIssuer`, `Auth__JwtAudience`.
- [ ] Database tables created (run scripts if new DB).
- [ ] `/echo/health` returns OK.
- [ ] Extension / Dashboard updated to use the production URL.

---

## Optional: Worker (Python) on Azure

The Echo **worker** (Python, Whisper, etc.) can run separately. Options:

- **Azure App Service** as a second Web App (Python runtime), or  
- **Azure Container Instances** / **Azure Container Apps** if you run it in Docker.

You would set the worker’s URL in the API as `Worker__Url` (e.g. `https://echo-worker.azurewebsites.net`). A separate step-by-step for the worker can be added later if you need it.

---

## Troubleshooting

| Problem | What to do |
|--------|------------|
| Deployment fails in GitHub Actions | Open repo → Actions → failed run; fix the step (often path or .NET version). |
| 502 / 503 on the URL | Wait 1–2 minutes (cold start); check App Service is running in Overview. |
| 500 on /echo/health | Check Configuration (connection string, no typos); check Log stream for errors. |
| “Password authentication failed” | Correct the password in `ConnectionStrings__EchoDb`; ensure DB user and database name exist. |
| CORS errors from extension | Add `Cors__AllowedOrigins__1` = `chrome-extension://YOUR_EXTENSION_ID` (get ID from chrome://extensions). |

---

*End of guide. Your production URL is: **https://[your-web-app-name].azurewebsites.net**.*

# Deployment step-by-step status

Follow this in order. When a step is done, you can check it off.

---

## Part 1: GitHub (initial push)

### ✅ Step 1: .gitignore updated
- Added ASP.NET Core (bin/, obj/, publish/, etc.), secrets (appsettings.Development.json, .env), api/Data/Chunks/, dashboard/.next/, IDE files.
- **Done.**

### ✅ Step 2: Git initialized
- `git init` was run in the project root.
- **Done.**

### ✅ Step 3: First commit
- All source code staged (no secrets, no Chunks, no bin/obj).
- Commit: **"Initial commit: Echo API, worker, extension, dashboard"** (77 files).
- Branch renamed to **main**.
- **Done.**

### ⏳ Step 4: Connect to GitHub and push

**You need to do this:**

1. **Create a new repository on GitHub**
   - Go to https://github.com/new
   - Repository name: e.g. `Echo` or `echo-app`
   - Do **not** check "Add a README" (you already have code)
   - Create repository

2. **Add the remote and push** (replace `YOUR_USERNAME` and `YOUR_REPO` with your GitHub username and repo name):

   ```powershell
   cd "c:\Users\SateshKumarReddy\Desktop\Echo1.0"
   git remote add origin https://github.com/YOUR_USERNAME/YOUR_REPO.git
   git push -u origin main
   ```

   If GitHub asks for credentials, use your GitHub username and a **Personal Access Token** (Settings → Developer settings → Personal access tokens) as the password.

3. **Verify:** Open `https://github.com/YOUR_USERNAME/YOUR_REPO` and confirm all files are there (no `api/appsettings.Development.json`, no `api/Data/Chunks/`).

---

## Part 2: Prepare for production (next)

After push is done, continue with **DEPLOYMENT-GUIDE.md** Part 2:

- Set production config (env vars, appsettings placeholders).
- Database connection string and JWT secret from env.
- Build with `dotnet publish -c Release`.
- Security checklist (HTTPS, CORS allowlist, no Swagger in prod).

---

## Part 3–7: Deploy and test

- **Part 3:** Choose deployment (IIS / Azure App Service / Docker on VPS) and follow the guide.
- **Part 4:** Domain, HTTPS, CORS for extension.
- **Part 5:** Extension `host_permissions` and API base URL.
- **Part 6:** Test locally → test deployed API → test from extension.
- **Part 7:** Folder structure; use the **Full Deployment Checklist** at the end of DEPLOYMENT-GUIDE.md.

---

*Update this file as you complete each part.*

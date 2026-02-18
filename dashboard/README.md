# Echo Dashboard (Next.js)

Web app to view your Echo recordings: sessions list, Boss Summary, full transcript (searchable), and export as .txt.

## Run

1. **Install and start:**

   ```bash
   cd dashboard
   npm install
   npm run dev
   ```

2. Open **http://localhost:3000**. Sign in with the same email/password you use in the Echo extension. Enter the **API URL** (e.g. `http://localhost:5012` if the Echo API runs locally).

3. After login you see your sessions. Click a session to open the **Meeting Notebook**: Boss Summary, transcript with search, and **Export as .txt**.

## Config

- **API URL**: Set on the login form (stored in `localStorage`). Or set `NEXT_PUBLIC_ECHO_API_URL` in `.env.local` as default.
- The dashboard uses the same Echo API as the extension (`/auth/login`, `GET /echo/sessions`, `GET /echo/session/{id}`). CORS must allow your dashboard origin (e.g. `http://localhost:3000`) in production.

## PRD

Phase 4: "The Review" – user sees Boss Summary, full transcript (searchable), and can export. Audio player and "Meeting is ready" notification can be added later.

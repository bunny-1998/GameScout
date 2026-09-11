# Deploying Game Scout online (team-only, behind a login)

This puts Game Scout on the internet so your team can open it from a URL, with a
username/password gate. Your AppstoreSpy API key stays on the server (set as an
environment variable) and is never exposed to the browser.

No command line needed. We'll use **GitHub** (to store the code) + **Render**
(to run it). Both have free tiers.

---

## Step 1 — Put the code on GitHub (via the website, no git install)

1. Make a free account at https://github.com and click **New repository**.
2. Name it (e.g. `game-scout`), choose **Private**, click **Create repository**.
3. On the new repo page, click **uploading an existing file**.
4. Extract the `game-scout.zip` you were given, open the `game-scout` folder,
   and drag **all its files and folders** into the upload box —
   **except `node_modules` and `.env`** (don't upload those two; the zip already
   omits them, so you're fine dragging what's in the folder).
5. Click **Commit changes**.

## Step 2 — Create the web service on Render

1. Make a free account at https://render.com (you can sign in with GitHub).
2. Click **New +** → **Web Service** → connect the `game-scout` repo.
3. Render auto-detects Node. Confirm:
   - **Build Command:** `npm install`
   - **Start Command:** `npm start`
4. Pick the **Free** instance type.

## Step 3 — Add your settings (Environment variables)

Still on Render, open the **Environment** section and add these keys:

| Key            | Value                                   |
|----------------|-----------------------------------------|
| `DATA_SOURCE`  | `appstorespy`                           |
| `API_KEY`      | your AppstoreSpy key                    |
| `APP_COUNTRY`  | `US` (or your market)                   |
| `AUTH_USER`    | a username for your team, e.g. `team`   |
| `AUTH_PASS`    | a strong shared password                |

(You do **not** need to set `PORT` — Render sets it automatically.)

For several separate logins instead of one shared one, skip `AUTH_USER`/`AUTH_PASS`
and add `AUTH_USERS` = `alice:pass1,bob:pass2` instead.

## Step 4 — Deploy and share

1. Click **Create Web Service**. Render installs and starts it (first build takes
   a few minutes).
2. When it's live you get a URL like `https://game-scout.onrender.com`.
3. Open it — the browser asks for the username/password you set. Enter them.
4. Share the URL + the login with your team. Done.

---

## Good to know

- **Free tier sleeps.** After ~15 minutes idle, the free service spins down, so
  the first visit after that takes ~30–60 seconds to wake. Fine for occasional
  team use. For always-on, upgrade to Render's paid instance (about $7/month).
- **Updating later.** When I give you new files, upload them to the same GitHub
  repo (Add file → Upload files → overwrite). Render redeploys automatically.
- **Your key is safe.** It lives only in Render's environment variables, on the
  server side. The browser never sees it, and it's never committed to GitHub
  (don't upload `.env`).
- **Alternative host:** Railway (https://railway.app) works the same way — connect
  the GitHub repo, add the same environment variables.

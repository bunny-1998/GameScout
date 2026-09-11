# Game Scout

Enter one of your games, get its closest **8–12 competitors** sorted by
downloads (biggest first) — each with icon, screenshots, monthly & daily
downloads, revenue, rating, category rank, ad networks and more. Data comes
from your **AppstoreSpy** account. A **mock** mode lets you try the UI with no key.

Your API key lives only in a local `.env` file and is used by a tiny local
server — the browser never sees the key and never calls AppstoreSpy directly.

---

## Run it

You need [Node.js 18+](https://nodejs.org).

```bash
npm install
copy .env.example .env      # macOS/Linux: cp .env.example .env
npm start
```

Open **http://localhost:3000**. It starts in **mock mode** so you see the full
dashboard immediately. Keep the `npm start` window open while you use it.

---

## Go live with your AppstoreSpy data

1. Get your API key at https://appstorespy.com/account
2. Open `.env` and set:
   ```
   DATA_SOURCE=appstorespy
   API_KEY=your_key_here
   APP_COUNTRY=US        # reference market for download/revenue estimates
   ```
3. Restart: stop with `Ctrl + C`, then `npm start` again.

Now type a game name, pick **iOS** or **Android**, set the 8–12 slider, and
**Scout**. Real icons and screenshots will appear.

Tips:
- For Google Play, use the store title (e.g. "Indian Rider Bikes 3D"). The tool
  resolves it to the package (com.…) automatically.
- Everything is sorted by monthly downloads by default; change it with the
  "Sort by" menu (downloads/day, total installs, revenue, rating, rank).

---

## What each competitor shows

Icon, title, developer, rating (+ count) and a category-rank badge, then:
total installs, downloads/month, downloads/day, revenue/month, category, plus
IAP / Ads / country tags. Click a card for the full drawer: all stats plus
package name, developer, seller, ad networks, release/updated dates, and the
full screenshot gallery (click a shot to zoom).

Note on data: AppstoreSpy's API provides downloads, revenue, ratings, rank,
category, ad networks and store metadata — all shown here. Metrics like DAU or
D1/D7 retention are AppstoreSpy dashboard estimates that aren't exposed through
the API, so they aren't included.

---

## How it fits together

```
browser (public/)  ->  local server (server.js)  ->  adapters/appstorespy.js  ->  api.appstorespy.com
   dashboard UI            holds the API key            builds the requests
```

- `public/` — the dashboard (plain HTML/CSS/JS, no build step)
- `server.js` — serves the dashboard, exposes `GET /api/scout`
- `adapters/appstorespy.js` — the AppstoreSpy integration (search, similar, normalize)
- `mock/data.js` — sample data, same shape as the real adapter

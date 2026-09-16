// Daily install snapshot.
//
// Google publishes a game's CUMULATIVE install count, never its velocity.
// But the difference between yesterday's count and today's IS the velocity -
// measured, not modelled. So once a day we record the count for the top games
// in the categories we care about, and the dashboard reads the gap.
//
// Runs in GitHub Actions, commits its own output. No API key, no database,
// no card - the repo is the datastore.

import gplay from "google-play-scraper";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";

const COUNTRY = process.env.APP_COUNTRY || "us";
const LANG = process.env.APP_LANGUAGE || "en";
const THROTTLE = Number(process.env.SCRAPE_THROTTLE || 5);
const PER_CATEGORY = Number(process.env.TRACK_PER_CATEGORY || 100);
const KEEP = 8;              // samples kept per game
const CONCURRENCY = 3;       // polite: a ban costs us a whole day

const CATEGORIES = (process.env.TRACK_CATEGORIES ||
  "GAME_PUZZLE,GAME_CASUAL,GAME_ARCADE").split(",").map((s) => s.trim()).filter(Boolean);

const HISTORY = "data/installs.json";
const SERVED = "public/installs.json";

const today = new Date().toISOString().slice(0, 10);

async function readJson(file, fallback) {
  try { return JSON.parse(await readFile(file, "utf8")); } catch { return fallback; }
}

async function mapLimit(items, limit, fn) {
  const queue = [...items];
  const workers = Array.from({ length: Math.min(limit, queue.length) }, async () => {
    while (queue.length) {
      const item = queue.shift();
      try { await fn(item); } catch { /* one bad app must not stop the run */ }
    }
  });
  await Promise.all(workers);
}

// ---- 1. which games to follow: the top free of each tracked category ----
async function watchlist() {
  const ids = new Set();
  for (const category of CATEGORIES) {
    try {
      const list = await gplay.list({
        category,
        collection: gplay.collection.TOP_FREE,
        num: PER_CATEGORY,
        country: COUNTRY,
        lang: LANG,
        throttle: THROTTLE,
      });
      for (const a of list) if (a.appId) ids.add(a.appId);
      console.log(`${category}: ${list.length} games`);
    } catch (err) {
      console.warn(`${category}: chart failed - ${err.message}`);
    }
  }
  return [...ids];
}

// ---- 2. today's cumulative install count for each ----
async function snapshot(ids) {
  const counts = {};
  let done = 0;
  await mapLimit(ids, CONCURRENCY, async (appId) => {
    const a = await gplay.app({ appId, country: COUNTRY, lang: LANG, throttle: THROTTLE });
    const n = a.maxInstalls != null ? Number(a.maxInstalls)
            : a.minInstalls != null ? Number(a.minInstalls) : null;
    if (Number.isFinite(n)) counts[appId] = n;
    if (++done % 50 === 0) console.log(`  ${done}/${ids.length}`);
  });
  return counts;
}

// ---- 3. fold into the history, oldest samples dropped ----
function fold(history, counts) {
  const out = { ...history };
  for (const [appId, n] of Object.entries(counts)) {
    const samples = (out[appId] || []).filter((s) => s.t !== today);
    samples.push({ t: today, n });
    out[appId] = samples.slice(-KEEP);
  }
  return out;
}

// ---- 4. the bit the dashboard actually reads ----
// Velocity across the whole window we hold, so one lumpy day doesn't skew it.
function velocities(history) {
  const out = {};
  for (const [appId, samples] of Object.entries(history)) {
    if (!Array.isArray(samples) || samples.length < 2) continue;
    const first = samples[0];
    const last = samples[samples.length - 1];
    const days = (Date.parse(last.t) - Date.parse(first.t)) / 86400000;
    if (!(days >= 1)) continue;
    const gained = last.n - first.n;
    if (!(gained >= 0)) continue;              // a store correction, not a download
    const perDay = Math.round(gained / days);
    out[appId] = {
      perDay,
      perMonth: perDay * 30,
      days: Math.round(days),
      asOf: last.t,
    };
  }
  return out;
}

const ids = await watchlist();
if (!ids.length) {
  console.error("No games to track - every category chart failed. Leaving yesterday's data alone.");
  process.exit(1);
}
console.log(`tracking ${ids.length} games`);

const counts = await snapshot(ids);
console.log(`read install counts for ${Object.keys(counts).length}/${ids.length}`);
if (Object.keys(counts).length < ids.length * 0.5) {
  console.error("Fewer than half the games returned - probably rate-limited. Not writing a partial day.");
  process.exit(1);
}

const history = fold(await readJson(HISTORY, {}), counts);
const served = velocities(history);

await mkdir(path.dirname(HISTORY), { recursive: true });
await writeFile(HISTORY, JSON.stringify(history) + "\n");
await writeFile(SERVED, JSON.stringify(served) + "\n");

const withNumbers = Object.keys(served).length;
console.log(`history: ${Object.keys(history).length} games | measurable today: ${withNumbers}`);
if (!withNumbers) console.log("First run - velocities appear after tomorrow's snapshot.");

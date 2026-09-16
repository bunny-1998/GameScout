// Free adapter - no API key, no credits, no account.
//
//   Android : google-play-scraper   (reads the public Play Store pages)
//   iOS     : app-store-scraper     (Apple's public iTunes search/lookup)
//
// Two entry points:
//   scout()        - finds the seed + as many real competitors as it can, fast.
//                    Cards come back with name/icon/developer/rating straight
//                    away; installs, screenshots and rank follow.
//   fetchDetails() - fills in the heavy per-app stats for a batch of ids.
//                    The dashboard calls this repeatedly after the first paint,
//                    which is how hundreds of games get fully populated without
//                    any single request exceeding the 10s function limit.
//
// Downloads/month, downloads/day and revenue stay empty: those are modelled
// numbers, not public data, so no free source has them.

import gplayPkg from "google-play-scraper";
import istorePkg from "app-store-scraper";

const gplay = gplayPkg.default || gplayPkg;
const istore = istorePkg.default || istorePkg;

const COUNTRY = (process.env.APP_COUNTRY || "US").toLowerCase();
const LANG = (process.env.APP_LANGUAGE || "en_US").split(/[_-]/)[0].toLowerCase();

// Play bans an IP for ~1 hour if you hammer it, so cap requests/second.
const THROTTLE = Number(process.env.SCRAPE_THROTTLE || 6);
// Serverless functions are killed at 10s; stop well before that.
const BUDGET_MS = Number(process.env.SCRAPE_BUDGET_MS || 6500);
// How many competitors scout() enriches itself before handing over.
const EAGER = Number(process.env.SCRAPE_EAGER || 12);

// ---------------------------------------------------------------- helpers

function daysSince(dateish) {
  if (!dateish) return null;
  const d = new Date(dateish);
  if (isNaN(d)) return null;
  return Math.max(0, Math.round((Date.now() - d.getTime()) / 86400000));
}

function isoDay(dateish) {
  if (!dateish) return "";
  const d = new Date(dateish);
  return isNaN(d) ? String(dateish).slice(0, 10) : d.toISOString().slice(0, 10);
}

function humanSize(bytes) {
  const n = Number(bytes);
  if (!Number.isFinite(n) || n <= 0) return "";
  const mb = n / (1024 * 1024);
  return mb >= 1024 ? (mb / 1024).toFixed(1) + " GB" : Math.round(mb) + " MB";
}

function titleCase(s) {
  return String(s || "")
    .replace(/_/g, " ")
    .toLowerCase()
    .replace(/\b\w/g, (m) => m.toUpperCase());
}

function keywordFrom(title) {
  const head = String(title || "")
    .split(/[:\-|]/)[0]
    .replace(/[^\p{L}\p{N} ]+/gu, " ")
    .trim();
  const words = head.split(/\s+/).filter(Boolean);
  return words.slice(0, 2).join(" ") || String(title || "").trim();
}

async function mapLimit(items, limit, deadline, fn) {
  let i = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (i < items.length && Date.now() < deadline) {
      const idx = i++;
      try { await fn(items[idx], idx); } catch { /* keep whatever we have */ }
    }
  });
  await Promise.all(workers);
}

// --------------------------------------------------------- relevance match

function tokens(s) {
  return new Set(
    String(s || "")
      .toLowerCase()
      .replace(/[^\p{L}\p{N} ]+/gu, " ")
      .split(/\s+/)
      .filter((w) => w.length > 2)
  );
}

const GENERIC_GENRES = new Set(["games", "entertainment", "app", "apps"]);

function genreSet(a) {
  const raw = [].concat(a.genres || [], a.genre || [], a.primaryGenre || []);
  return new Set(
    raw.map((g) => String(g).toLowerCase().replace(/^games?[_ ]/, "").trim())
       .filter((g) => g && !GENERIC_GENRES.has(g))
  );
}

// Apple's similar() is "customers also bought", so score candidates on shared
// title words and shared sub-genre rather than trusting the list.
function relevance(candidate, wantWords, seedGenres) {
  const words = tokens(candidate.title || candidate.name);
  let score = 0;
  for (const w of wantWords) if (words.has(w)) score += 2;
  for (const g of genreSet(candidate)) if (seedGenres.has(g)) score += 3;
  return score;
}

// ----------------------------------------------------------- games only

// Play's search results carry no category at all - only a full app record
// does - so an ordinary app that matched the search words is caught in two
// passes: an obvious-app title screen while the pool is built, then a hard
// genre check the moment real details arrive (eager head, or hydration).
const APP_TITLE = /\b(wallpapers?|keyboards?|launchers?|vpn|browsers?|cleaners?|antivirus|scanners?|translator|dictionary|status ?saver|downloaders?|file manager|caller ?id|ringtones?|photo editor|video editor|selfie|screen recorder|flashlight|pdf|invoice|recharge|wallet)\b/i;

function looksLikeApp(c) {
  if (c._isGame) return false;
  return APP_TITLE.test(c.title || "");
}

// Definitive, straight off a full store record: Play tags every game's
// genreId "GAME_*", Apple files games under genre id 6014.
function isGameRecord(raw) {
  if (!raw) return false;
  const gid = String(raw.genreId || "");
  if (gid) return /^GAME/i.test(gid);
  const ids = (raw.genreIds || []).map(String);
  if (ids.length) return ids.includes("6014");
  return /\bgames?\b/i.test(raw.primaryGenre || raw.genre || "");
}

// --------------------------------------------------------- category ranks

// Chart lookups are cached for the life of the warm function instance, so
// later detail batches reuse them instead of re-fetching.
const playCharts = new Map();
const iosCharts = new Map();

async function playChart(genreId, allowance) {
  const key = String(genreId || "");
  if (!key || !/^GAME/i.test(key)) return null;
  if (playCharts.has(key)) return playCharts.get(key);
  if (allowance && allowance.left <= 0) return null;
  if (allowance) allowance.left--;
  try {
    const chart = await gplay.list({
      collection: gplay.collection.TOP_FREE,
      category: key,
      num: 200,
      country: COUNTRY,
      lang: LANG,
      throttle: THROTTLE,
    });
    const map = new Map(chart.map((a, i) => [a.appId, i + 1]));
    playCharts.set(key, map);
    return map;
  } catch {
    playCharts.set(key, new Map());
    return playCharts.get(key);
  }
}

async function iosChart(genreId, allowance) {
  const key = String(genreId || "");
  if (!key || key === "6014") return null;
  if (iosCharts.has(key)) return iosCharts.get(key);
  if (allowance && allowance.left <= 0) return null;
  if (allowance) allowance.left--;
  try {
    const chart = await istore.list({
      collection: istore.collection.TOP_FREE_IOS,
      category: Number(key),
      num: 200,
      country: COUNTRY,
    });
    const map = new Map(chart.map((a, i) => [String(a.id), i + 1]));
    iosCharts.set(key, map);
    return map;
  } catch {
    iosCharts.set(key, new Map());
    return iosCharts.get(key);
  }
}

// Rank each app inside its OWN category, fetching at most `maxCharts` new
// category charts per request so one batch never blows the time budget.
async function rankInOwnCategory(apps, platform, maxCharts = 2) {
  const allowance = { left: maxCharts };
  const byGenre = new Map();
  for (const a of apps) {
    const g = a._genreId;
    if (!g) continue;
    if (!byGenre.has(g)) byGenre.set(g, []);
    byGenre.get(g).push(a);
  }
  for (const [genreId, group] of byGenre) {
    const map = platform === "ios"
      ? await iosChart(genreId, allowance)
      : await playChart(genreId, allowance);
    if (!map) continue;
    for (const a of group) a.rank = map.get(a.appId) ?? null;
  }
}

// ------------------------------------------------------- shape normalizers

const EMPTY_ESTIMATES = {
  downloadsMonth: null,
  downloadsDaily: null,
  downloadsLifetime: null,
  revenueMonth: null,
  revenueLifetime: null,
  rank: null,
  adNetworks: [],
  urlSpy: "",
};

// `full` marks records that came from a real app-detail page, so the dashboard
// knows which cards still need hydrating.
function normalizePlay(a, isSeed = false, full = false) {
  return {
    appId: a.appId || "",
    bundle: a.appId || "",
    title: a.title || "Unknown",
    developer: a.developer || "",
    developerId: a.developerId ? String(a.developerId) : "",
    platform: "android",
    icon: a.icon || null,
    screenshots: Array.isArray(a.screenshots) ? a.screenshots : [],

    rating: a.score != null ? Number(a.score) : null,
    ratingsCount: a.ratings != null ? Number(a.ratings) : null,
    reviewCount: a.reviews != null ? Number(a.reviews) : null,

    // Play publishes a near-exact count next to the "10,000,000+" band.
    installsNum:
      a.maxInstalls != null ? Number(a.maxInstalls)
      : a.minInstalls != null ? Number(a.minInstalls)
      : null,
    installsLabel:
      a.maxInstalls != null ? Number(a.maxInstalls).toLocaleString("en-US")
      : (a.installs || null),

    category: titleCase(a.genre || ""),
    // null means "not known yet" - only a full record can say for sure.
    categoryType: (a.genreId || a.genre) ? (isGameRecord(a) ? "GAME" : "APP") : null,
    _genreId: a.genreId || "",

    version: a.version && a.version !== "VARY" ? a.version : "",
    size: "",
    description: (a.summary || a.description || "").slice(0, 600),
    whatsnew: (a.recentChanges || "").replace(/<[^>]+>/g, " ").slice(0, 400),

    released: isoDay(a.released),
    updated: isoDay(a.updated),
    ageDays: daysSince(a.released),

    iap: !!a.offersIAP,
    // Play publishes the real in-app price band, e.g. "$0.99 - $99.99 per item"
    iapRange: a.IAPRange || "",
    advertised: !!a.adSupported,
    country: "",
    seller: a.developer || "",

    url: a.url || (a.appId ? `https://play.google.com/store/apps/details?id=${a.appId}` : ""),
    isSeed,
    full,
    ...EMPTY_ESTIMATES,
  };
}

function normalizeIos(a, isSeed = false, full = true) {
  const sub = (a.genreIds || []).map(String).find((g) => g && g !== "6014");
  return {
    appId: String(a.id || ""),
    bundle: a.appId || "",
    title: a.title || "Unknown",
    developer: a.developer || "",
    developerId: a.developerId ? String(a.developerId) : "",
    platform: "ios",
    icon: a.icon || null,
    screenshots: Array.isArray(a.screenshots) ? a.screenshots : [],

    rating: a.score != null ? Number(a.score) : null,
    ratingsCount: a.reviews != null ? Number(a.reviews) : null,
    reviewCount: a.reviews != null ? Number(a.reviews) : null,

    installsNum: null,
    installsLabel: null,

    category: a.primaryGenre || "",
    categoryType: (a.primaryGenre || (a.genreIds || []).length) ? (isGameRecord(a) ? "GAME" : "APP") : null,
    _genreId: sub || "",

    version: a.version || "",
    size: humanSize(a.size),
    description: (a.description || "").slice(0, 600),
    whatsnew: (a.releaseNotes || "").slice(0, 400),

    released: isoDay(a.released),
    updated: isoDay(a.updated),
    ageDays: daysSince(a.released),

    iap: false,
    iapRange: "",
    advertised: false,
    country: "",
    seller: a.developer || "",

    url: a.url || "",
    isSeed,
    full,
    ...EMPTY_ESTIMATES,
  };
}

// ------------------------------------------------------------- Android run

// Several angles of attack, so even a niche genre returns hundreds of titles:
// Google's own similar list, the phrase itself, each meaningful word on its
// own, and the category's top-free chart.
async function androidPool(seed, seedRaw, query, max) {
  const q = [];
  const words = [...tokens(query)].slice(0, 3);

  q.push(gplay.similar({ appId: seed.appId, country: COUNTRY, lang: LANG, throttle: THROTTLE }));
  q.push(gplay.search({ term: query, num: 100, country: COUNTRY, lang: LANG, throttle: THROTTLE }));

  const kw = keywordFrom(seed.title);
  if (kw && kw.toLowerCase() !== query.toLowerCase()) {
    q.push(gplay.search({ term: kw, num: 100, country: COUNTRY, lang: LANG, throttle: THROTTLE }));
  }
  if (max > 40) {
    for (const w of words) {
      q.push(gplay.search({ term: w, num: 100, country: COUNTRY, lang: LANG, throttle: THROTTLE }));
    }
    if (seedRaw.genreId) {
      q.push(playChart(seedRaw.genreId).then((m) =>
        m ? [...m.keys()].map((appId) => ({ appId, _isGame: true })) : []
      ));
    }
  }

  const settled = await Promise.allSettled(q);
  const pool = [];
  for (const r of settled) if (r.status === "fulfilled" && Array.isArray(r.value)) pool.push(...r.value);
  return pool;
}

async function scoutAndroid({ game, max, deadline }) {
  const looksLikeBundle = /^[a-z][a-z0-9_]*(\.[a-z0-9_]+)+$/i.test(game.trim());

  let seedRaw;
  if (looksLikeBundle) {
    seedRaw = await gplay.app({ appId: game.trim(), country: COUNTRY, lang: LANG, throttle: THROTTLE });
  } else {
    const hits = await gplay.search({ term: game, num: 5, country: COUNTRY, lang: LANG, throttle: THROTTLE });
    if (!hits.length) throw new Error(`No Play Store game found for "${game}". Try the exact store title.`);
    seedRaw = await gplay.app({ appId: hits[0].appId, country: COUNTRY, lang: LANG, throttle: THROTTLE });
  }
  const seed = normalizePlay(seedRaw, true, true);

  // A bundle-id search still gets a full name search, using the resolved title.
  const query = looksLikeBundle ? keywordFrom(seed.title) : game;
  const pool = await androidPool(seed, seedRaw, query, max);

  const wantWords = tokens(looksLikeBundle ? seed.title : game);
  const seedGenres = genreSet(seedRaw);
  const seen = new Set([seed.appId]);

  // Searching a word like "ball" also matches wallpapers and keyboards, so
  // when the seed is a game the results are held to games only.
  const gamesOnly = isGameRecord(seedRaw);

  const scored = pool
    .filter((x) => x && x.appId && !seen.has(x.appId) && seen.add(x.appId))
    .filter((x) => !gamesOnly || !looksLikeApp(x))
    .map((x) => ({ raw: x, score: relevance(x, wantWords, seedGenres) }));

  const kept = scored.filter((r) => r.score > 0);
  const ranked = (kept.length >= 5 ? kept : scored)
    .sort((a, b) => b.score - a.score)
    .slice(0, Math.min(max * 3, 500));

  // A Play search result carries no category whatsoever, so a candidate is
  // only known to be a game once its full record is read. Rather than paint
  // cards and snatch them back a second later, NOTHING goes out unverified:
  // this fetches the first screenful now and hands the rest over as bare ids
  // for the browser to check and append as they clear. The grid only ever
  // grows, and never shows an app.
  const order = new Map(ranked.map((r, i) => [r.raw.appId, i]));
  const competitors = [];

  await mapLimit(ranked.slice(0, EAGER).map((r) => r.raw.appId), 5, deadline, async (appId) => {
    const full = await gplay.app({ appId, country: COUNTRY, lang: LANG, throttle: THROTTLE });
    if (gamesOnly && !isGameRecord(full)) return;   // an ordinary app - never rendered
    competitors.push(normalizePlay(full, false, true));
  });
  competitors.sort((a, b) => (order.get(a.appId) ?? 1e9) - (order.get(b.appId) ?? 1e9));

  await rankInOwnCategory([seed, ...competitors], "android", 2);

  return {
    seed,
    competitors,
    pending: ranked.slice(EAGER).map((r) => r.raw.appId),
    max,
    gamesOnly,
  };
}

// ----------------------------------------------------------------- iOS run

async function scoutIos({ game, max }) {
  const looksLikeId = /^\d{6,}$/.test(game.trim());

  let seedRaw;
  if (looksLikeId) {
    seedRaw = await istore.app({ id: game.trim(), country: COUNTRY });
  } else {
    const hits = await istore.search({ term: game, num: 5, country: COUNTRY });
    if (!hits.length) throw new Error(`No App Store game found for "${game}". Try the exact store title.`);
    seedRaw = hits[0];
  }
  const seed = normalizeIos(seedRaw, true);

  const query = looksLikeId ? keywordFrom(seed.title) : game;
  const words = [...tokens(query)].slice(0, 3);

  // Apple's lookup returns complete records, so everything here is already
  // "full" - iOS needs no hydration pass.
  const q = [
    istore.search({ term: query, num: 100, country: COUNTRY }),
    istore.similar({ id: seed.appId, country: COUNTRY }),
  ];
  if (max > 40) {
    for (const w of words) q.push(istore.search({ term: w, num: 100, country: COUNTRY }));
  }

  const settled = await Promise.allSettled(q);
  const pool = [];
  for (const r of settled) if (r.status === "fulfilled" && Array.isArray(r.value)) pool.push(...r.value);

  const wantWords = tokens(looksLikeId ? seed.title : game);
  const seedGenres = genreSet(seedRaw);
  const seen = new Set([seed.appId]);

  // Apple returns the genre with every record, so non-games are dropped here
  // and for good - iOS needs no second pass.
  const gamesOnly = isGameRecord(seedRaw);

  const scored = pool
    .filter((x) => x && x.id && !seen.has(String(x.id)) && seen.add(String(x.id)))
    .filter((x) => !gamesOnly || isGameRecord(x))
    .map((x) => ({ raw: x, score: relevance(x, wantWords, seedGenres) }));

  const kept = scored.filter((r) => r.score > 0);
  const competitors = (kept.length >= 5 ? kept : scored)
    .sort((a, b) => (b.score - a.score) || ((b.raw.reviews ?? 0) - (a.raw.reviews ?? 0)))
    .slice(0, max)
    .map((r) => normalizeIos(r.raw, false));

  // Apple hands back the genre with every record, so this list is already
  // games-only and complete - nothing left for the browser to verify.
  await rankInOwnCategory([seed, ...competitors], "ios", 3);
  return { seed, competitors, pending: [], max, gamesOnly };
}

// ------------------------------------------------- per-batch detail filling

export async function fetchDetails({ ids, platform }) {
  const list = [...new Set((ids || []).filter(Boolean).map(String))].slice(0, 12);
  if (!list.length) return [];

  const deadline = Date.now() + 7000;
  const out = [];

  if (platform === "ios") {
    await mapLimit(list, 4, deadline, async (id) => {
      const a = await istore.app({ id, country: COUNTRY });
      out.push(normalizeIos(a, false));
    });
  } else {
    await mapLimit(list, 5, deadline, async (appId) => {
      const a = await gplay.app({ appId, country: COUNTRY, lang: LANG, throttle: THROTTLE });
      out.push(normalizePlay(a, false, true));
    });
  }

  await rankInOwnCategory(out, platform, 2);
  return out;
}

// ------------------------------------------------------------------ export

export default async function scout({ game, platform, min, max }) {
  const deadline = Date.now() + BUDGET_MS;
  return platform === "ios"
    ? scoutIos({ game, max })
    : scoutAndroid({ game, max, deadline });
}

// Free adapter - no API key, no credits, no account.
//
//   Android : google-play-scraper   (reads the public Play Store pages)
//   iOS     : app-store-scraper     (Apple's public iTunes search/lookup)
//
// What you DO get: the seed game, its competitors, icons, screenshots,
// ratings, review counts, install counts, category rank, developer, dates,
// IAP and ad-supported flags.
//
// What you DON'T get: downloads/month, downloads/day and revenue estimates.
// Those are modelled numbers, not public data, so no free source has them -
// the dashboard hides those tiles rather than showing a guess.

import gplayPkg from "google-play-scraper";
import istorePkg from "app-store-scraper";

const gplay = gplayPkg.default || gplayPkg;
const istore = istorePkg.default || istorePkg;

const COUNTRY = (process.env.APP_COUNTRY || "US").toLowerCase();
const LANG = (process.env.APP_LANGUAGE || "en_US").split(/[_-]/)[0].toLowerCase();

// Play Store bans an IP for ~1 hour if you hammer it, so cap requests/second.
const THROTTLE = Number(process.env.SCRAPE_THROTTLE || 8);
// Serverless functions get killed at 10s, so stop enriching before that.
const BUDGET_MS = Number(process.env.SCRAPE_BUDGET_MS || 6500);

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

// "Ball Connect Puzzle: Link Dots" -> "Ball Connect"
function keywordFrom(title) {
  const head = String(title || "")
    .split(/[:\-|]/)[0]
    .replace(/[^\p{L}\p{N} ]+/gu, " ")
    .trim();
  const words = head.split(/\s+/).filter(Boolean);
  return words.slice(0, 2).join(" ") || String(title || "").trim();
}

// Run tasks with a concurrency cap AND a wall-clock deadline: whatever hasn't
// finished by the deadline is simply skipped, so we always return something.
async function mapLimit(items, limit, deadline, fn) {
  let i = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (i < items.length && Date.now() < deadline) {
      const idx = i++;
      try { await fn(items[idx], idx); } catch { /* keep the basic card */ }
    }
  });
  await Promise.all(workers);
}

// --------------------------------------------------------- relevance match

// Words worth matching on (drops "the", "of", short noise).
function tokens(s) {
  return new Set(
    String(s || "")
      .toLowerCase()
      .replace(/[^\p{L}\p{N} ]+/gu, " ")
      .split(/\s+/)
      .filter((w) => w.length > 2)
  );
}

// Genres so broad they say nothing about what the game actually is.
const GENERIC_GENRES = new Set(["games", "entertainment", "app", "apps"]);

function genreSet(a) {
  const raw = [].concat(a.genres || [], a.genre || [], a.primaryGenre || []);
  return new Set(
    raw.map((g) => String(g).toLowerCase().replace(/^games?[_ ]/, "").trim())
       .filter((g) => g && !GENERIC_GENRES.has(g))
  );
}

// How much does this candidate look like a real competitor of the seed?
// Apple's similar() is really "customers also bought", so without this a
// puzzle search comes back full of trivia and hypercasual runners.
function relevance(candidate, wantWords, seedGenres) {
  const words = tokens(candidate.title || candidate.name);
  let score = 0;
  for (const w of wantWords) if (words.has(w)) score += 2;
  for (const g of genreSet(candidate)) if (seedGenres.has(g)) score += 3;
  return score;
}

// --------------------------------------------------------- category ranks

// Real category rank, read off the live top-free chart for the seed's own
// category. Only charting games get a number - everyone else genuinely has
// no rank, so the tile stays empty rather than showing a guess.
async function playRankMap(genreId) {
  if (!genreId || !/^GAME/i.test(String(genreId))) return new Map();
  try {
    const chart = await gplay.list({
      collection: gplay.collection.TOP_FREE,
      category: String(genreId),
      num: 200,
      country: COUNTRY,
      lang: LANG,
      throttle: THROTTLE,
    });
    return new Map(chart.map((a, i) => [a.appId, i + 1]));
  } catch {
    return new Map();
  }
}

async function iosRankMap(genreIds) {
  // 6014 is the catch-all "Games" id; the sub-genre chart is the useful one.
  const sub = (genreIds || []).map(String).find((g) => g && g !== "6014");
  if (!sub) return new Map();
  try {
    const chart = await istore.list({
      collection: istore.collection.TOP_FREE_IOS,
      category: Number(sub),
      num: 200,
      country: COUNTRY,
    });
    return new Map(chart.map((a, i) => [String(a.id), i + 1]));
  } catch {
    return new Map();
  }
}

function applyRanks(ranks, seed, competitors) {
  seed.rank = ranks.get(seed.appId) ?? null;
  for (const c of competitors) c.rank = ranks.get(c.appId) ?? null;
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

function normalizePlay(a, isSeed = false) {
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

    // Play publishes a near-exact count (maxInstalls) next to the
    // "10,000,000+" band; prefer the real number when it is there.
    installsNum:
      a.maxInstalls != null ? Number(a.maxInstalls)
      : a.minInstalls != null ? Number(a.minInstalls)
      : null,
    installsLabel:
      a.maxInstalls != null ? Number(a.maxInstalls).toLocaleString("en-US")
      : (a.installs || null),

    category: titleCase(a.genre || ""),
    categoryType: /game/i.test(a.genreId || a.genre || "") ? "GAME" : "APP",

    version: a.version && a.version !== "VARY" ? a.version : "",
    size: "",
    description: (a.summary || a.description || "").slice(0, 600),
    whatsnew: (a.recentChanges || "").replace(/<[^>]+>/g, " ").slice(0, 400),

    released: isoDay(a.released),
    updated: isoDay(a.updated),
    ageDays: daysSince(a.released),

    iap: !!a.offersIAP,
    advertised: !!a.adSupported,
    country: "",
    seller: a.developer || "",

    url: a.url || (a.appId ? `https://play.google.com/store/apps/details?id=${a.appId}` : ""),
    isSeed,
    ...EMPTY_ESTIMATES,
  };
}

function normalizeIos(a, isSeed = false) {
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
    categoryType: /game/i.test(a.primaryGenre || "") ? "GAME" : "APP",

    version: a.version || "",
    size: humanSize(a.size),
    description: (a.description || "").slice(0, 600),
    whatsnew: (a.releaseNotes || "").slice(0, 400),

    released: isoDay(a.released),
    updated: isoDay(a.updated),
    ageDays: daysSince(a.released),

    iap: false,
    advertised: false,
    country: "",
    seller: a.developer || "",

    url: a.url || "",
    isSeed,
    ...EMPTY_ESTIMATES,
  };
}

// ------------------------------------------------------------- Android run

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
  const seed = normalizePlay(seedRaw, true);

  // Competitors: Google's own "similar apps" list first, then a keyword search
  // to top it up when the user asked for more than similar() returns.
  const pool = [];
  try {
    pool.push(...await gplay.similar({ appId: seed.appId, country: COUNTRY, lang: LANG, throttle: THROTTLE }));
  } catch { /* some apps have no similar list */ }

  if (pool.length < max) {
    try {
      pool.push(...await gplay.search({
        term: looksLikeBundle ? keywordFrom(seed.title) : game,
        num: Math.min(max + 20, 100),
        country: COUNTRY, lang: LANG, throttle: THROTTLE,
      }));
    } catch { /* similar list alone is fine */ }
  }

  const wantWords = tokens(looksLikeBundle ? seed.title : game);
  const seedGenres = genreSet(seedRaw);
  const seen = new Set([seed.appId]);

  const scored = pool
    .filter((x) => x && x.appId && !seen.has(x.appId) && seen.add(x.appId))
    .map((x) => ({ raw: x, score: relevance(x, wantWords, seedGenres) }));

  // Keep only plausible competitors; if that leaves too few, fall back to all.
  const kept = scored.filter((r) => r.score > 0);
  const competitors = (kept.length >= 5 ? kept : scored)
    .sort((a, b) => b.score - a.score)
    .slice(0, max)
    .map((r) => normalizePlay(r.raw, false));

  // Search/similar results carry no installs or screenshots - fetch the real
  // page for each until the time budget runs out. The category chart is
  // pulled alongside it, so it costs no extra wall-clock.
  const [ranks] = await Promise.all([
    playRankMap(seedRaw.genreId),
    mapLimit(competitors, 6, deadline, async (c) => {
      const full = await gplay.app({ appId: c.appId, country: COUNTRY, lang: LANG, throttle: THROTTLE });
      Object.assign(c, normalizePlay(full, false));
    }),
  ]);
  applyRanks(ranks, seed, competitors);

  competitors.sort((a, b) => (b.installsNum ?? -1) - (a.installsNum ?? -1));
  return { seed, competitors };
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

  // Search FIRST on iOS. Apple's similar() is "customers also bought", which
  // returns whatever big casual titles the same audience installs; keyword
  // search is far closer to "games like this one".
  const pool = [];
  try {
    pool.push(...await istore.search({
      term: looksLikeId ? keywordFrom(seed.title) : game,
      num: Math.min(max + 30, 100),
      country: COUNTRY,
    }));
  } catch { /* fall back to the similar list below */ }

  try {
    pool.push(...await istore.similar({ id: seed.appId, country: COUNTRY }));
  } catch { /* not every app has a "customers also bought" list */ }

  const wantWords = tokens(looksLikeId ? seed.title : game);
  const seedGenres = genreSet(seedRaw);
  const seen = new Set([seed.appId]);

  const scored = pool
    .filter((x) => x && x.id && !seen.has(String(x.id)) && seen.add(String(x.id)))
    .map((x) => ({ raw: x, score: relevance(x, wantWords, seedGenres) }));

  const kept = scored.filter((r) => r.score > 0);
  const competitors = (kept.length >= 5 ? kept : scored)
    .sort((a, b) => (b.score - a.score) || ((b.raw.reviews ?? 0) - (a.raw.reviews ?? 0)))
    .slice(0, max)
    .map((r) => normalizeIos(r.raw, false));

  applyRanks(await iosRankMap(seedRaw.genreIds), seed, competitors);

  return { seed, competitors };
}

// ------------------------------------------------------------------ export

export default async function scout({ game, platform, min, max }) {
  const deadline = Date.now() + BUDGET_MS;
  return platform === "ios"
    ? scoutIos({ game, max })
    : scoutAndroid({ game, max, deadline });
}

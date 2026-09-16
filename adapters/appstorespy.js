// AppStoreSpy adapter — built directly from the official OpenAPI spec
// (https://api.appstorespy.com/v1/openapi.json).
//
// Auth: header  API-KEY: <token>
// Flow: resolve the seed game by name -> pull its similar apps (competitors)
//       -> normalize everything into the dashboard shape.
//
// Google Play: the /play/apps/similar response already includes icon +
//   screenshots + all metrics, so no extra calls are needed.
// App Store (iOS): the similar list has icons + metrics but not screenshots,
//   so we fetch per-app details (with limited concurrency) to get screenshots.

const BASE = "https://api.appstorespy.com/v1";
const KEY = process.env.API_KEY || "";
const COUNTRY = process.env.APP_COUNTRY || "US";
const LANG = process.env.APP_LANGUAGE || "en_US";

// Only request fields that actually exist on each list model, or the API
// rejects the whole request with 400. iOS list (NewIosApp) has no screenshots
// or daily-download fields; Play list (NewPlayApp) does.
const IOS_FIELDS = [
  "id", "bundle", "name", "icon", "video", "category", "category_type",
  "revenue_month", "downloads_month", "revenue_lifetime", "downloads_lifetime",
  "rating_avg", "rating_value", "rating_count", "review_count",
  "release_date", "update_date", "developer_name", "developer_id",
  "version", "size", "description_full", "whatsnew",
  "chart_info", "iap", "advertised", "ads", "url", "url_appstorespy", "seller",
];
const PLAY_FIELDS = [
  "id", "bundle", "name", "icon", "screenshots", "video", "category", "category_type",
  "revenue_month", "downloads_month", "downloads_daily", "downloads_mark", "downloads_exact", "ipd",
  "revenue_lifetime", "downloads_lifetime",
  "rating_avg", "rating_value", "rating_count", "review_count",
  "release_date", "update_date", "developer_name", "developer_id",
  "version", "size", "description_full", "whatsnew",
  "chart_info", "iap", "advertised", "ads", "url", "url_appstorespy", "address_country",
];

async function api(method, pathname, { query, body } = {}) {
  const url = new URL(BASE + pathname);
  if (query) for (const [k, v] of Object.entries(query)) {
    if (v !== undefined && v !== null && v !== "") url.searchParams.set(k, v);
  }
  const res = await fetch(url, {
    method,
    headers: {
      "accept": "application/json",
      "API-KEY": KEY,
      ...(body ? { "content-type": "application/json" } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  if (res.status === 403) throw new Error("API key rejected (403). Check API_KEY in .env.");
  if (res.status === 429) throw new Error("Rate limit hit (429). Wait a moment and try again.");
  if (!res.ok && res.status !== 206) {
    let extra = "";
    try { extra = " — " + (await res.text()).slice(0, 300); } catch {}
    throw new Error(`AppStoreSpy ${res.status} on ${pathname}${extra}`);
  }
  return res.json();
}

// run async tasks with a small concurrency cap (keeps us under rate limits)
async function mapLimit(items, limit, fn) {
  const out = [];
  let i = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (i < items.length) {
      const idx = i++;
      out[idx] = await fn(items[idx], idx);
    }
  });
  await Promise.all(workers);
  return out;
}

// Pull a short, broad-enough search keyword out of a full store title.
// "Ball Connect Puzzle: Link Dots" -> "Ball Connect"
function keywordFrom(title) {
  const head = String(title || "")
    .split(/[:\-|–—•]/)[0]
    .replace(/[^\p{L}\p{N} ]+/gu, " ")
    .trim();
  const words = head.split(/\s+/).filter(Boolean);
  return words.slice(0, 2).join(" ") || String(title || "").replace(/[^\p{L}\p{N} ]+/gu, " ").trim();
}

function daysSince(dateStr) {  if (!dateStr) return null;
  const d = new Date(dateStr);
  if (isNaN(d)) return null;
  return Math.max(0, Math.round((Date.now() - d.getTime()) / 86400000));
}

function num(v) {
  if (v === undefined || v === null || v === "") return null;
  const n = Number(String(v).replace(/[^0-9.]/g, ""));
  return Number.isFinite(n) ? n : null;
}

function prettyCategory(c) {
  if (!c) return "";
  const raw = Array.isArray(c) ? c[0] : c;
  if (!raw) return "";
  return String(raw)
    .replace(/^GAMES?_/i, "")
    .replace(/_/g, " ")
    .toLowerCase()
    .replace(/\b\w/g, (m) => m.toUpperCase());
}

function adNetworks(ads) {
  const n = ads && ads.network;
  if (!n) return [];
  return Array.isArray(n) ? n : [n];
}

// Map either a details object (PlayApp/IosApp) or a list object
// (NewPlayApp/NewIosApp) into the one shape the dashboard uses.
function normalize(a, platform, isSeed = false) {
  const installsNum = num(a.downloads_mark) ?? num(a.installs_exact) ?? num(a.installs);
  return {
    appId: a.id || a.bundle || "",
    bundle: a.bundle || a.id || "",
    title: a.name || "Unknown",
    developer: a.developer_name || "",
    developerId: a.developer_id || "",
    platform,
    icon: a.icon || null,
    screenshots: Array.isArray(a.screenshots) ? a.screenshots : [],

    rating: num(a.rating_avg) ?? num(a.rating_value),
    ratingsCount: num(a.rating_count),
    reviewCount: num(a.review_count),

    installsNum,
    installsLabel: (typeof a.installs === "string" && a.installs) || null,
    downloadsMonth: num(a.downloads_month) ?? num(a.downloads),
    downloadsDaily: num(a.downloads_daily) ?? num(a.ipd),
    downloadsLifetime: num(a.downloads_lifetime),
    revenueMonth: num(a.revenue_month) ?? num(a.revenue),
    revenueLifetime: num(a.revenue_lifetime),

    category: prettyCategory(a.category),
    categoryType: a.category_type || a.type || "",
    rank: a.chart_info ? num(a.chart_info.position) : null,

    version: a.version || "",
    size: a.size || "",
    description: (a.description_full || a.description_short || "").slice(0, 600),
    whatsnew: (a.whatsnew || "").slice(0, 400),

    released: (a.release_date || a.released || "").slice(0, 10),
    updated: (a.update_date || a.updated || "").slice(0, 10),
    ageDays: num(a.age) ?? daysSince(a.release_date || a.released),

    iap: !!a.iap,
    advertised: !!a.advertised,
    adNetworks: adNetworks(a.ads),
    country: a.address_country || "",
    seller: a.seller || "",

    url: a.url || "",
    urlSpy: a.url_appstorespy || "",
    isSeed,
  };
}

// ---------------------------------------------------------------- estimates
//
// Downloads and revenue are the three figures the public stores never publish,
// so a free-mode search can't fill them in. This pulls them for a whole search
// in a handful of BULK calls - the same name-filtered query the full adapter
// pages through - rather than one call per game, so topping up 200 cards costs
// about six credits instead of two hundred.
//
// Keyed by both bundle and id, because the free adapters key Android results
// on the package name and iOS results on the numeric store id.
export async function estimates({ query, platform, max = 250 }) {
  if (!KEY) return new Map();

  const isIos = platform === "ios";
  const queryPath = isIos ? "/ios/apps/query" : "/play/apps/query";
  const fields = isIos
    ? ["id", "bundle", "name", "downloads_month", "revenue_month"]
    : ["id", "bundle", "name", "downloads_month", "downloads_daily", "ipd", "revenue_month"];

  // A long store title matches almost nothing, so search on its keyword.
  const name = keywordFrom(query);
  const out = new Map();
  const PAGE = 50;

  for (let page = 1; page <= 6 && out.size < max; page++) {
    const resp = await api("POST", queryPath, {
      body: {
        limit: PAGE,
        page,
        sort: isIos ? "-downloads_month" : "-downloads_mark",
        country: COUNTRY,
        language: LANG,
        fields,
        filter: { published: true, name, category_type: "GAME" },
      },
    });
    const data = resp.data || [];
    for (const a of data) {
      const est = {
        downloadsMonth: num(a.downloads_month),
        downloadsDaily: num(a.downloads_daily) ?? num(a.ipd),
        revenueMonth: num(a.revenue_month),
      };
      // nothing worth merging if all three came back empty
      if (est.downloadsMonth == null && est.downloadsDaily == null && est.revenueMonth == null) continue;
      if (a.bundle) out.set(String(a.bundle), est);
      if (a.id) out.set(String(a.id), est);
    }
    if (data.length < PAGE) break;
  }
  return out;
}

export default async function scout({ game, platform, min, max }) {
  const isIos = platform === "ios";
  const appsPath = isIos ? "/ios/apps" : "/play/apps";
  const queryPath = isIos ? "/ios/apps/query" : "/play/apps/query";

  // The input can be a bundle ID (Play: com.xxx.yyy, iOS: a numeric App Store id)
  // or a plain game name. A bundle ID resolves the exact app; a name is searched.
  const looksLikeBundle = isIos
    ? /^\d{6,}$/.test(game.trim())
    : /^[a-z][a-z0-9_]*(\.[a-z0-9_]+)+$/i.test(game.trim());

  // 1) resolve the seed
  let seedId;
  if (looksLikeBundle) {
    seedId = game.trim();
  } else {
    const found = await api("GET", appsPath, {
      query: { q: game, limit: 1, country: COUNTRY, language: LANG },
    });
    const firstMatch = Array.isArray(found) ? found[0] : (found.data || [])[0];
    if (!firstMatch) throw new Error(`No app found for "${game}". Try the exact store title or a bundle ID.`);
    seedId = firstMatch.id || firstMatch.bundle;
  }

  // 2) full seed details by id (populates rating / installs / revenue / category)
  const seedRaw = await api("GET", `${appsPath}/${encodeURIComponent(seedId)}`, {
    query: { country: COUNTRY, language: LANG },
  });
  const seed = normalize(seedRaw, platform, true);

  // the seed's type (APP vs GAME), to keep results the same kind
  const rawType = String(seedRaw.type || "GAME").toUpperCase().includes("APP") ? "APP" : "GAME";
  // games "of that type" are found by a short keyword. For a bundle ID we
  // derive it from the resolved title; for a name search we use what the user
  // typed (already a keyword). Using the full long title matches almost nothing.
  const nameQuery = looksLikeBundle ? keywordFrom(seed.title) : game;

  // 3) competitors = published apps whose NAME matches the seed's title.
  //    Page through results so we can show many games (not just a handful).
  const want = Math.min(max + 40, 250); // fetch buffer, capped
  const PAGE = 50;
  const raw = [];
  for (let page = 1; page <= 6 && raw.length < want; page++) {
    const resp = await api("POST", queryPath, {
      body: {
        limit: PAGE,
        page,
        sort: isIos ? "-downloads_month" : "-downloads_mark", // installs-first on Play
        country: COUNTRY,
        language: LANG,
        fields: isIos ? IOS_FIELDS : PLAY_FIELDS,
        filter: { published: true, name: nameQuery, category_type: rawType },
      },
    });
    const data = resp.data || [];
    raw.push(...data);
    if (data.length < PAGE) break; // no more pages
  }

  let competitors = raw
    .filter((x) => (x.id || x.bundle) !== seedId)
    .map((x) => normalize(x, platform, false));

  // Show EVERY matching game (new or old) — no install/rating filter.
  // De-dupe by app id (paging can overlap) and rank by installs / downloads.
  const seen = new Set();
  competitors = competitors.filter((c) => (seen.has(c.appId) ? false : seen.add(c.appId)));
  competitors.sort((a, b) =>
    isIos
      ? (b.downloadsMonth ?? 0) - (a.downloadsMonth ?? 0)
      : (b.installsNum ?? 0) - (a.installsNum ?? 0)
  );

  competitors = competitors.slice(0, max);

  // 4) iOS: list model has no screenshots — fetch them for the first 15 shown
  //    (keeps API calls bounded even when many results are requested).
  if (isIos) {
    const head = competitors.slice(0, 15);
    await mapLimit(head, 4, async (c) => {
      try {
        const d = await api("GET", `/ios/apps/${encodeURIComponent(c.appId)}`, {
          query: { country: COUNTRY, language: LANG },
        });
        if (Array.isArray(d.screenshots)) c.screenshots = d.screenshots;
        if (!c.icon && d.icon) c.icon = d.icon;
      } catch { /* keep icon-only card if details fail */ }
    });
  }

  return { seed, competitors };
}

// AppBird adapter — same interface as the AppStoreSpy one.
//
// Structure is identical on purpose: only the endpoint paths, auth, and field
// names differ between providers. Paste one real AppBird response and I'll fill
// these in exactly. Until then it mirrors the AppStoreSpy best-guess mapping.

const BASE = process.env.APPBIRD_BASE_URL || "https://api.appbird.io";
const KEY = process.env.API_KEY || "";

async function api(pathname, params = {}) {
  const url = new URL(pathname, BASE);
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null) url.searchParams.set(k, v);
  }
  const res = await fetch(url, {
    headers: {
      Accept: "application/json",
      // TODO: confirm AppBird auth (Bearer header vs api key param).
      Authorization: `Bearer ${KEY}`,
    },
  });
  if (!res.ok) throw new Error(`AppBird ${res.status} on ${pathname}`);
  return res.json();
}

function num(v) {
  if (v === undefined || v === null || v === "") return null;
  const n = Number(String(v).replace(/[^0-9.]/g, ""));
  return Number.isFinite(n) ? n : null;
}

function normalize(a, platform, isSeed = false) {
  const shots = a.screenshots || a.screenshotUrls || a.images || [];
  return {
    appId: a.id || a.appId || a.bundleId,
    title: a.title || a.name || "Unknown",
    developer: a.developer || a.developerName || "",
    platform,
    icon: a.icon || a.iconUrl || a.image || null,
    screenshots: Array.isArray(shots) ? shots : [],
    seed: a.title || a.name || "app",
    rating: num(a.rating ?? a.score),
    ratingsCount: num(a.ratingsCount ?? a.reviews),
    installs: num(a.installs ?? a.downloads),
    revenue: num(a.revenue ?? a.revenueMonthly),
    price: a.price ? String(a.price) : "Free",
    category: a.category || a.genre || "",
    rank: isSeed ? null : num(a.rank ?? a.categoryRank),
    updated: (a.updated || a.releaseDate || "").slice(0, 10),
    url: a.url || a.storeUrl || "#",
    isSeed,
  };
}

export default async function scout({ game, platform, min, max }) {
  // TODO: confirm AppBird's search / details / similar endpoints.
  const search = await api("/search", { q: game, platform, limit: 1 });
  const first = (search.results || search.data || [])[0];
  if (!first) throw new Error(`No app found for "${game}"`);
  const seedId = first.id || first.appId;

  const seedRaw = await api(`/apps/${encodeURIComponent(seedId)}`, { platform });
  const seed = normalize(seedRaw.app || seedRaw.data || seedRaw, platform, true);

  const sim = await api(`/apps/${encodeURIComponent(seedId)}/similar`, { platform, limit: max });
  const simList = (sim.results || sim.data || []).slice(0, max);

  const competitors = [];
  for (const s of simList) {
    const id = s.id || s.appId;
    try {
      const raw = await api(`/apps/${encodeURIComponent(id)}`, { platform });
      competitors.push(normalize(raw.app || raw.data || raw, platform, false));
    } catch {
      competitors.push(normalize(s, platform, false));
    }
    if (competitors.length >= max) break;
  }

  return { seed, competitors };
}

// Mock data source — same shape the real AppStoreSpy adapter returns, so the
// dashboard looks identical whether you're on sample data or live data.

const GAMES = [
  { title: "Merge Kingdom Saga", dev: "Sunspark Games", cat: "Puzzle", hue: 268, nets: ["Admob"] },
  { title: "Idle Tower Tycoon", dev: "Northwind Studio", cat: "Simulation", hue: 199, nets: ["Applovin", "Unity"] },
  { title: "Dragonfall Heroes", dev: "Emberline", cat: "Role Playing", hue: 12, nets: ["Admob", "IronSource"] },
  { title: "Bubble Pop Blast", dev: "Candybit", cat: "Casual", hue: 330, nets: ["Admob"] },
  { title: "Galaxy Raiders 3D", dev: "Voidworks", cat: "Action", hue: 224, nets: ["Applovin"] },
  { title: "Farm Valley Story", dev: "Green Acre", cat: "Simulation", hue: 96, nets: ["Admob", "Meta"] },
  { title: "Word Crush Daily", dev: "Lexlab", cat: "Word", hue: 42, nets: ["Admob"] },
  { title: "Racing Rivals X", dev: "Redline Interactive", cat: "Racing", hue: 6, nets: ["Unity", "IronSource"] },
  { title: "Zombie Siege Defense", dev: "Grimgate", cat: "Strategy", hue: 140, nets: ["Applovin"] },
  { title: "Solitaire Royale", dev: "Cardhouse", cat: "Card", hue: 168, nets: ["Admob"] },
  { title: "Ninja Run Legends", dev: "Shurikenware", cat: "Arcade", hue: 286, nets: ["Meta"] },
  { title: "Match Masters Quest", dev: "Tilewave", cat: "Puzzle", hue: 312, nets: ["Admob", "Applovin"] },
  { title: "Empire Clash Online", dev: "Ironforge", cat: "Strategy", hue: 20, nets: ["Unity"] },
  { title: "Pixel Dungeon Crawl", dev: "8bit Alley", cat: "Adventure", hue: 250, nets: ["Admob"] },
];

function seeded(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
  return () => {
    h += 0x6d2b79f5; let t = h;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function daysAgo(n) {
  const d = new Date(); d.setDate(d.getDate() - n);
  return d.toISOString().slice(0, 10);
}

function build(entry, platform, isSeed) {
  const r = seeded(entry.title + platform);
  const monthly = Math.round((0.05 + r() * 6) * 1_000_000);
  const daily = Math.round(monthly / 30);
  const installsNum = Math.round(monthly * (6 + r() * 30));
  const rating = +(3.6 + r() * 1.35).toFixed(2);
  const ageDays = Math.round(r() * 900);
  return {
    appId: (platform === "ios" ? "" : "com.example.") + entry.title.toLowerCase().replace(/[^a-z0-9]+/g, ""),
    bundle: (platform === "ios" ? "" : "com.example.") + entry.title.toLowerCase().replace(/[^a-z0-9]+/g, ""),
    title: entry.title,
    developer: entry.dev,
    developerId: "dev-" + Math.floor(r() * 1e6),
    platform,
    icon: null,          // real adapter puts a URL here
    screenshots: [],     // real adapter puts URLs here
    seed: entry.title,   // used to draw a placeholder when icon is null
    hue: entry.hue,

    rating,
    ratingsCount: Math.round(installsNum * (0.01 + r() * 0.03)),
    reviewCount: Math.round(installsNum * (0.002 + r() * 0.01)),

    installsNum,
    installsLabel: null,
    downloadsMonth: monthly,
    downloadsDaily: daily,
    revenueMonth: Math.round((3 + r() * 400) * 1000),
    revenueLifetime: Math.round((50 + r() * 6000) * 1000),
    downloadsLifetime: Math.round(installsNum * (1 + r() * 3)),
    version: (1 + Math.floor(r() * 6)) + "." + Math.floor(r() * 9) + "." + Math.floor(r() * 9),
    size: (20 + Math.floor(r() * 180)) + " MB",
    description: "A polished " + entry.cat.toLowerCase() + " game with satisfying levels, daily rewards and smooth controls. Sample description shown in mock mode.",
    whatsnew: "Bug fixes and performance improvements. New levels added. (mock)",

    category: entry.cat,
    categoryType: "GAME",
    rank: isSeed ? null : Math.round(1 + r() * 120),

    released: daysAgo(ageDays),
    updated: daysAgo(Math.round(r() * 40)),
    ageDays,

    iap: r() > 0.3,
    advertised: r() > 0.4,
    adNetworks: entry.nets || [],
    country: ["US", "GB", "PK", "IN", "DE"][Math.floor(r() * 5)],
    seller: entry.dev + " LLC",

    url: "#",
    urlSpy: "#",
    isSeed: !!isSeed,
  };
}

export default async function scout({ game, platform, min, max }) {
  const seed = build({ title: game || "Your Game", dev: "You", cat: "Puzzle", hue: 268, nets: ["Admob"] }, platform, true);
  const count = Math.min(max, Math.max(min, 10));
  const competitors = GAMES.slice(0, count)
    .map((g) => build(g, platform, false))
    .sort((a, b) => b.downloadsMonth - a.downloadsMonth); // more downloads first
  return { seed, competitors };
}

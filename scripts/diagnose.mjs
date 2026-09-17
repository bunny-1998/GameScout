// Throwaway diagnostic: run the real search path from a host that can
// actually reach Google, and print how many results each source returns.
// Triggered by hand from the Actions tab.

import gplay from "google-play-scraper";
import scout from "../adapters/free.js";

const game = process.env.DIAG_GAME || "ball connect";
const COUNTRY = "us", LANG = "en", THROTTLE = 6;

const count = async (label, p) => {
  try {
    const r = await p;
    console.log(`${label.padEnd(34)} ${Array.isArray(r) ? r.length : "?"}` +
      (Array.isArray(r) && r[0] ? `   e.g. "${r[0].title || r[0].appId}"` : ""));
    return Array.isArray(r) ? r : [];
  } catch (err) {
    console.log(`${label.padEnd(34)} FAILED - ${err.message}`);
    return [];
  }
};

console.log(`=== raw sources for "${game}" ===`);
const hits = await count("search(term, 5)  [seed]", gplay.search({ term: game, num: 5, country: COUNTRY, lang: LANG, throttle: THROTTLE }));
await count("search(term, 100)", gplay.search({ term: game, num: 100, country: COUNTRY, lang: LANG, throttle: THROTTLE }));

for (const w of game.split(/\s+/).filter(Boolean).slice(0, 3)) {
  await count(`search("${w}", 100)`, gplay.search({ term: w, num: 100, country: COUNTRY, lang: LANG, throttle: THROTTLE }));
}

if (hits[0]) {
  await count("similar(seed)", gplay.similar({ appId: hits[0].appId, country: COUNTRY, lang: LANG, throttle: THROTTLE }));
  const full = await gplay.app({ appId: hits[0].appId, country: COUNTRY, lang: LANG, throttle: THROTTLE });
  console.log(`seed genreId                       ${full.genreId}`);
  await count("list(seed category, 200)", gplay.list({
    category: full.genreId, collection: gplay.collection.TOP_FREE,
    num: 200, country: COUNTRY, lang: LANG, throttle: THROTTLE,
  }));
}

console.log(`\n=== what the adapter actually returns (max 200) ===`);
try {
  const r = await scout({ game, platform: "android", min: 200, max: 200 });
  console.log(`seed          ${r.seed.title}`);
  console.log(`gamesOnly     ${r.gamesOnly}`);
  console.log(`competitors   ${r.competitors.length}`);
  console.log(`pending       ${(r.pending || []).length}`);
  console.log(`first few     ${r.competitors.slice(0, 5).map((c) => c.title).join(" | ")}`);
} catch (err) {
  console.log(`scout FAILED - ${err.stack}`);
}

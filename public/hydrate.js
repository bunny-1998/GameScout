// ---------- progressive loading ----------
//
// /api/scout returns only games it has already VERIFIED - it read each one's
// full store record and checked the category. Everything else it found comes
// back as a list of bare app ids in `pending`, because a Play search result
// carries no category at all and might be a wallpaper or a keyboard.
//
// So this file does the checking. It walks `pending` a batch at a time and
// appends the ones that turn out to be games. The grid only grows; an app is
// never painted and then snatched away.
//
// Loaded after app.js, so it shares its globals.

let hydrateRun = 0;

async function hydrate() {
  if (!current || current.source !== "free") return;
  const run = ++hydrateRun;

  // older records that arrived without full stats (kept for safety)
  const thin = current.competitors.filter((a) => !a.full && a.appId).map((a) => a.appId);
  const queue = [...thin, ...(current.pending || [])];
  if (!queue.length) return setLoadingNote(0);

  const BATCH = 6;   // apps per request
  const LANES = 2;   // requests in flight - keeps us under the store's rate limit
  const target = current.max || queue.length;

  const batches = [];
  for (let i = 0; i < queue.length; i += BATCH) batches.push(queue.slice(i, i + BATCH));

  let left = queue.length;
  setLoadingNote(left);

  const lanes = Array.from({ length: LANES }, async () => {
    while (batches.length && run === hydrateRun) {
      if (current.competitors.length >= target) break;   // enough games found
      const batch = batches.shift();
      try {
        const res = await fetch("/api/details", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ platform, ids: batch }),
        });
        const data = await res.json();
        if (run !== hydrateRun) return;
        (data.apps || []).forEach(absorb);
      } catch { /* a failed batch just means those ids stay unknown */ }
      left -= batch.length;
      setLoadingNote(Math.max(left, 0));
    }
  });

  await Promise.all(lanes);
  if (run !== hydrateRun) return;
  setLoadingNote(0);
  render();  // one final pass so the chosen sort reflects every card
}

// A record came back. It is either an update to a card we already show, or a
// candidate we have just learned the category of.
function absorb(d) {
  if (!d || !d.appId || !current) return;

  // an ordinary app that matched the search words - drop it silently
  if (current.gamesOnly && d.categoryType === "APP") return;

  const i = current.competitors.findIndex((x) => x.appId === d.appId);
  if (i < 0) {
    if (current.competitors.length >= (current.max || Infinity)) return;
    applyEstimate(d);
    applyVelocity(d);
    current.competitors.push(d);
    addCard(d);
    return;
  }

  const a = current.competitors[i];
  const keptRank = a.rank;
  Object.assign(a, d);
  applyEstimate(a);
  applyVelocity(a);
  if (d.rank == null && keptRank != null) a.rank = keptRank;  // don't lose a rank we had
  patchCard(a);
}

// AppstoreSpy's figures were merged in at search time; a fresh free-mode
// record carries empty ones, so put them back.
function applyEstimate(a) {
  const est = current.estimates && (current.estimates[a.bundle] || current.estimates[a.appId]);
  if (est) Object.assign(a, est);
}

function patchCard(a) {
  const el = gridEl.querySelector(`[data-app-id="${cssEsc(a.appId)}"]`);
  if (!el) return addCard(a);
  const fresh = buildCard(a);
  if (fresh) el.replaceWith(fresh);
}

function addCard(a) {
  const fresh = buildCard(a);
  if (fresh) gridEl.appendChild(fresh);
}

function buildCard(a) {
  const holder = document.createElement("div");
  holder.innerHTML = card(a);
  const el = holder.firstElementChild;
  if (!el) return null;

  el.tabIndex = 0;
  el.addEventListener("click", () => openDrawer(a));
  el.addEventListener("keydown", (e) => { if (e.key === "Enter") openDrawer(a); });
  const ab = el.querySelector(".asset-btn");
  if (ab) ab.addEventListener("click", (e) => { e.stopPropagation(); downloadAssets(a, ab); });
  return el;
}

function cssEsc(s) {
  const v = String(s ?? "");
  return (window.CSS && CSS.escape) ? CSS.escape(v) : v.replace(/["\\]/g, "\\$&");
}

function setLoadingNote(remaining) {
  const el = document.querySelector("#result-count");
  if (!el || !current) return;
  const n = current.competitors.length;
  const base = `${n} game${n === 1 ? "" : "s"} · ${platform === "ios" ? "App Store" : "Google Play"}`;
  el.textContent = remaining > 0 ? `${base} · checking ${remaining} more…` : base;
}

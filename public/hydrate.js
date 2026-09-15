// ---------- progressive stat loading ----------
//
// /api/scout returns the full competitor list fast, but only the first dozen
// games arrive with installs, screenshots and category rank - opening every
// app's store page server-side would blow the 10s serverless limit.
//
// So the rest are pulled here, a batch at a time, and each card is patched in
// place as its numbers land. Loaded after app.js, so it shares its globals.

let hydrateRun = 0;

async function hydrate() {
  if (!current || current.source !== "free") return;
  const run = ++hydrateRun;

  const pending = current.competitors.filter((a) => !a.full && a.appId);
  if (!pending.length) return;

  const BATCH = 6;   // apps per request
  const LANES = 2;   // requests in flight - keeps us under the store's rate limit
  const queue = [];
  for (let i = 0; i < pending.length; i += BATCH) queue.push(pending.slice(i, i + BATCH));

  let left = pending.length;
  setLoadingNote(left);

  const lanes = Array.from({ length: LANES }, async () => {
    while (queue.length && run === hydrateRun) {
      const batch = queue.shift();
      try {
        const res = await fetch("/api/details", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ platform, ids: batch.map((a) => a.appId) }),
        });
        const data = await res.json();
        if (run !== hydrateRun) return;
        (data.apps || []).forEach(mergeApp);
      } catch { /* leave those cards showing what they already have */ }
      left -= batch.length;
      setLoadingNote(Math.max(left, 0));
    }
  });

  await Promise.all(lanes);
  if (run !== hydrateRun) return;
  render();  // one final pass so the chosen sort reflects the new numbers
}

function mergeApp(d) {
  if (!d || !d.appId || !current) return;
  const a = current.competitors.find((x) => x.appId === d.appId);
  if (!a) return;
  const keptRank = a.rank;
  Object.assign(a, d);
  if (d.rank == null && keptRank != null) a.rank = keptRank;  // don't lose a rank we had
  patchCard(a);
}

function patchCard(a) {
  const el = gridEl.querySelector(`[data-app-id="${cssEsc(a.appId)}"]`);
  if (!el) return;
  const holder = document.createElement("div");
  holder.innerHTML = card(a);
  const fresh = holder.firstElementChild;
  if (!fresh) return;
  el.replaceWith(fresh);

  fresh.tabIndex = 0;
  fresh.addEventListener("click", () => openDrawer(a));
  fresh.addEventListener("keydown", (e) => { if (e.key === "Enter") openDrawer(a); });
  const ab = fresh.querySelector(".asset-btn");
  if (ab) ab.addEventListener("click", (e) => { e.stopPropagation(); downloadAssets(a, ab); });
}

function cssEsc(s) {
  const v = String(s ?? "");
  return (window.CSS && CSS.escape) ? CSS.escape(v) : v.replace(/["\\]/g, "\\$&");
}

function setLoadingNote(remaining) {
  const el = document.querySelector("#result-count");
  if (!el || !current) return;
  const base = `${current.competitors.length} competitors · ${platform === "ios" ? "App Store" : "Google Play"}`;
  el.textContent = remaining > 0 ? `${base} · loading stats for ${remaining}…` : base;
}

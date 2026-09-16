// ---------- state ----------
let platform = "ios";
let current = null; // last result { seed, competitors }

const $ = (s) => document.querySelector(s);
const form = $("#scout-form");
const gridEl = $("#grid");
const seedEl = $("#seed");
const toolbarEl = $("#toolbar");
const emptyEl = $("#empty");
const errorEl = $("#error");
const btn = $("#scout-btn");

// default platform reflects the active segment in the markup (iOS)
document.querySelectorAll(".seg__btn").forEach((b) => {
  b.addEventListener("click", () => {
    document.querySelectorAll(".seg__btn").forEach((x) => x.classList.remove("is-active"));
    b.classList.add("is-active");
    platform = b.dataset.platform;
  });
});

const countInput = $("#count");
const countOut = $("#count-out");
countInput.addEventListener("input", () => (countOut.textContent = countInput.value));

$("#sort").addEventListener("change", () => render());

form.addEventListener("submit", (e) => { e.preventDefault(); scout(); });

document.addEventListener("click", (e) => {
  if (e.target.matches("[data-close]")) { $("#drawer").hidden = true; $("#lightbox").hidden = true; }
});
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") { $("#drawer").hidden = true; $("#lightbox").hidden = true; }
});

// ---------- fetch ----------
async function scout() {
  const game = $("#game").value.trim();
  if (!game) return;
  const n = countInput.value;

  emptyEl.hidden = true;
  errorEl.hidden = true;
  btn.disabled = true;
  btn.textContent = "Scouting…";
  // The first response only carries the games already verified; the rest
  // arrive as they clear, so don't promise a full screen of placeholders.
  showSkeletons(Math.min(+n, 12));

  try {
    const res = await fetch(`/api/scout?game=${encodeURIComponent(game)}&platform=${platform}&min=${n}&max=${n}`);
    const data = await res.json();
    if (!res.ok) throw new Error((data.error || "Request failed") + (data.detail ? " — " + data.detail : ""));
    current = data;
    await loadVelocities();
    applyVelocity(current.seed);
    (current.competitors || []).forEach(applyVelocity);
    render();
    hydrate();
  } catch (err) {
    gridEl.innerHTML = "";
    seedEl.hidden = true;
    toolbarEl.hidden = true;
    errorEl.hidden = false;
    errorEl.textContent = err.message;
  } finally {
    btn.disabled = false;
    btn.textContent = "Scout";
  }
}

// ---------- render ----------
function render() {
  if (!current) return;
  const { seed, competitors } = current;

  seedEl.hidden = false;
  seedEl.innerHTML = `
    ${imgOrArt(seed, "seed__icon", 76)}
    <div class="seed__meta">
      <div class="seed__eyebrow">Your game</div>
      <div class="seed__title">${esc(seed.title)}</div>
      <div class="seed__dev">${esc(seed.developer || "")}</div>
    </div>
    <div class="seed__stats">
      ${stat(fmtRating(seed.rating), "Rating")}
      ${stat(fmtNum(seed.downloadsMonth), "Downloads / mo")}
      ${stat(fmtMoney(seed.revenueMonth), "Revenue / mo")}
      ${stat(seed.category || "—", "Category")}
    </div>`;

  const key = $("#sort").value;
  const val = (x) => {
    if (key === "rank") return x.rank ?? Infinity;
    if (key === "installsNum") return x.installsNum ?? x.downloadsMonth ?? -1;
    return x[key] ?? -1;
  };
  const list = [...competitors].sort((a, b) =>
    key === "rank" ? val(a) - val(b) : val(b) - val(a)
  );

  toolbarEl.hidden = false;
  $("#result-count").textContent =
    `${list.length} game${list.length === 1 ? "" : "s"} · ${platform === "ios" ? "App Store" : "Google Play"}`;

  gridEl.innerHTML = list.map(card).join("");
  gridEl.querySelectorAll(".card").forEach((el, i) => {
    el.addEventListener("click", () => openDrawer(list[i]));
    el.tabIndex = 0;
    el.addEventListener("keydown", (e) => { if (e.key === "Enter") openDrawer(list[i]); });
    const ab = el.querySelector(".asset-btn");
    if (ab) ab.addEventListener("click", (e) => { e.stopPropagation(); downloadAssets(list[i], ab); });
  });
}

function card(a) {
  const shots = artShots(a, 3);
  const pills = [
    a.category && `<span class="pill">${esc(a.category)}</span>`,
    a.size && `<span class="pill pill--ghost">${esc(a.size)}</span>`,
    a.iap && `<span class="pill pill--soft">${esc(a.iapRange || "IAP")}</span>`,
    a.advertised && `<span class="pill pill--soft">Ads</span>`,
    a.country && `<span class="pill pill--ghost">${esc(a.country)}</span>`,
  ].filter(Boolean).join("");

  const metricsHtml = pickMetrics(a).map((m) => metric(m[0], m[1])).join("");
  const hasAssets = a.icon || (a.screenshots && a.screenshots.length);

  return `
    <article class="card" data-app-id="${esc(a.appId)}">
      <div class="card__head">
        ${imgOrArt(a, "card__icon", 56)}
        <div class="card__headmeta">
          <div class="card__title">${esc(a.title)}</div>
          <div class="card__dev">${esc(a.developer || "")}</div>
        </div>
        ${a.rank ? `<span class="rank-badge">#${a.rank}</span>` : ""}
      </div>

      <div class="rating">
        <span class="stars" style="--p:${(a.rating || 0) / 5 * 100}%"></span>
        <span class="rating__num">${fmtRating(a.rating)}</span>
        <span class="rating__count">(${fmtNum(a.ratingsCount)})</span>
      </div>

      <div class="metrics">${metricsHtml}</div>

      ${pills ? `<div class="pills">${pills}</div>` : ""}

      <div class="shots">
        ${shots.slice(0, 3).map((s) => shotThumb(a, s)).join("")}
        <span class="shots__more">SS</span>
      </div>

      ${hasAssets ? `<button class="asset-btn" type="button">⤓ Download icon + screenshots</button>` : ""}
    </article>`;
}

// Every figure the stores publish, on every card - two columns, up to eight
// rows. A card shows each stat that has a value, so in free mode the grid
// fills with installs, dates, rating and reviews where a paid source would
// also carry downloads and revenue.
function pickMetrics(a) {
  const defs = [
    ["Installs", a.installsNum != null ? fmtNum(a.installsNum) : a.installsLabel],
    ["Dwnld / day", dwnld(a.measuredDaily, a.downloadsDaily)],
    ["Released", fmtAge(a.ageDays)],
    ["Updated", fmtAge(daysSinceISO(a.updated))],
    ["Revenue / mo", a.revenueMonth != null ? fmtMoney(a.revenueMonth) : null],
    ["Dwnld / mo", dwnld(a.measuredMonth, a.downloadsMonth)],
    ["Rating", a.rating != null ? fmtRating(a.rating) : null],
    ["Reviews", a.reviewCount != null ? fmtNum(a.reviewCount) : null],
  ];
  const shown = defs.filter((d) => d[1] != null && d[1] !== "" && d[1] !== "—").slice(0, 8);
  return shown.length ? shown : [["Installs", "—"], ["Rating", "—"]];
}

// A measured number always wins over a modelled one.
function dwnld(measured, modelled) {
  if (measured != null) return fmtNum(measured);
  return modelled != null ? fmtNum(modelled) : null;
}

// ---------- measured download velocity ----------
//
// public/installs.json is written once a day by the track-installs workflow:
// the gap between two days of Google's own cumulative install count. That is
// a real download rate, not an estimate, so it takes precedence on the card.
// Fetched once per session; an empty or missing file just means the tracker
// hasn't collected two days yet.
let velocities = null;

async function loadVelocities() {
  if (velocities) return velocities;
  try {
    const res = await fetch("installs.json", { cache: "no-cache" });
    velocities = res.ok ? await res.json() : {};
  } catch {
    velocities = {};
  }
  return velocities;
}

function applyVelocity(a) {
  if (!a || !velocities) return;
  const v = velocities[a.bundle] || velocities[a.appId];
  if (!v) return;
  a.measuredDaily = v.perDay;
  a.measuredMonth = v.perMonth;
  a.measuredDays = v.days;
}

// Compact ages, the way a store listing reads them: 6y, 8mo, 12d.
function fmtAge(days) {
  if (days == null) return null;
  if (days >= 365) return Math.floor(days / 365) + "y";
  if (days >= 30) return Math.floor(days / 30) + "mo";
  return days + "d";
}

function daysSinceISO(iso) {
  const t = Date.parse(iso || "");
  return isNaN(t) ? null : Math.max(0, Math.round((Date.now() - t) / 86400000));
}

function openDrawer(a) {
  const shots = artShots(a, 8);
  const installs = a.installsLabel || (a.installsNum != null ? fmtNum(a.installsNum) + "+" : "—");
  const panel = document.querySelector(".drawer__panel");
  panel.innerHTML = `
    <button class="dw-close" data-close aria-label="Close">✕</button>
    <div class="dw-head">
      ${imgOrArt(a, "", 74)}
      <div>
        <div class="dw-title">${esc(a.title)}</div>
        <div class="dw-dev">${esc(a.developer || "")}${a.category ? " · " + esc(a.category) : ""}</div>
      </div>
    </div>

    <div class="rating">
      <span class="stars" style="--p:${(a.rating || 0) / 5 * 100}%"></span>
      <span class="rating__num">${fmtRating(a.rating)}</span>
      <span class="rating__count">(${fmtNum(a.ratingsCount)} ratings · ${fmtNum(a.reviewCount)} reviews)</span>
    </div>

    <div class="dw-stats">${drawerStats(a)}</div>
    ${a.measuredDaily != null
      ? `<p class="dw-text" style="opacity:.55">Downloads measured from ${a.measuredDays} day${a.measuredDays === 1 ? "" : "s"} of this game's own install count — not an estimate.</p>`
      : a.downloadsMonth == null && current && current.source === "free"
      ? `<p class="dw-text" style="opacity:.55">The stores publish total installs but never the rate. Downloads appear here once the tracker has two days of counts for this game; revenue needs an AppstoreSpy subscription.</p>`
      : ""}

    <div class="dw-facts">
      ${fact("Package", a.bundle || a.appId)}
      ${fact("Developer", a.developer)}
      ${a.seller ? fact("Seller", a.seller) : ""}
      ${a.version ? fact("Version", a.version) : ""}
      ${a.size ? fact("Size", a.size) : ""}
      ${a.downloadsLifetime != null ? fact("Downloads (lifetime)", fmtNum(a.downloadsLifetime)) : ""}
      ${a.revenueLifetime != null ? fact("Revenue (lifetime)", fmtMoney(a.revenueLifetime)) : ""}
      ${a.adNetworks && a.adNetworks.length ? fact("Ad networks", a.adNetworks.join(", ")) : ""}
      ${fact("In-app purchases", a.iap ? "Yes" : "No")}
      ${fact("Released", a.released || "—")}
      ${fact("Updated", a.updated || "—")}
    </div>

    ${a.description ? `<h3 class="dw-shots-h">Description</h3><p class="dw-text">${esc(a.description)}${a.description.length >= 600 ? "…" : ""}</p>` : ""}
    ${a.whatsnew ? `<h3 class="dw-shots-h">What's new</h3><p class="dw-text">${esc(a.whatsnew)}${a.whatsnew.length >= 400 ? "…" : ""}</p>` : ""}

    <h3 class="dw-shots-h">Screenshots</h3>
    <div class="dw-shots">
      ${shots.map((s) => a.screenshots && a.screenshots.length
        ? `<img ${imgAttrs(s, "shot")} alt="${esc(a.title)} screenshot" />`
        : `<span class="shot" style="background:${s}"></span>`).join("")}
    </div>

    <div class="dw-links">
      <button class="asset-btn asset-btn--drawer" type="button" id="dw-assets">⤓ Download icon + screenshots</button>
      ${a.url && a.url !== "#" ? `<a class="dw-link" href="${a.url}" target="_blank" rel="noopener">Open store listing</a>` : ""}
      ${a.urlSpy && a.urlSpy !== "#" ? `<a class="dw-link" href="${a.urlSpy}" target="_blank" rel="noopener">View on AppstoreSpy</a>` : ""}
    </div>`;

  const dwAssets = panel.querySelector("#dw-assets");
  if (dwAssets) dwAssets.addEventListener("click", () => downloadAssets(a, dwAssets));

  panel.querySelectorAll(".dw-shots img").forEach((img) => {
    img.addEventListener("click", () => { $("#lightbox-img").src = img.src; $("#lightbox").hidden = false; });
  });

  $("#drawer").hidden = false;
}

// Show the six stats this app actually has, rather than a wall of dashes.
// In free mode downloads/revenue are always absent, so their slots go to
// ratings, reviews and update dates instead.
function drawerStats(a) {
  const installs = a.installsLabel || (a.installsNum != null ? fmtNum(a.installsNum) : null);
  const defs = [
    ["Total installs", installs, !!installs],
    ["Downloads / mo", fmtNum(a.downloadsMonth), a.downloadsMonth != null],
    ["Downloads / day", fmtNum(a.downloadsDaily), a.downloadsDaily != null],
    ["Revenue / mo", fmtMoney(a.revenueMonth), a.revenueMonth != null],
    ["Category rank", "#" + a.rank, !!a.rank],
    ["Rating", fmtRating(a.rating), a.rating != null],
    ["Ratings", fmtNum(a.ratingsCount), a.ratingsCount != null],
    ["Reviews", fmtNum(a.reviewCount), a.reviewCount != null],
    ["Age", a.ageDays != null ? a.ageDays + " days" : null, a.ageDays != null],
    ["Updated", a.updated, !!a.updated],
  ];
  const shown = defs.filter((d) => d[2]).slice(0, 6);
  return shown.map((d) => dwStat(d[0], d[1])).join("");
}

// ---------- assets download ----------
async function downloadAssets(a, btn) {
  const label = btn ? btn.textContent : "";
  if (btn) { btn.disabled = true; btn.textContent = "Preparing…"; }
  try {
    const res = await fetch("/api/assets", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ title: a.title, icon: a.icon, screenshots: a.screenshots || [] }),
    });
    if (!res.ok) {
      const d = await res.json().catch(() => ({}));
      throw new Error(d.error || "Download failed");
    }
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = (a.title || "assets").replace(/[^a-z0-9\-_ ]+/gi, "_").trim() + ".zip";
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
    if (btn) btn.textContent = "Downloaded ✓";
  } catch (err) {
    if (btn) btn.textContent = "Failed — retry";
    console.error(err);
  } finally {
    if (btn) setTimeout(() => { btn.disabled = false; btn.textContent = label; }, 1800);
  }
}

// ---------- helpers ----------
function stat(v, label) { return `<div class="seed__stat"><b>${v}</b><span>${label}</span></div>`; }
function metric(label, v) { return `<div class="metric"><span>${label}</span><b>${v}</b></div>`; }
function dwStat(label, v) { return `<div class="dw-stat"><span>${label}</span><b>${v}</b></div>`; }
function fact(label, v) { return `<div class="fact"><span>${esc(label)}</span><b>${esc(v || "—")}</b></div>`; }

// Store CDNs serve these images to anyone, so the browser loads them straight
// from Google and Apple. Routing them through /img instead costs one
// serverless call per icon and per screenshot - on a 200-game search that is
// hundreds of calls, which is what drained the last host's monthly credits.
// Any host that does refuse us falls back to the proxy, in the listener below.
function imgAttrs(u, kind) {
  if (!u || !/^https?:\/\//i.test(u)) return `src="${esc(u || "")}"`;
  return `src="${esc(hiRes(u, kind))}" data-src="${esc(u)}" data-kind="${kind}"`;
}

// Ask the CDN for a bigger rendition - same rules the server used.
//   kind "icon" -> 512x512     kind "shot" -> 1080 wide
function hiRes(u, kind) {
  if (/googleusercontent\.com|ggpht\.com/i.test(u)) {
    return u.replace(/=[^/]*$/, "") + (kind === "icon" ? "=s512" : "=w1080");
  }
  if (/mzstatic\.com/i.test(u)) {
    const dim = kind === "icon" ? "512x512bb" : "1080x1920bb";
    return u
      .replace(/\/\d{2,4}x\d{2,4}[a-z]{0,2}\.(jpg|png|webp)/i, `/${dim}.$1`)
      .replace(/\/\d{2,4}x0w\.(jpg|png|webp)/i, `/${dim}.$1`);
  }
  return u;
}

// One retry per image, through the server, if the CDN turns us away.
document.addEventListener("error", (e) => {
  const img = e.target;
  if (!(img instanceof HTMLImageElement) || img.dataset.viaProxy) return;
  const orig = img.dataset.src;
  if (!orig) return;
  img.dataset.viaProxy = "1";
  img.src = "/img?u=" + encodeURIComponent(orig) + "&k=" + (img.dataset.kind || "shot");
}, true);

function shotThumb(a, s) {
  return a.screenshots && a.screenshots.length
    ? `<img class="shot" ${imgAttrs(s, "shot")} alt="${esc(a.title)} screenshot" loading="lazy" />`
    : `<span class="shot" style="background:${s}"></span>`;
}

function showSkeletons(n) {
  seedEl.hidden = true;
  toolbarEl.hidden = true;
  gridEl.innerHTML = Array.from({ length: n }).map(() =>
    `<article class="card"><div class="card__head"><span class="card__icon skel"></span>
      <div style="flex:1"><div class="skel" style="height:12px;width:70%;border-radius:6px"></div>
      <div class="skel" style="height:10px;width:40%;border-radius:6px;margin-top:8px"></div></div></div>
      <div class="skel" style="height:64px;border-radius:8px;margin-top:16px"></div></article>`).join("");
}

function hueOf(str) {
  let h = 0;
  for (let i = 0; i < (str || "").length; i++) h = (h * 31 + str.charCodeAt(i)) % 360;
  return h;
}

function imgOrArt(a, cls, size) {
  if (a.icon) return `<img class="${cls}" ${imgAttrs(a.icon, "icon")} alt="${esc(a.title)} icon" width="${size}" height="${size}" loading="lazy" />`;
  const hue = a.hue ?? hueOf(a.seed || a.title);
  const initials = (a.title || "?").split(/\s+/).slice(0, 2).map((w) => w[0]).join("").toUpperCase();
  const svg = `<svg xmlns='http://www.w3.org/2000/svg' width='${size}' height='${size}' viewBox='0 0 100 100'>
    <defs><linearGradient id='g' x1='0' y1='0' x2='1' y2='1'>
      <stop offset='0' stop-color='hsl(${hue} 70% 58%)'/>
      <stop offset='1' stop-color='hsl(${(hue + 40) % 360} 70% 42%)'/></linearGradient></defs>
    <rect width='100' height='100' rx='24' fill='url(%23g)'/>
    <text x='50' y='50' dy='.35em' text-anchor='middle' font-family='sans-serif'
      font-size='40' font-weight='700' fill='rgba(255,255,255,.92)'>${initials}</text></svg>`;
  return `<img class="${cls}" src="data:image/svg+xml,${encodeURIComponent(svg)}" alt="${esc(a.title)} icon" width="${size}" height="${size}" />`;
}

function artShots(a, n) {
  if (a.screenshots && a.screenshots.length) return a.screenshots.slice(0, n);
  const hue = a.hue ?? hueOf(a.seed || a.title);
  return Array.from({ length: n }).map((_, i) =>
    `linear-gradient(160deg, hsl(${(hue + i * 22) % 360} 55% 30%), hsl(${(hue + i * 22 + 30) % 360} 60% 18%))`);
}

function fmtNum(n) {
  if (n == null) return "—";
  if (n >= 1e9) return (n / 1e9).toFixed(1).replace(/\.0$/, "") + "B";
  if (n >= 1e6) return (n / 1e6).toFixed(1).replace(/\.0$/, "") + "M";
  if (n >= 1e3) return (n / 1e3).toFixed(1).replace(/\.0$/, "") + "K";
  return String(n);
}
function fmtMoney(n) { return n == null ? "—" : "$" + fmtNum(n); }
function fmtRating(r) { return r == null ? "—" : Number(r).toFixed(1); }
function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

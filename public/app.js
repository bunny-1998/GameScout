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
  showSkeletons(+n);

  try {
    const res = await fetch(`/api/scout?game=${encodeURIComponent(game)}&platform=${platform}&min=${n}&max=${n}`);
    const data = await res.json();
    if (!res.ok) throw new Error((data.error || "Request failed") + (data.detail ? " — " + data.detail : ""));
    current = data;
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
  $("#result-count").textContent = `${list.length} competitors · ${platform === "ios" ? "App Store" : "Google Play"}`;

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
    a.iap && `<span class="pill pill--soft">IAP</span>`,
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

// choose up to 4 metrics that actually have data, so nothing shows as "—"
function pickMetrics(a) {
  const installs = a.installsLabel || (a.installsNum != null ? fmtNum(a.installsNum) + "+" : null);
  const defs = [
    ["Downloads / mo", fmtNum(a.downloadsMonth), a.downloadsMonth != null],
    ["Revenue / mo", fmtMoney(a.revenueMonth), a.revenueMonth != null],
    ["Installs", installs, !!installs],
    ["Downloads / day", fmtNum(a.downloadsDaily), a.downloadsDaily != null],
    ["Reviews", fmtNum(a.reviewCount), a.reviewCount != null],
    ["Released", a.released, !!a.released],
    ["Rank", a.rank ? "#" + a.rank : null, !!a.rank],
  ];
  const shown = defs.filter((d) => d[2]).slice(0, 4);
  return shown.length ? shown : [["Downloads / mo", "—"], ["Revenue / mo", "—"]];
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

    <div class="dw-stats">
      ${dwStat("Total installs", installs)}
      ${dwStat("Downloads / mo", fmtNum(a.downloadsMonth))}
      ${dwStat("Downloads / day", fmtNum(a.downloadsDaily))}
      ${dwStat("Revenue / mo", fmtMoney(a.revenueMonth))}
      ${dwStat("Category rank", a.rank ? "#" + a.rank : "—")}
      ${dwStat("Age", a.ageDays != null ? a.ageDays + " days" : "—")}
    </div>

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
        ? `<img src="${proxied(s, "shot")}" alt="${esc(a.title)} screenshot" />`
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

// route real store image URLs through our server so they always load, at the
// right resolution (icon 512, screenshots 1080)
function proxied(u, kind) {
  return u && /^https?:\/\//i.test(u)
    ? "/img?u=" + encodeURIComponent(u) + (kind ? "&k=" + kind : "")
    : u;
}

function shotThumb(a, s) {
  return a.screenshots && a.screenshots.length
    ? `<img class="shot" src="${proxied(s, "shot")}" alt="${esc(a.title)} screenshot" loading="lazy" />`
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
  if (a.icon) return `<img class="${cls}" src="${proxied(a.icon, "icon")}" alt="${esc(a.title)} icon" width="${size}" height="${size}" loading="lazy" />`;
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

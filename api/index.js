import express from "express";
import dotenv from "dotenv";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import { makeZip } from "../lib/zip.js";

dotenv.config();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = process.env.PORT || 3000;
const SOURCE = (process.env.DATA_SOURCE || "mock").toLowerCase();

// ---- Login gate (only active when credentials are set) ----
// Set AUTH_USER + AUTH_PASS (one shared team login), and/or AUTH_USERS as
// "alice:pw1,bob:pw2". With none set, the app runs open (handy locally).
const AUTH = (() => {
  const map = {};
  if (process.env.AUTH_USER && process.env.AUTH_PASS) map[process.env.AUTH_USER] = process.env.AUTH_PASS;
  (process.env.AUTH_USERS || "").split(",").forEach((pair) => {
    const i = pair.indexOf(":");
    if (i > 0) map[pair.slice(0, i).trim()] = pair.slice(i + 1).trim();
  });
  return map;
})();
const AUTH_ON = Object.keys(AUTH).length > 0;

function safeEqual(a, b) {
  const ab = Buffer.from(String(a));
  const bb = Buffer.from(String(b));
  return ab.length === bb.length && crypto.timingSafeEqual(ab, bb);
}

app.use((req, res, next) => {
  if (!AUTH_ON) return next();
  const [scheme, val] = (req.headers.authorization || "").split(" ");
  if (scheme === "Basic" && val) {
    const [u, p] = Buffer.from(val, "base64").toString().split(":");
    if (AUTH[u] !== undefined && safeEqual(AUTH[u], p)) return next();
  }
  res.setHeader("WWW-Authenticate", 'Basic realm="Game Scout", charset="UTF-8"');
  return res.status(401).send("Authentication required.");
});

app.use(express.json({ limit: "1mb" }));

// Serve the dashboard (the browser only ever talks to THIS server, never to
// the data provider directly — so your API key never leaves the machine).
app.use(express.static(path.join(__dirname, "..", "public")));

// Pick the data source. Each adapter exposes the same scout() function so the
// rest of the app doesn't care which provider is behind it.
async function loadSource() {
  if (SOURCE === "appstorespy") return (await import("../adapters/appstorespy.js")).default;
  if (SOURCE === "appbird") return (await import("../adapters/appbird.js")).default;
  return (await import("../mock/data.js")).default; // default: mock
}

// GET /api/scout?game=Merge%20Kingdom&platform=ios&min=8&max=12
app.get("/api/scout", async (req, res) => {
  const game = (req.query.game || "").toString().trim();
  const platform = (req.query.platform || "ios").toString().toLowerCase();
  const min = clamp(parseInt(req.query.min, 10) || 8, 1, 200);
  const max = clamp(parseInt(req.query.max, 10) || 12, min, 200);

  if (!game) {
    return res.status(400).json({ error: "Type a game name to scout its competitors." });
  }

  try {
    const source = await loadSource();
    const result = await source({ game, platform, min, max });
    res.json({ source: SOURCE, ...result });
  } catch (err) {
    console.error("[scout] failed:", err);
    res.status(502).json({
      error: "Couldn't reach the data source. Check your API key and DATA_SOURCE in .env.",
      detail: String(err?.message || err),
    });
  }
});

function clamp(n, lo, hi) {
  return Math.max(lo, Math.min(hi, n));
}

// POST /api/assets  { title, icon, screenshots: [] }
// Downloads the icon + screenshots server-side and returns them as one ZIP.
app.post("/api/assets", async (req, res) => {
  const { title, icon, screenshots } = req.body || {};
  const safe = (title || "assets").replace(/[^a-z0-9\-_ ]+/gi, "_").trim().slice(0, 60) || "assets";

  const jobs = [];
  if (icon) jobs.push({ url: icon, name: `${safe}-icon${extOf(icon)}`, kind: "icon" });
  (Array.isArray(screenshots) ? screenshots : []).forEach((u, i) => {
    jobs.push({ url: u, name: `${safe}-screenshot-${String(i + 1).padStart(2, "0")}${extOf(u)}`, kind: "shot" });
  });

  if (!jobs.length) return res.status(400).json({ error: "No image URLs to download." });

  const files = [];
  await Promise.all(jobs.map(async (j) => {
    try {
      const r = await fetch(hiRes(j.url, j.kind));
      if (r.ok) files.push({ name: j.name, data: Buffer.from(await r.arrayBuffer()) });
    } catch { /* skip images that fail */ }
  }));

  if (!files.length) return res.status(502).json({ error: "Couldn't download any images." });

  const zip = makeZip(files);
  res.setHeader("Content-Type", "application/zip");
  res.setHeader("Content-Disposition", `attachment; filename="${safe}.zip"`);
  res.send(zip);
});

function extOf(u) {
  const m = /\.(png|jpe?g|webp|gif)(?:$|\?)/i.exec(u || "");
  return m ? "." + m[1].toLowerCase().replace("jpeg", "jpg") : ".jpg";
}

// Ask the CDN for a high-resolution version.
//   kind "icon" -> 512x512     kind "shot" -> 1080 wide (native ratio)
function hiRes(u, kind = "shot") {
  if (!u) return u;
  if (/googleusercontent\.com|ggpht\.com/i.test(u)) {
    const size = kind === "icon" ? "=s512" : "=w1080";
    return u.replace(/=[^/]*$/, "") + size;
  }
  if (/mzstatic\.com/i.test(u)) {
    const dim = kind === "icon" ? "512x512bb" : "1080x1920bb";
    return u
      .replace(/\/\d{2,4}x\d{2,4}[a-z]{0,2}\.(jpg|png|webp)/i, `/${dim}.$1`)
      .replace(/\/\d{2,4}x0w\.(jpg|png|webp)/i, `/${dim}.$1`);
  }
  return u;
}

// GET /img?u=<encoded image url>&k=icon|shot
// Fetches store icons/screenshots server-side and streams them back, so the
// browser loads them same-origin (avoids hotlink/referrer blocking).
app.get("/img", async (req, res) => {
  const u = req.query.u;
  const kind = req.query.k === "icon" ? "icon" : "shot";
  if (!u || !/^https?:\/\//i.test(u)) return res.status(400).end();
  try {
    const r = await fetch(hiRes(u, kind));
    if (!r.ok) return res.status(502).end();
    res.setHeader("Content-Type", r.headers.get("content-type") || "image/jpeg");
    res.setHeader("Cache-Control", "public, max-age=86400");
    res.end(Buffer.from(await r.arrayBuffer()));
  } catch {
    res.status(502).end();
  }
}); 

export default app;

import serverless from "serverless-http";
import express from "express";
import path from "node:path";
import fs from "node:fs";
import app from "../../api/index.js";

// Netlify copies `public/**` into the function bundle - find it wherever it landed.
const candidates = [
  path.join(process.cwd(), "public"),
  "/var/task/public",
  path.join(process.cwd(), "..", "public"),
];
const publicDir = candidates.find((p) => fs.existsSync(p));
if (publicDir) app.use(express.static(publicDir));

export const handler = serverless(app);

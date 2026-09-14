import serverless from "serverless-http";
import express from "express";
import path from "node:path";
import app from "../../api/index.js";

// Netlify copies `public/**` alongside the bundled function.
app.use(express.static(path.join(process.cwd(), "public")));

export const handler = serverless(app);

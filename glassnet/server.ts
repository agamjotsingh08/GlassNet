// GlassNet's local modular-monolith entry point. Run it with npm start.
import "dotenv/config";
import express from "express";
import fs from "node:fs";
import { config } from "./src/config.js";
import { findReport, listReports, saveReport } from "./src/repository.js";
import { scanPublicWebsite } from "./src/scanner.js";
import { safePublicUrl } from "./src/url-safety.js";

const app = express();
app.disable("x-powered-by");
app.use(express.json({ limit: "16kb" }));
app.use(express.static(config.staticFolder));

// The landing page is public. Future private report routes must enforce access.
app.get("/", (_request, response) => response.type("html").send(fs.readFileSync(config.pageFile, "utf8")));
app.get("/api/health", (_request, response) => response.json({ status: "ok", scanner_version: config.scannerVersion }));

app.post("/api/scans", async (request, response) => {
  try {
    const website = await safePublicUrl(request.body?.url);
    const report = saveReport(await scanPublicWebsite(website));
    response.status(201).json(report);
  } catch (error) {
    const message = error instanceof Error ? error.message : "The scan could not finish.";
    response.status(400).json({ error: message });
  }
});

app.get("/api/scans", (_request, response) => {
  const shortReports = listReports().map((report) => ({ id: report.id, url: report.url, site_name: report.site_name, score: report.score, created_at: report.created_at, third_parties: report.summary.third_parties, cookies: report.summary.cookies }));
  response.json(shortReports);
});
app.get("/api/scans/:id", (request, response) => {
  const report = findReport(Number(request.params.id));
  if (!report) return response.status(404).json({ error: "Scan not found." });
  response.json(report);
});
app.get("/api/compare", (request, response) => {
  const values = Array.isArray(request.query.id) ? request.query.id : [request.query.id];
  const ids = values.map(Number);
  const reports = listReports().filter((report) => ids.includes(report.id || -1));
  if (ids.length !== 2 || reports.length !== 2) return response.status(400).json({ error: "Choose exactly two scans to compare." });
  response.json(reports);
});
app.use((_request, response) => response.status(404).json({ error: "Route not found." }));
app.listen(config.port, () => console.log(`GlassNet is running at http://127.0.0.1:${config.port}`));

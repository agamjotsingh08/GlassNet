// GlassNet's local modular-monolith entry point. Run it with npm start.
import "dotenv/config";
import express from "express";
import fs from "node:fs";
import { config } from "./src/config.js";
import { addWatch, completeScan, createScan, failScan, featureFlags, findReport, jobStatus, listReports, listWatches, removeWatch, updateJob } from "./src/repository.js";
import { scanPublicWebsite } from "./src/scanner.js";
import { safePublicUrl } from "./src/url-safety.js";
import { register, signIn, signedInUser, signOut } from "./src/auth.js";

const app = express();
app.disable("x-powered-by");
app.use(express.json({ limit: "16kb" }));
app.use(express.static(config.staticFolder));

// The landing page is public. Future private report routes must enforce access.
app.get("/", (_request, response) => response.type("html").send(fs.readFileSync(config.pageFile, "utf8")));
app.get("/api/health", (_request, response) => response.json({ status: "ok", scanner_version: config.scannerVersion }));
app.get("/api/features", (_request, response) => response.json(featureFlags()));
app.post("/api/auth/register", (request, response) => {
  try { response.status(201).json({ user: register(request.body?.email, request.body?.password) }); }
  catch (error) { response.status(400).json({ error: error instanceof Error ? error.message : "Registration failed." }); }
});
app.post("/api/auth/login", (request, response) => {
  try {
    const login = signIn(request.body?.email, request.body?.password);
    response.setHeader("Set-Cookie", `glassnet_session=${login.token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=604800`);
    response.json({ user: login.user });
  } catch (error) { response.status(401).json({ error: error instanceof Error ? error.message : "Login failed." }); }
});
app.post("/api/auth/logout", (request, response) => {
  signOut(request.headers.cookie); response.setHeader("Set-Cookie", "glassnet_session=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0"); response.status(204).end();
});
app.get("/api/auth/me", (request, response) => response.json({ user: signedInUser(request.headers.cookie) || null }));
app.get("/api/watch", (request, response) => {
  const user = signedInUser(request.headers.cookie);
  if (!user) return response.status(401).json({ error: "Sign in to manage watch targets." });
  response.json(listWatches(user.id));
});
app.post("/api/watch", async (request, response) => {
  const user = signedInUser(request.headers.cookie);
  if (!user) return response.status(401).json({ error: "Sign in to manage watch targets." });
  try { response.status(201).json({ website_id: addWatch(user.id, await safePublicUrl(request.body?.url), String(request.body?.cadence || "weekly")) }); }
  catch (error) { response.status(400).json({ error: error instanceof Error ? error.message : "Watch target could not be created." }); }
});
app.delete("/api/watch/:id", (request, response) => {
  const user = signedInUser(request.headers.cookie);
  if (!user) return response.status(401).json({ error: "Sign in to manage watch targets." });
  if (!removeWatch(user.id, Number(request.params.id))) return response.status(404).json({ error: "Watch target not found." });
  response.status(204).end();
});

app.post("/api/scans", async (request, response) => {
  try {
    const website = await safePublicUrl(request.body?.url);
    const created = createScan(website, signedInUser(request.headers.cookie)?.id);
    try {
      updateJob(created.scanId, "capturing", "starting_browser");
      const report = completeScan(created.scanId, await scanPublicWebsite(website));
      response.status(201).json(report);
    } catch (scanError) {
      const message = scanError instanceof Error ? scanError.message : "The scan could not finish.";
      failScan(created.scanId, message);
      response.status(502).json({ error: message, scan_id: created.scanId });
    }
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
app.get("/api/jobs/:id", (request, response) => {
  const job = jobStatus(Number(request.params.id));
  if (!job) return response.status(404).json({ error: "Scan job not found." });
  response.json(job);
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

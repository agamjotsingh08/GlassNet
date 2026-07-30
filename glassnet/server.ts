// GlassNet's local application server.
import "dotenv/config";
import express from "express";
import fs from "node:fs";
import path from "node:path";
import { config } from "./src/config.js";
import {
  addPortfolioWebsite,
  addWatch,
  baselineForScan,
  completeScan,
  createIssue,
  createPortfolio,
  createReview,
  createScan,
  evaluateRules,
  failScan,
  featureFlags,
  findReport,
  jobStatus,
  listIssues,
  listPortfolios,
  listReports,
  listReviews,
  listRules,
  listWatches,
  removeWatch,
  saveFeedback,
  setBaseline,
  updateIssue,
  updateJob,
  updateReview,
} from "./src/repository.js";
import { scanPublicWebsite } from "./src/scanner.js";
import { safePublicUrl } from "./src/url-safety.js";
import { register, signIn, signedInUser, signOut } from "./src/auth.js";
import type { ScanMode } from "./src/types.js";

const app = express();
const liveJobs = new Map<number, { stage: string; domains: number; requests: number }>();
const pageHtml = () => fs.readFileSync(config.pageFile, "utf8");
const sendError = (response: express.Response, error: unknown, status = 400) => {
  response.status(status).json({ error: error instanceof Error ? error.message : "The request could not be completed." });
};

app.disable("x-powered-by");
app.use(express.json({ limit: "20kb" }));
app.use(express.static(config.staticFolder, { maxAge: "1h" }));

app.get("/api/health", (_request, response) => response.json({ status: "ok", scanner_version: config.scannerVersion }));
app.get("/api/features", (_request, response) => response.json(featureFlags()));
app.get("/api/sample-report", (_request, response) => {
  const file = path.join(process.cwd(), "tests", "fixtures", "demo-report.json");
  const sample = JSON.parse(fs.readFileSync(file, "utf8"));
  response.json({
    ...sample,
    mode: sample.mode || "full",
    events: sample.events || sample.services.flatMap((service: { domain: string; category: string }, index: number) => [
      { sequence: index + 1, offset_ms: 280 + (index * 420), type: "response", source: sample.target_domain, destination: service.domain, category: service.category, consent_state: "not_tested" },
    ]),
    security_headers: sample.security_headers || { "strict-transport-security": "present", "x-content-type-options": "nosniff" },
    consent: sample.consent || { status: "not_tested", pre_consent_requests: 0, note: "Sample evidence does not include an automated consent action." },
    is_sample: true,
  });
});

app.post("/api/auth/register", (request, response) => {
  try { response.status(201).json({ user: register(request.body?.email, request.body?.password) }); }
  catch (error) { sendError(response, error); }
});
app.post("/api/auth/login", (request, response) => {
  try {
    const login = signIn(request.body?.email, request.body?.password);
    response.setHeader("Set-Cookie", `glassnet_session=${login.token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=604800`);
    response.json({ user: login.user });
  } catch (error) { sendError(response, error, 401); }
});
app.post("/api/auth/logout", (request, response) => {
  signOut(request.headers.cookie);
  response.setHeader("Set-Cookie", "glassnet_session=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0");
  response.status(204).end();
});
app.get("/api/auth/me", (request, response) => response.json({ user: signedInUser(request.headers.cookie) || null }));

app.post("/api/scans", async (request, response) => {
  try {
    const website = await safePublicUrl(request.body?.url);
    const allowedModes: ScanMode[] = ["quick", "full", "consent", "developer"];
    const mode = allowedModes.includes(request.body?.mode) ? request.body.mode as ScanMode : "full";
    const created = createScan(website, signedInUser(request.headers.cookie)?.id);
    liveJobs.set(created.scanId, { stage: "queued", domains: 0, requests: 0 });
    response.status(202).json({ ...created, status: "queued", mode });

    void (async () => {
      try {
        updateJob(created.scanId, "capturing", "opening_browser");
        const report = await scanPublicWebsite(website, mode, (progress) => liveJobs.set(created.scanId, progress));
        completeScan(created.scanId, report);
        liveJobs.set(created.scanId, { stage: "completed", domains: report.services.length + report.first_party.length, requests: report.summary.requests });
      } catch (error) {
        const message = error instanceof Error ? error.message : "The scan could not finish.";
        failScan(created.scanId, message);
        liveJobs.set(created.scanId, { stage: "failed", domains: 0, requests: 0 });
      }
    })();
  } catch (error) { sendError(response, error); }
});

app.get("/api/scans", (_request, response) => {
  response.json(listReports().map((report) => ({
    id: report.id,
    url: report.url,
    site_name: report.site_name,
    target_domain: report.target_domain,
    mode: report.mode || "full",
    score: report.score,
    created_at: report.created_at,
    third_parties: report.summary.third_parties,
    requests: report.summary.requests,
    cookies: report.summary.cookies,
  })));
});
app.get("/api/scans/:id", (request, response) => {
  const report = findReport(Number(request.params.id));
  if (!report) return response.status(404).json({ error: "Scan not found." });
  response.json(report);
});
app.get("/api/jobs/:id", (request, response) => {
  const job = jobStatus(Number(request.params.id)) as Record<string, unknown> | undefined;
  if (!job) return response.status(404).json({ error: "Scan job not found." });
  const progress = liveJobs.get(Number(job.scan_id));
  response.json({ ...job, progress, report: job.status === "completed" ? findReport(Number(job.scan_id)) : undefined });
});

app.get("/api/compare", (request, response) => {
  const ids = String(request.query.id || "").split(",").map(Number).filter(Number.isFinite);
  const reports = listReports().filter((report) => ids.includes(report.id || -1));
  if (ids.length !== 2 || reports.length !== 2) return response.status(400).json({ error: "Choose exactly two scans to compare." });
  response.json(reports);
});

app.post("/api/baselines", (request, response) => {
  try { response.status(201).json({ id: setBaseline(Number(request.body?.scan_id), String(request.body?.label || "Production baseline")) }); }
  catch (error) { sendError(response, error); }
});
app.get("/api/baselines/:scanId", (request, response) => response.json({ baseline: baselineForScan(Number(request.params.scanId)) || null }));
app.get("/api/reviews", (_request, response) => response.json(listReviews()));
app.post("/api/reviews", (request, response) => {
  try { response.status(201).json(createReview(Number(request.body?.base_scan_id), Number(request.body?.candidate_scan_id))); }
  catch (error) { sendError(response, error); }
});
app.patch("/api/reviews/:id", (request, response) => {
  try { response.json(updateReview(Number(request.params.id), String(request.body?.status), String(request.body?.note || ""))); }
  catch (error) { sendError(response, error); }
});

app.get("/api/issues", (_request, response) => response.json(listIssues()));
app.post("/api/issues", (request, response) => {
  try {
    const id = createIssue({
      scanId: Number(request.body?.scan_id) || undefined,
      title: String(request.body?.title || ""),
      category: String(request.body?.category || "general"),
      severity: String(request.body?.severity || "medium"),
      evidence: String(request.body?.evidence || ""),
    });
    response.status(201).json({ id });
  } catch (error) { sendError(response, error); }
});
app.patch("/api/issues/:id", (request, response) => {
  try { response.json(updateIssue(Number(request.params.id), String(request.body?.status))); }
  catch (error) { sendError(response, error); }
});

app.get("/api/rules", (_request, response) => response.json(listRules()));
app.get("/api/ci/:scanId", (request, response) => {
  try { response.json(evaluateRules(Number(request.params.scanId))); }
  catch (error) { sendError(response, error, 404); }
});
app.get("/api/portfolios", (_request, response) => response.json(listPortfolios()));
app.post("/api/portfolios", (request, response) => {
  try { response.status(201).json({ id: createPortfolio(String(request.body?.name || ""), String(request.body?.description || "")) }); }
  catch (error) { sendError(response, error); }
});
app.post("/api/portfolios/:id/websites", (request, response) => {
  try { addPortfolioWebsite(Number(request.params.id), Number(request.body?.scan_id)); response.status(204).end(); }
  catch (error) { sendError(response, error); }
});

app.get("/api/watch", (request, response) => {
  const user = signedInUser(request.headers.cookie);
  if (!user) return response.status(401).json({ error: "Sign in to manage watch targets." });
  response.json(listWatches(user.id));
});
app.post("/api/watch", async (request, response) => {
  const user = signedInUser(request.headers.cookie);
  if (!user) return response.status(401).json({ error: "Sign in to manage watch targets." });
  try { response.status(201).json({ website_id: addWatch(user.id, await safePublicUrl(request.body?.url), String(request.body?.cadence || "weekly")) }); }
  catch (error) { sendError(response, error); }
});
app.delete("/api/watch/:id", (request, response) => {
  const user = signedInUser(request.headers.cookie);
  if (!user) return response.status(401).json({ error: "Sign in to manage watch targets." });
  if (!removeWatch(user.id, Number(request.params.id))) return response.status(404).json({ error: "Watch target not found." });
  response.status(204).end();
});

app.post("/api/feedback", (request, response) => {
  try {
    const user = signedInUser(request.headers.cookie);
    const id = saveFeedback({
      scanId: Number(request.body?.scan_id) || undefined,
      userId: user?.id,
      kind: String(request.body?.kind || ""),
      rating: request.body?.rating ? Number(request.body.rating) : undefined,
      details: request.body?.details,
    });
    response.status(201).json({ id, message: "Feedback saved locally." });
  } catch (error) { sendError(response, error); }
});

app.use("/api", (_request, response) => response.status(404).json({ error: "API route not found." }));
app.get(/.*/, (_request, response) => response.type("html").send(pageHtml()));
app.listen(config.port, () => console.log(`GlassNet is running at http://127.0.0.1:${config.port}`));

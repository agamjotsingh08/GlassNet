// GlassNet's local server. It only exposes the routes needed to scan,
// save, view, and compare public website reports.
import "dotenv/config";
import compression from "compression";
import express from "express";
import fs from "node:fs";
import path from "node:path";
import { browserPoolStats, closeBrowserPool } from "./src/browser-pool.js";
import { config } from "./src/config.js";
import {
  completeScan,
  createScan,
  failScan,
  findReport,
  jobStatus,
  listReportSummaries,
  normalizeReport,
  updateJob,
} from "./src/repository.js";
import { filterRequests } from "./src/request-explorer.js";
import { scanPublicWebsite } from "./src/scanner.js";
import type { ScanMode } from "./src/types.js";
import { safePublicUrl } from "./src/url-safety.js";

const app = express();
const pageHtml = fs.readFileSync(config.pageFile, "utf8");
const sampleFile = path.join(process.cwd(), "tests", "fixtures", "demo-report.json");
const sampleReport = JSON.parse(fs.readFileSync(sampleFile, "utf8"));

type QueuedScan = { scanId: number; website: string; mode: ScanMode };
type LiveProgress = { stage: string; domains: number; requests: number };

const scanQueue: QueuedScan[] = [];
const liveJobs = new Map<number, LiveProgress>();
const maxConcurrentScans = 2;
let activeScans = 0;

function sendError(response: express.Response, error: unknown, status = 400) {
  const message = error instanceof Error ? error.message : "The request could not be completed.";
  response.status(status).json({ error: message });
}

app.disable("x-powered-by");
app.use(compression({ threshold: 1024 }));
app.use(express.json({ limit: "20kb" }));
app.use("/api", (_request, response, next) => {
  response.setHeader("Cache-Control", "private, no-store");
  next();
});
app.use(express.static(config.staticFolder, { maxAge: "1y", immutable: true, etag: true }));

function startQueuedScans() {
  while (activeScans < maxConcurrentScans && scanQueue.length > 0) {
    const nextScan = scanQueue.shift();
    if (!nextScan) return;

    activeScans += 1;
    void runScan(nextScan).finally(() => {
      activeScans = Math.max(0, activeScans - 1);
      startQueuedScans();
    });
  }
}

async function runScan(job: QueuedScan) {
  try {
    updateJob(job.scanId, "capturing", "opening_browser");
    let lastUpdate = 0;
    let lastStage = "";

    const report = await scanPublicWebsite(job.website, job.mode, (progress) => {
      const now = Date.now();
      if (progress.stage !== lastStage || now - lastUpdate >= 350) {
        liveJobs.set(job.scanId, progress);
        lastStage = progress.stage;
        lastUpdate = now;
      }
    });

    completeScan(job.scanId, report);
    liveJobs.set(job.scanId, {
      stage: "completed",
      domains: report.services.length + report.first_party.length,
      requests: report.summary.requests,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "The scan could not finish.";
    failScan(job.scanId, message);
    liveJobs.set(job.scanId, { stage: "failed", domains: 0, requests: 0 });
  }
}

app.get("/api/health", (_request, response) => {
  response.json({ status: "ok", scanner_version: config.scannerVersion });
});

app.get("/api/sample-report", (_request, response) => {
  response.json({ ...normalizeReport(sampleReport), is_sample: true });
});

app.post("/api/scans", async (request, response) => {
  try {
    const website = await safePublicUrl(request.body?.url);
    const mode: ScanMode = request.body?.mode === "quick" ? "quick" : "full";
    const created = createScan(website);

    liveJobs.set(created.scanId, { stage: "queued", domains: 0, requests: 0 });
    scanQueue.push({ scanId: created.scanId, website, mode });
    startQueuedScans();

    response.status(202).json({
      ...created,
      status: "queued",
      mode,
      queue_position: Math.max(0, scanQueue.findIndex((item) => item.scanId === created.scanId)),
    });
  } catch (error) {
    sendError(response, error);
  }
});

app.get("/api/scans", (request, response) => {
  response.json(listReportSummaries(Number(request.query.limit) || 20, String(request.query.cursor || "")));
});

app.get("/api/scans/:id/requests", (request, response) => {
  const report = findReport(Number(request.params.id));
  if (!report) return response.status(404).json({ error: "Scan not found." });
  response.json(filterRequests(report.requests, request.query));
});

app.get("/api/scans/:id", (request, response) => {
  const report = findReport(Number(request.params.id));
  if (!report) return response.status(404).json({ error: "Scan not found." });
  const { requests: _requests, ...overview } = report;
  response.json(overview);
});

app.get("/api/jobs/:id", (request, response) => {
  const job = jobStatus(Number(request.params.id)) as Record<string, unknown> | undefined;
  if (!job) return response.status(404).json({ error: "Scan job not found." });
  response.json({ ...job, progress: liveJobs.get(Number(job.scan_id)) });
});

app.get("/api/jobs/:id/events", (request, response) => {
  const jobId = Number(request.params.id);
  response.setHeader("Content-Type", "text/event-stream");
  response.setHeader("Cache-Control", "private, no-store");
  response.setHeader("Connection", "keep-alive");
  response.flushHeaders();
  let previousPayload = "";

  const sendUpdate = () => {
    const job = jobStatus(jobId) as Record<string, unknown> | undefined;
    if (!job) {
      response.write(`event: error\ndata: ${JSON.stringify({ error: "Scan job not found." })}\n\n`);
      response.end();
      return true;
    }

    const payload = JSON.stringify({ ...job, progress: liveJobs.get(Number(job.scan_id)) });
    if (payload !== previousPayload) {
      response.write(`data: ${payload}\n\n`);
      previousPayload = payload;
    }

    if (job.status === "completed" || job.status === "failed") {
      response.write(`event: complete\ndata: ${JSON.stringify({
        scan_id: job.scan_id,
        status: job.status,
        error_code: job.error_code,
      })}\n\n`);
      response.end();
      return true;
    }
    return false;
  };

  if (sendUpdate()) return;
  const timer = setInterval(() => {
    if (sendUpdate()) clearInterval(timer);
  }, 400);
  request.on("close", () => clearInterval(timer));
});

app.get("/api/compare", (request, response) => {
  const ids = String(request.query.id || "").split(",").map(Number).filter(Number.isFinite);
  const reports = ids.map(findReport).filter(Boolean);
  if (ids.length !== 2 || reports.length !== 2) {
    return response.status(400).json({ error: "Choose exactly two completed scans." });
  }
  response.json(reports);
});

app.get("/api/performance", (_request, response) => {
  response.json({
    queue: { active: activeScans, waiting: scanQueue.length, concurrency: maxConcurrentScans },
    browser: browserPoolStats(),
  });
});

app.use("/api", (_request, response) => {
  response.status(404).json({ error: "API route not found." });
});

app.get(/.*/, (_request, response) => {
  response.setHeader("Cache-Control", "no-cache");
  response.type("html").send(pageHtml);
});

const server = app.listen(config.port, "0.0.0.0", () => {
  console.log(`GlassNet is running at http://127.0.0.1:${config.port}`);
});

async function shutdown() {
  server.close();
  await closeBrowserPool();
}

process.on("SIGINT", () => void shutdown());
process.on("SIGTERM", () => void shutdown());

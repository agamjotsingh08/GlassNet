// GlassNet's local application server.
import "dotenv/config";
import express from "express";
import fs from "node:fs";
import path from "node:path";
import { config } from "./src/config.js";
import {
  addPortfolioWebsite,
  addWatch,
  architectureComparison,
  attributionForScan,
  baselineForScan,
  blueprintForScan,
  completeScan,
  configurationDrift,
  createApproval,
  createConsentEvaluation,
  createDebt,
  createDecision,
  createForecast,
  createIssue,
  createJourney,
  createPortfolio,
  createRequirement,
  createReview,
  createScan,
  evidenceChainForScan,
  evaluateRequirements,
  evaluateRules,
  failScan,
  featureFlags,
  findReport,
  incidentForScan,
  jobStatus,
  listApprovals,
  listConsentEvaluations,
  listDebt,
  listDecisions,
  listForecasts,
  listIssues,
  listJourneys,
  listPortfolios,
  listReports,
  listRequirements,
  listReviews,
  listRules,
  listWatches,
  maturityModel,
  necessityForScan,
  removeWatch,
  saveFeedback,
  saveServiceGovernance,
  scenariosForScan,
  serviceInventory,
  setBaseline,
  updateApproval,
  updateDebt,
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

app.get("/api/analysis/necessity/:scanId", (request, response) => {
  try { response.json(necessityForScan(Number(request.params.scanId))); } catch (error) { sendError(response, error, 404); }
});
app.get("/api/analysis/attribution/:scanId", (request, response) => {
  try { response.json(attributionForScan(Number(request.params.scanId))); } catch (error) { sendError(response, error, 404); }
});
app.get("/api/analysis/scenarios/:scanId", (request, response) => {
  try { response.json(scenariosForScan(Number(request.params.scanId))); } catch (error) { sendError(response, error, 404); }
});
app.get("/api/analysis/blueprint/:scanId", (request, response) => {
  try { response.json(blueprintForScan(Number(request.params.scanId))); } catch (error) { sendError(response, error, 404); }
});
app.get("/api/analysis/evidence-chain/:scanId", (request, response) => {
  try { response.json(evidenceChainForScan(Number(request.params.scanId))); } catch (error) { sendError(response, error, 404); }
});
app.get("/api/analysis/drift/:scanId", (request, response) => {
  try { response.json(configurationDrift(Number(request.params.scanId))); } catch (error) { sendError(response, error, 404); }
});
app.get("/api/analysis/maturity/:scanId", (request, response) => {
  try { response.json(maturityModel(Number(request.params.scanId))); } catch (error) { sendError(response, error, 404); }
});
app.get("/api/analysis/incident/:scanId", (request, response) => {
  try { response.json(incidentForScan(Number(request.params.scanId))); } catch (error) { sendError(response, error, 404); }
});
app.get("/api/analysis/architecture", (request, response) => {
  try { response.json(architectureComparison(Number(request.query.left), Number(request.query.right))); } catch (error) { sendError(response, error, 404); }
});

app.get("/api/governance/inventory", (_request, response) => response.json(serviceInventory()));
app.put("/api/governance/services/:domain", (request, response) => {
  try {
    response.json(saveServiceGovernance({
      domain: request.params.domain, owner: request.body?.owner, team: request.body?.team,
      purpose: request.body?.purpose, approvalStatus: request.body?.approval_status,
      consentRequirement: request.body?.consent_requirement, reviewDate: request.body?.review_date,
      notes: request.body?.notes,
    }));
  } catch (error) { sendError(response, error); }
});
app.get("/api/governance/approvals", (_request, response) => response.json(listApprovals()));
app.post("/api/governance/approvals", (request, response) => {
  try { response.status(201).json({ id: createApproval({
    changeType: String(request.body?.change_type || "service"),
    title: String(request.body?.title || ""), purpose: String(request.body?.purpose || ""),
    owner: String(request.body?.owner || ""), expectedImpact: String(request.body?.expected_impact || ""),
    consentRequirement: String(request.body?.consent_requirement || "review required"),
    policyUpdateRequired: Boolean(request.body?.policy_update_required), evidence: request.body?.evidence,
  }) }); } catch (error) { sendError(response, error); }
});
app.patch("/api/governance/approvals/:id", (request, response) => {
  try { response.json(updateApproval(Number(request.params.id), String(request.body?.status))); } catch (error) { sendError(response, error); }
});
app.get("/api/governance/decisions", (_request, response) => response.json(listDecisions()));
app.post("/api/governance/decisions", (request, response) => {
  try { response.status(201).json({ id: createDecision({
    title: String(request.body?.title || ""), context: String(request.body?.context || ""),
    alternatives: String(request.body?.alternatives || ""), decision: String(request.body?.decision || ""),
    privacyImpact: String(request.body?.privacy_impact || ""), consentImpact: request.body?.consent_impact,
    performanceImpact: request.body?.performance_impact, owner: String(request.body?.owner || ""),
    reviewDate: request.body?.review_date, relatedDomain: request.body?.related_domain,
    relatedScanId: Number(request.body?.related_scan_id) || undefined, replacementPlan: request.body?.replacement_plan,
  }) }); } catch (error) { sendError(response, error); }
});

app.get("/api/improvement/debt", (_request, response) => response.json(listDebt()));
app.post("/api/improvement/debt", (request, response) => {
  try { response.status(201).json({ id: createDebt({
    scanId: Number(request.body?.scan_id) || undefined, domain: request.body?.domain,
    title: String(request.body?.title || ""), category: String(request.body?.category || "documentation"),
    impact: String(request.body?.impact || "moderate"), complexity: String(request.body?.complexity || "medium"),
    effortHours: Number(request.body?.effort_hours) || 1, owner: request.body?.owner,
    evidence: String(request.body?.evidence || ""),
  }) }); } catch (error) { sendError(response, error); }
});
app.patch("/api/improvement/debt/:id", (request, response) => {
  try { response.json(updateDebt(Number(request.params.id), String(request.body?.status))); } catch (error) { sendError(response, error); }
});

app.get("/api/testing/requirements", (_request, response) => response.json(listRequirements()));
app.post("/api/testing/requirements", (request, response) => {
  try { response.status(201).json({ id: createRequirement(String(request.body?.name || ""), String(request.body?.rule_type || ""), String(request.body?.expected_value || "0")) }); }
  catch (error) { sendError(response, error); }
});
app.get("/api/testing/requirements/:scanId/run", (request, response) => {
  try { response.json(evaluateRequirements(Number(request.params.scanId))); } catch (error) { sendError(response, error, 404); }
});
app.get("/api/testing/forecasts", (_request, response) => response.json(listForecasts()));
app.post("/api/testing/forecasts", (request, response) => {
  try { response.status(201).json(createForecast({
    name: String(request.body?.name || ""), serviceCategory: String(request.body?.service_category || ""),
    domains: String(request.body?.domains || ""), expectedScripts: Number(request.body?.expected_scripts) || 0,
    cookieBehavior: String(request.body?.cookie_behavior || "unknown"), storageUse: String(request.body?.storage_use || "unknown"),
    consentRequirement: String(request.body?.consent_requirement || "review"), pageLocations: request.body?.page_locations,
    organization: request.body?.organization, dataPurpose: String(request.body?.data_purpose || ""),
  })); } catch (error) { sendError(response, error); }
});

app.get("/api/journeys", (_request, response) => response.json(listJourneys()));
app.post("/api/journeys", (request, response) => {
  try { response.status(201).json({ id: createJourney(String(request.body?.name || ""), String(request.body?.start_url || ""), Array.isArray(request.body?.steps) ? request.body.steps.map(String) : []) }); }
  catch (error) { sendError(response, error); }
});
app.get("/api/consent/evaluations", (_request, response) => response.json(listConsentEvaluations()));
app.post("/api/consent/evaluations", (request, response) => {
  try { response.status(201).json(createConsentEvaluation({
    scanId: Number(request.body?.scan_id) || undefined,
    acceptSteps: Number(request.body?.accept_steps), rejectSteps: Number(request.body?.reject_steps),
    rejectVisible: Boolean(request.body?.reject_visible), granular: Boolean(request.body?.granular),
    revisitAvailable: Boolean(request.body?.revisit_available), defaultSelections: Boolean(request.body?.default_selections),
    evaluatorNote: request.body?.evaluator_note,
  })); } catch (error) { sendError(response, error); }
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

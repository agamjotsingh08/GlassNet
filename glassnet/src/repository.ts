import { db } from "./database.js";
import { mainDomain } from "./classification.js";
import type { ScanResult } from "./types.js";

type Row = Record<string, unknown>;
const now = () => new Date().toISOString();

function websiteId(url: string, title?: string): number {
  const parsed = new URL(url);
  const origin = parsed.origin;
  const time = now();
  db.prepare("INSERT INTO websites (normalized_origin, hostname, registered_domain, title, first_seen_at, last_seen_at) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(normalized_origin) DO UPDATE SET title=excluded.title, last_seen_at=excluded.last_seen_at").run(origin, parsed.hostname, mainDomain(parsed.hostname), title || null, time, time);
  return Number((db.prepare("SELECT id FROM websites WHERE normalized_origin = ?").get(origin) as Row).id);
}

export function createScan(url: string, userId?: number): { scanId: number; jobId: number } {
  const time = now();
  const siteId = websiteId(url);
  const result = db.prepare("INSERT INTO scans (website_id, user_id, status, scanner_version, created_at) VALUES (?, ?, 'created', '0.3.0-local', ?)").run(siteId, userId || null, time);
  const scanId = Number(result.lastInsertRowid);
  const job = db.prepare("INSERT INTO scan_jobs (scan_id, status, progress_stage, created_at, updated_at) VALUES (?, 'queued', 'queued', ?, ?)").run(scanId, time, time);
  return { scanId, jobId: Number(job.lastInsertRowid) };
}

export function updateJob(scanId: number, status: string, stage: string, errorCode?: string) {
  const time = now();
  db.prepare("UPDATE scan_jobs SET status=?, progress_stage=?, attempts=attempts+1, error_code=?, updated_at=? WHERE scan_id=?").run(status, stage, errorCode || null, time, scanId);
  db.prepare("UPDATE scans SET status=?, started_at=CASE WHEN started_at IS NULL THEN ? ELSE started_at END, error_code=? WHERE id=?").run(status, time, errorCode || null, scanId);
}

export function completeScan(scanId: number, report: ScanResult): ScanResult {
  const time = now();
  const siteId = websiteId(report.url, report.site_name);
  db.prepare("UPDATE scans SET website_id=?, status='completed', completed_at=?, request_count=?, cookie_count=?, storage_count=?, report_json=? WHERE id=?").run(siteId, time, report.summary.requests, report.summary.cookies, report.summary.storage_keys, JSON.stringify(report), scanId);
  db.prepare("UPDATE scan_jobs SET status='completed', progress_stage='completed', updated_at=? WHERE scan_id=?").run(time, scanId);
  report.id = scanId; report.created_at = time;
  return report;
}

export function failScan(scanId: number, message: string) {
  db.prepare("UPDATE scans SET status='failed', completed_at=?, error_code=? WHERE id=?").run(now(), message.slice(0, 120), scanId);
  db.prepare("UPDATE scan_jobs SET status='failed', progress_stage='failed', error_code=?, updated_at=? WHERE scan_id=?").run(message.slice(0, 120), now(), scanId);
}

export function listReports(): ScanResult[] {
  const rows = db.prepare("SELECT id, report_json, created_at FROM scans WHERE status='completed' ORDER BY created_at DESC LIMIT 30").all() as Row[];
  return rows.map((row) => ({ ...JSON.parse(String(row.report_json)), id: Number(row.id), created_at: String(row.created_at) }));
}

export function findReport(id: number): ScanResult | undefined {
  const row = db.prepare("SELECT id, report_json, created_at FROM scans WHERE id=? AND status='completed'").get(id) as Row | undefined;
  return row ? { ...JSON.parse(String(row.report_json)), id: Number(row.id), created_at: String(row.created_at) } : undefined;
}

export function jobStatus(id: number) { return db.prepare("SELECT id, scan_id, status, progress_stage, attempts, error_code, updated_at FROM scan_jobs WHERE id=?").get(id); }

export function featureFlags() { return db.prepare("SELECT key, enabled, description FROM feature_flags ORDER BY key").all(); }

export function addWatch(userId: number, url: string, cadence = "weekly") {
  const siteId = websiteId(url);
  const time = now();
  db.prepare("INSERT INTO watch_targets (user_id, website_id, cadence, next_check_at, created_at) VALUES (?, ?, ?, ?, ?) ON CONFLICT(user_id, website_id) DO UPDATE SET enabled=1, cadence=excluded.cadence").run(userId, siteId, cadence, time, time);
  db.prepare("INSERT INTO audit_events (actor_id, event_type, object_type, object_id, created_at) VALUES (?, 'watch.created', 'website', ?, ?)").run(userId, String(siteId), time);
  return siteId;
}

export function listWatches(userId: number) {
  return db.prepare("SELECT watch_targets.id, watch_targets.cadence, watch_targets.enabled, watch_targets.last_checked_at, watch_targets.next_check_at, websites.normalized_origin, websites.hostname FROM watch_targets JOIN websites ON websites.id=watch_targets.website_id WHERE watch_targets.user_id=? ORDER BY watch_targets.created_at DESC").all(userId);
}

export function removeWatch(userId: number, watchId: number) {
  return db.prepare("DELETE FROM watch_targets WHERE id=? AND user_id=?").run(watchId, userId).changes > 0;
}

export function saveFeedback(input: { scanId?: number; userId?: number; kind: string; rating?: number; details?: string }) {
  const allowed = ["usefulness", "classification", "clarity", "missing_service", "graph", "false_positive", "incomplete"];
  if (!allowed.includes(input.kind)) throw new Error("Choose a valid feedback type.");
  if (input.rating && (!Number.isInteger(input.rating) || input.rating < 1 || input.rating > 5)) throw new Error("Rating must be between 1 and 5.");
  // Limit free text so feedback cannot become an accidental sensitive-data store.
  const details = String(input.details || "").slice(0, 500) || null;
  const result = db.prepare("INSERT INTO user_feedback (scan_id, user_id, kind, rating, details, ruleset_version, ui_version, created_at) VALUES (?, ?, ?, ?, ?, '0.2.0', '0.2.0', ?)").run(input.scanId || null, input.userId || null, input.kind, input.rating || null, details, now());
  return Number(result.lastInsertRowid);
}

export function compareReports(baseId: number, candidateId: number) {
  const base = findReport(baseId);
  const candidate = findReport(candidateId);
  if (!base || !candidate) throw new Error("Both completed scans are required.");
  const baseDomains = new Set(base.services.map((item) => item.domain));
  const candidateDomains = new Set(candidate.services.map((item) => item.domain));
  const added = candidate.services.filter((item) => !baseDomains.has(item.domain));
  const removed = base.services.filter((item) => !candidateDomains.has(item.domain));
  const changed = [
    candidate.summary.cookies !== base.summary.cookies ? `Cookie count changed from ${base.summary.cookies} to ${candidate.summary.cookies}` : "",
    candidate.summary.third_parties !== base.summary.third_parties ? `Third parties changed from ${base.summary.third_parties} to ${candidate.summary.third_parties}` : "",
    candidate.score !== base.score ? `Exposure score changed from ${base.score} to ${candidate.score}` : "",
  ].filter(Boolean);
  return {
    base: { id: base.id, site_name: base.site_name, created_at: base.created_at, score: base.score },
    candidate: { id: candidate.id, site_name: candidate.site_name, created_at: candidate.created_at, score: candidate.score },
    added,
    removed,
    changed,
    verdict: added.some((item) => item.category === "Advertising") || candidate.score < base.score - 10 ? "fail" : added.length ? "warning" : "pass",
  };
}

export function setBaseline(scanId: number, label = "Production baseline") {
  const row = db.prepare("SELECT website_id FROM scans WHERE id=? AND status='completed'").get(scanId) as Row | undefined;
  if (!row) throw new Error("Choose a completed scan.");
  const result = db.prepare("INSERT INTO privacy_baselines (website_id, scan_id, label, created_at) VALUES (?, ?, ?, ?) ON CONFLICT(website_id) DO UPDATE SET scan_id=excluded.scan_id, label=excluded.label, created_at=excluded.created_at").run(Number(row.website_id), scanId, label.slice(0, 80), now());
  return Number(result.lastInsertRowid || scanId);
}

export function baselineForScan(scanId: number) {
  return db.prepare("SELECT privacy_baselines.id, privacy_baselines.scan_id, privacy_baselines.label, privacy_baselines.created_at FROM privacy_baselines JOIN scans ON scans.website_id=privacy_baselines.website_id WHERE scans.id=?").get(scanId);
}

export function createReview(baseScanId: number, candidateScanId: number) {
  const summary = compareReports(baseScanId, candidateScanId);
  const time = now();
  const result = db.prepare("INSERT INTO privacy_reviews (base_scan_id, candidate_scan_id, status, summary_json, created_at, updated_at) VALUES (?, ?, 'open', ?, ?, ?)").run(baseScanId, candidateScanId, JSON.stringify(summary), time, time);
  return { id: Number(result.lastInsertRowid), status: "open", ...summary };
}

export function listReviews() {
  return (db.prepare("SELECT id, status, summary_json, note, created_at, updated_at FROM privacy_reviews ORDER BY created_at DESC LIMIT 30").all() as Row[]).map((row) => ({ ...row, summary: JSON.parse(String(row.summary_json)) }));
}

export function updateReview(id: number, status: string, note = "") {
  const allowed = ["open", "approved", "changes_requested", "expected", "false_positive"];
  if (!allowed.includes(status)) throw new Error("Choose a valid review status.");
  const changed = db.prepare("UPDATE privacy_reviews SET status=?, note=?, updated_at=? WHERE id=?").run(status, note.slice(0, 500), now(), id).changes;
  if (!changed) throw new Error("Review not found.");
  return db.prepare("SELECT id, status, note, updated_at FROM privacy_reviews WHERE id=?").get(id);
}

export function listIssues() {
  return db.prepare("SELECT id, scan_id, title, category, severity, evidence, status, assignee, due_date, resolution, created_at, updated_at FROM issues ORDER BY CASE severity WHEN 'critical' THEN 1 WHEN 'high' THEN 2 WHEN 'medium' THEN 3 ELSE 4 END, updated_at DESC").all();
}

export function createIssue(input: { scanId?: number; title: string; category: string; severity: string; evidence: string }) {
  const allowed = ["low", "medium", "high", "critical"];
  if (!allowed.includes(input.severity)) throw new Error("Choose a valid severity.");
  if (!input.title.trim() || !input.evidence.trim()) throw new Error("Title and evidence are required.");
  const time = now();
  const result = db.prepare("INSERT INTO issues (scan_id, title, category, severity, evidence, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 'open', ?, ?)").run(input.scanId || null, input.title.slice(0, 120), input.category.slice(0, 60), input.severity, input.evidence.slice(0, 1000), time, time);
  return Number(result.lastInsertRowid);
}

export function updateIssue(id: number, status: string) {
  const allowed = ["open", "triaged", "in_progress", "resolved", "accepted", "false_positive", "reopened"];
  if (!allowed.includes(status)) throw new Error("Choose a valid issue status.");
  if (!db.prepare("UPDATE issues SET status=?, updated_at=? WHERE id=?").run(status, now(), id).changes) throw new Error("Issue not found.");
  return db.prepare("SELECT * FROM issues WHERE id=?").get(id);
}

export function listRules() {
  return db.prepare("SELECT id, name, rule_type, operator, value, enabled FROM threshold_rules ORDER BY id").all();
}

export function evaluateRules(scanId: number) {
  const report = findReport(scanId);
  if (!report) throw new Error("Completed scan not found.");
  const values: Record<string, number> = {
    third_parties: report.summary.third_parties,
    cookies: report.summary.cookies,
    unknown_domains: report.services.filter((item) => item.confidence === "unknown").length,
  };
  const checks = (listRules() as Row[]).filter((rule) => Number(rule.enabled) === 1).map((rule) => {
    const actual = values[String(rule.rule_type)] ?? 0;
    const passed = actual <= Number(rule.value);
    return { id: rule.id, name: rule.name, actual, limit: Number(rule.value), status: passed ? "pass" : "fail" };
  });
  return { scan_id: scanId, status: checks.some((item) => item.status === "fail") ? "fail" : "pass", checks };
}

export function listPortfolios() {
  const rows = db.prepare("SELECT id, name, description, created_at FROM portfolios ORDER BY created_at DESC").all() as Row[];
  return rows.map((portfolio) => ({
    ...portfolio,
    websites: db.prepare("SELECT websites.id, websites.hostname, websites.title, MAX(scans.created_at) AS last_scan, MAX(scans.request_count) AS requests, MAX(scans.cookie_count) AS cookies FROM portfolio_websites JOIN websites ON websites.id=portfolio_websites.website_id LEFT JOIN scans ON scans.website_id=websites.id AND scans.status='completed' WHERE portfolio_websites.portfolio_id=? GROUP BY websites.id ORDER BY websites.hostname").all(Number(portfolio.id)),
  }));
}

export function createPortfolio(name: string, description = "") {
  if (!name.trim()) throw new Error("Portfolio name is required.");
  const result = db.prepare("INSERT INTO portfolios (name, description, created_at) VALUES (?, ?, ?)").run(name.slice(0, 80), description.slice(0, 300), now());
  return Number(result.lastInsertRowid);
}

export function addPortfolioWebsite(portfolioId: number, scanId: number) {
  const row = db.prepare("SELECT website_id FROM scans WHERE id=? AND status='completed'").get(scanId) as Row | undefined;
  if (!row) throw new Error("Choose a completed scan.");
  db.prepare("INSERT OR IGNORE INTO portfolio_websites (portfolio_id, website_id, created_at) VALUES (?, ?, ?)").run(portfolioId, Number(row.website_id), now());
}

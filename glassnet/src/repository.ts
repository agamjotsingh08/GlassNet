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

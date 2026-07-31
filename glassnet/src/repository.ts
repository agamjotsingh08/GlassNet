// Small database helpers for scan history.
import { mainDomain } from "./classification.js";
import { analyzeReport } from "./analysis.js";
import { classifyCookie, cookieSecurityNotes } from "./cookie-knowledge.js";
import { db } from "./database.js";
import type { ScanResult } from "./types.js";

type Row = Record<string, unknown>;
const now = () => new Date().toISOString();

export function normalizeReport(value: Record<string, unknown>): ScanResult {
  const raw = value as unknown as ScanResult;
  const finalUrl = raw.final_url || raw.url;
  const cookies = (raw.cookies || []).map((cookie) => {
    if (cookie.name && cookie.purpose) return cookie;
    const basic = {
      name: cookie.name || "Not recorded in this older report",
      domain: cookie.domain,
      path: cookie.path || "/",
      secure: cookie.secure,
      httpOnly: cookie.httpOnly,
      sameSite: cookie.sameSite,
      session: cookie.session,
      firstParty: cookie.firstParty,
    };
    return {
      ...basic,
      expires_at: cookie.expires_at || null,
      consent_state: "Not tested" as const,
      ...classifyCookie(basic),
      security_notes: cookieSecurityNotes(basic, finalUrl.startsWith("https://")),
    };
  });
  const base: Omit<ScanResult, "findings" | "security_checks" | "risk"> = {
    ...raw,
    cookies,
    requests: raw.requests || [],
    final_url: finalUrl,
    redirect_chain: raw.redirect_chain || [],
    iframes: raw.iframes || [],
    forms: raw.forms || [],
    permissions: raw.permissions || [],
    downloads: raw.downloads || [],
    script_signals: raw.script_signals || { suspicious_obfuscation: 0, miner_signature: false, details: [] },
    coverage: raw.coverage || {
      page_loaded: Boolean(raw.url), duration_ms: 0, redirects_followed: 0,
      checks_completed: 0, checks_unavailable: 1,
    },
  };
  const analysis = raw.risk && raw.findings && raw.security_checks
    ? { risk: raw.risk, findings: raw.findings, security_checks: raw.security_checks }
    : analyzeReport(base);
  return { ...base, ...analysis };
}

function findOrCreateWebsite(url: string, title?: string): number {
  const parsed = new URL(url);
  const time = now();

  db.prepare(`
    INSERT INTO websites
      (normalized_origin, hostname, registered_domain, title, first_seen_at, last_seen_at)
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(normalized_origin)
    DO UPDATE SET title=excluded.title, last_seen_at=excluded.last_seen_at
  `).run(parsed.origin, parsed.hostname, mainDomain(parsed.hostname), title || null, time, time);

  const row = db.prepare("SELECT id FROM websites WHERE normalized_origin=?").get(parsed.origin) as Row;
  return Number(row.id);
}

export function createScan(url: string): { scanId: number; jobId: number } {
  const time = now();
  const websiteId = findOrCreateWebsite(url);

  const scan = db.prepare(`
    INSERT INTO scans (website_id, status, scanner_version, created_at)
    VALUES (?, 'created', '0.7.0-local', ?)
  `).run(websiteId, time);
  const scanId = Number(scan.lastInsertRowid);

  const job = db.prepare(`
    INSERT INTO scan_jobs (scan_id, status, progress_stage, created_at, updated_at)
    VALUES (?, 'queued', 'queued', ?, ?)
  `).run(scanId, time, time);

  return { scanId, jobId: Number(job.lastInsertRowid) };
}

export function updateJob(scanId: number, status: string, stage: string, errorCode?: string) {
  const time = now();
  db.prepare(`
    UPDATE scan_jobs
    SET status=?, progress_stage=?, attempts=attempts+1, error_code=?, updated_at=?
    WHERE scan_id=?
  `).run(status, stage, errorCode || null, time, scanId);

  db.prepare(`
    UPDATE scans
    SET status=?, started_at=COALESCE(started_at, ?), error_code=?
    WHERE id=?
  `).run(status, time, errorCode || null, scanId);
}

export function completeScan(scanId: number, report: ScanResult): ScanResult {
  const time = now();
  const websiteId = findOrCreateWebsite(report.url, report.site_name);

  db.prepare(`
    UPDATE scans
    SET website_id=?, status='completed', completed_at=?, request_count=?,
        cookie_count=?, storage_count=?, report_json=?, error_code=NULL
    WHERE id=?
  `).run(
    websiteId,
    time,
    report.summary.requests,
    report.summary.cookies,
    report.summary.storage_keys,
    JSON.stringify(report),
    scanId,
  );

  db.prepare(`
    UPDATE scan_jobs
    SET status='completed', progress_stage='completed', updated_at=?
    WHERE scan_id=?
  `).run(time, scanId);

  return { ...report, id: scanId, created_at: time };
}

export function failScan(scanId: number, message: string) {
  const shortMessage = message.slice(0, 120);
  const time = now();
  db.prepare(`
    UPDATE scans SET status='failed', completed_at=?, error_code=? WHERE id=?
  `).run(time, shortMessage, scanId);
  db.prepare(`
    UPDATE scan_jobs
    SET status='failed', progress_stage='failed', error_code=?, updated_at=?
    WHERE scan_id=?
  `).run(shortMessage, time, scanId);
}

export function listReportSummaries(limit = 20, before = "") {
  const pageSize = Math.min(50, Math.max(1, Math.floor(limit)));
  const rows = db.prepare(`
    SELECT
      scans.id,
      scans.created_at,
      scans.request_count AS requests,
      scans.cookie_count AS cookies,
      websites.title AS site_name,
      websites.registered_domain AS target_domain,
      json_extract(scans.report_json, '$.mode') AS mode,
      json_extract(scans.report_json, '$.score') AS score,
      json_extract(scans.report_json, '$.summary.third_parties') AS third_parties
    FROM scans
    JOIN websites ON websites.id=scans.website_id
    WHERE scans.status='completed' AND (?='' OR scans.created_at < ?)
    ORDER BY scans.created_at DESC
    LIMIT ?
  `).all(before, before, pageSize + 1) as Row[];

  const hasMore = rows.length > pageSize;
  const items = rows.slice(0, pageSize).map((row) => ({
    ...row,
    id: Number(row.id),
    requests: Number(row.requests),
    cookies: Number(row.cookies),
    score: Number(row.score),
    third_parties: Number(row.third_parties),
  }));

  return {
    items,
    next_cursor: hasMore ? String(rows[pageSize - 1]?.created_at || "") : null,
  };
}

export function findReport(id: number): ScanResult | undefined {
  const row = db.prepare(`
    SELECT id, report_json, created_at
    FROM scans
    WHERE id=? AND status='completed'
  `).get(id) as Row | undefined;

  if (!row?.report_json) return undefined;
  return normalizeReport({
    ...JSON.parse(String(row.report_json)),
    id: Number(row.id),
    created_at: String(row.created_at),
  });
}

export function jobStatus(jobId: number) {
  return db.prepare(`
    SELECT id, scan_id, status, progress_stage, attempts, error_code, updated_at
    FROM scan_jobs
    WHERE id=?
  `).get(jobId);
}

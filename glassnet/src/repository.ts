import { db } from "./database.js";
import { mainDomain } from "./classification.js";
import { forecastImpact, necessityVerdict, requirementStatus } from "./archive-analysis.js";
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
  const result = db.prepare("INSERT INTO scans (website_id, user_id, status, scanner_version, created_at) VALUES (?, ?, 'created', '0.4.0-local', ?)").run(siteId, userId || null, time);
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

function requiredReport(scanId: number): ScanResult {
  const report = findReport(scanId);
  if (!report) throw new Error("Completed case not found.");
  return report;
}

export function necessityForScan(scanId: number) {
  const report = requiredReport(scanId);
  return report.services.map((service) => {
    const verdict = necessityVerdict(service.category, service.essential, service.confidence);
    return {
      domain: service.domain,
      service: service.name,
      purpose: service.category,
      verdict,
      triggered_by: service.types.includes("script") ? "page script" : service.types[0] || "network request",
      activates_before_interaction: true,
      feature_dependency: service.category === "Customer support" ? "support widget" : service.category === "Embedded content" ? "embedded media" : service.category.toLowerCase(),
      removal_risk: verdict === "Essential" ? "High" : verdict === "Operationally useful" ? "Moderate" : "Unknown until tested",
      first_party_alternative: ["Analytics", "Content delivery"].includes(service.category) ? "Architectural review possible" : "No automatic claim",
      confidence: service.confidence,
      evidence: `${service.requests} requests; ${service.types.join(", ") || "unknown resource"}`,
    };
  });
}

export function attributionForScan(scanId: number) {
  const report = requiredReport(scanId);
  return report.services.map((service) => {
    const feature = service.category === "Customer support" ? "Live support" :
      service.category === "Embedded content" ? "Embedded media" :
      service.category === "Advertising" ? "Promotional content" :
      service.category === "Analytics" ? "Audience measurement" :
      service.category === "Content delivery" ? "Page assets" : "Unresolved page behavior";
    return {
      feature,
      initiating_script: report.scripts.find((script) => {
        try { return new URL(script).hostname.endsWith(service.domain); } catch { return false; }
      }) || "Initiator not captured",
      service: service.name,
      domain: service.domain,
      requests: service.requests,
      storage: report.cookies.filter((cookie) => cookie.domain === service.domain).length + report.storage.filter((item) => item.origin.includes(service.domain)).length,
      purpose: service.category,
      confidence: service.confidence === "verified" ? "confirmed classification" : "inferred from captured category",
    };
  });
}

export function scenariosForScan(scanId: number) {
  const report = requiredReport(scanId);
  const persistentCookies = report.cookies.filter((cookie) => !cookie.session);
  const categoryGroups = Object.entries(report.categories);
  return categoryGroups.map(([category, count]) => ({
    name: `${category} exposure scenario`,
    services: report.services.filter((service) => service.category === category).map((service) => service.name),
    observed_identifiers: persistentCookies.length ? `${persistentCookies.length} persistent cookie attribute records` : "No persistent cookie attributes observed",
    persistence: persistentCookies.length ? "Persistent identifiers technically possible" : "No persistence observed in this load",
    sequence: report.events.filter((event) => event.type === "response" || event.type === "cookie").slice(0, 8),
    organization_overlap: "Not confirmed without reviewed ownership records",
    evidence: `${count} service classifications and ${report.summary.requests} total requests`,
    assumptions: "Service category may indicate a purpose; request contents were not inspected.",
    uncertainty: "This scenario does not prove personal-data transfer or cross-service correlation.",
  }));
}

export function blueprintForScan(scanId: number) {
  const report = requiredReport(scanId);
  const necessity = necessityForScan(scanId);
  const delayed = necessity.filter((item) => ["Optional", "Likely unnecessary"].includes(item.verdict));
  const core = necessity.filter((item) => item.verdict === "Essential");
  return {
    current: {
      first_party_domains: report.first_party.map((item) => item.domain),
      third_party_services: necessity,
      consent_boundary: report.consent.status,
      storage_keys: report.summary.storage_keys,
    },
    proposed: {
      preserve: core.map((item) => item.service),
      delay_until_choice_or_interaction: delayed.map((item) => item.service),
      consolidate: report.services.filter((item) => item.category === "Analytics").map((item) => item.name),
      first_party_opportunities: necessity.filter((item) => item.first_party_alternative.includes("possible")).map((item) => item.service),
      storage_actions: report.cookies.some((cookie) => !cookie.secure) ? ["Review cookie security attributes"] : ["Preserve observed cookie security attributes"],
      implementation_order: ["Confirm service ownership", "Validate necessity with feature owners", "Test delayed optional loading", "Review storage boundaries", "Run a verification case"],
      verification: "Run the same case mode and compare the observed graph, events, cookies, and requirements.",
    },
    limitations: "The proposed view is evidence-based architecture guidance, not an automatic website modification.",
  };
}

export function evidenceChainForScan(scanId: number) {
  const report = requiredReport(scanId);
  return report.services.map((service) => {
    const relatedEvents = report.events.filter((event) => event.destination === service.domain).slice(0, 6);
    const cookies = report.cookies.filter((cookie) => cookie.domain === service.domain);
    return {
      finding: `${service.name} observed as ${service.category}`,
      confidence: service.confidence,
      rule_version: report.scanner_version,
      steps: [
        { label: "Observed", detail: "Initial page loaded in a fresh isolated browser", timestamp: 0 },
        ...relatedEvents.map((event) => ({ label: "Observed", detail: `${event.type} ${event.source} → ${event.destination}`, timestamp: event.offset_ms })),
        ...(cookies.length ? [{ label: "Observed", detail: `${cookies.length} cookie attribute record(s) associated`, timestamp: relatedEvents.at(-1)?.offset_ms || 0 }] : []),
        { label: "Classified", detail: `${service.category}; confidence ${service.confidence}`, timestamp: relatedEvents.at(-1)?.offset_ms || 0 },
        { label: "Inferred", detail: service.explanation, timestamp: relatedEvents.at(-1)?.offset_ms || 0 },
      ],
    };
  });
}

export function serviceInventory() {
  const reports = listReports();
  const inventory = new Map<string, { domain: string; service: string; category: string; websites: Set<string>; first_seen: string; last_seen: string; evidence_count: number; confidence: string }>();
  for (const report of [...reports].reverse()) {
    for (const service of report.services) {
      const current = inventory.get(service.domain);
      if (current) {
        current.websites.add(report.target_domain);
        current.last_seen = report.created_at || current.last_seen;
        current.evidence_count += service.requests;
      } else {
        inventory.set(service.domain, {
          domain: service.domain, service: service.name, category: service.category,
          websites: new Set([report.target_domain]), first_seen: report.created_at || "",
          last_seen: report.created_at || "", evidence_count: service.requests, confidence: service.confidence,
        });
      }
    }
  }
  const governanceRows = db.prepare("SELECT * FROM service_governance").all() as Row[];
  const governance = new Map(governanceRows.map((row) => [String(row.domain), row]));
  return [...inventory.values()].map((item) => ({
    ...item,
    websites: [...item.websites],
    owner: governance.get(item.domain)?.owner || null,
    team: governance.get(item.domain)?.team || null,
    purpose: governance.get(item.domain)?.purpose || item.category,
    approval_status: governance.get(item.domain)?.approval_status || "unreviewed",
    consent_requirement: governance.get(item.domain)?.consent_requirement || "unknown",
    review_date: governance.get(item.domain)?.review_date || null,
  }));
}

export function saveServiceGovernance(input: { domain: string; owner?: string; team?: string; purpose?: string; approvalStatus?: string; consentRequirement?: string; reviewDate?: string; notes?: string }) {
  if (!input.domain.trim()) throw new Error("Service domain is required.");
  const approvalStates = ["unreviewed", "technical_review", "privacy_review", "approved", "rejected", "expired"];
  const approval = approvalStates.includes(input.approvalStatus || "") ? String(input.approvalStatus) : "unreviewed";
  const time = now();
  db.prepare("INSERT INTO service_governance (domain, owner, team, purpose, approval_status, consent_requirement, review_date, notes, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(domain) DO UPDATE SET owner=excluded.owner, team=excluded.team, purpose=excluded.purpose, approval_status=excluded.approval_status, consent_requirement=excluded.consent_requirement, review_date=excluded.review_date, notes=excluded.notes, updated_at=excluded.updated_at").run(
    input.domain.toLowerCase().slice(0, 253), input.owner?.slice(0, 80) || null, input.team?.slice(0, 80) || null,
    input.purpose?.slice(0, 200) || null, approval, input.consentRequirement?.slice(0, 80) || "unknown",
    input.reviewDate || null, input.notes?.slice(0, 500) || null, time, time,
  );
  return db.prepare("SELECT * FROM service_governance WHERE domain=?").get(input.domain.toLowerCase());
}

export function configurationDrift(scanId: number) {
  const report = requiredReport(scanId);
  const inventory = serviceInventory();
  const currentDomains = new Set(report.services.map((service) => service.domain));
  const activeNotApproved = inventory.filter((item) => currentDomains.has(item.domain) && item.approval_status !== "approved");
  const approvedNotObserved = inventory.filter((item) => !currentDomains.has(item.domain) && item.approval_status === "approved");
  const consentConflicts = report.services.filter((service) => service.essential === false).filter((service) => {
    const record = inventory.find((item) => item.domain === service.domain);
    return record?.consent_requirement === "none";
  });
  return {
    scan_id: scanId,
    status: activeNotApproved.length || consentConflicts.length ? "drift_detected" : "aligned",
    active_not_approved: activeNotApproved,
    approved_not_observed: approvedNotObserved,
    consent_conflicts: consentConflicts,
    limitations: ["Policy text is not parsed by this local build.", "An approved but unobserved service may load on another public route."],
  };
}

export function listDebt() {
  return db.prepare("SELECT * FROM privacy_debt_items ORDER BY CASE impact WHEN 'serious' THEN 1 WHEN 'high' THEN 2 WHEN 'moderate' THEN 3 ELSE 4 END, created_at ASC").all();
}

export function createDebt(input: { scanId?: number; domain?: string; title: string; category: string; impact: string; complexity: string; effortHours?: number; owner?: string; evidence: string }) {
  if (!input.title.trim() || !input.evidence.trim()) throw new Error("Debt title and evidence are required.");
  const time = now();
  const result = db.prepare("INSERT INTO privacy_debt_items (scan_id, domain, title, category, impact, complexity, effort_hours, owner, evidence, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)").run(
    input.scanId || null, input.domain?.slice(0, 253) || null, input.title.slice(0, 120), input.category.slice(0, 60),
    input.impact.slice(0, 30), input.complexity.slice(0, 30), Math.max(1, Math.min(1000, Number(input.effortHours) || 1)),
    input.owner?.slice(0, 80) || null, input.evidence.slice(0, 1000), time, time,
  );
  return Number(result.lastInsertRowid);
}

export function updateDebt(id: number, status: string) {
  const allowed = ["open", "planned", "in_progress", "resolved", "accepted"];
  if (!allowed.includes(status)) throw new Error("Choose a valid debt status.");
  if (!db.prepare("UPDATE privacy_debt_items SET status=?, updated_at=? WHERE id=?").run(status, now(), id).changes) throw new Error("Debt item not found.");
  return db.prepare("SELECT * FROM privacy_debt_items WHERE id=?").get(id);
}

export function listApprovals() { return db.prepare("SELECT * FROM change_approvals ORDER BY updated_at DESC").all(); }
export function createApproval(input: { changeType: string; title: string; purpose: string; owner: string; expectedImpact: string; consentRequirement: string; policyUpdateRequired?: boolean; evidence?: string }) {
  if (![input.title, input.purpose, input.owner, input.expectedImpact].every((value) => value?.trim())) throw new Error("Title, purpose, owner, and impact are required.");
  const time = now();
  const result = db.prepare("INSERT INTO change_approvals (change_type, title, purpose, owner, expected_impact, consent_requirement, policy_update_required, evidence, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)").run(
    input.changeType.slice(0, 50), input.title.slice(0, 120), input.purpose.slice(0, 500), input.owner.slice(0, 80),
    input.expectedImpact.slice(0, 500), input.consentRequirement.slice(0, 100), input.policyUpdateRequired ? 1 : 0,
    input.evidence?.slice(0, 1000) || null, time, time,
  );
  return Number(result.lastInsertRowid);
}
export function updateApproval(id: number, status: string) {
  const allowed = ["draft", "technical_review", "privacy_review", "approved", "rejected", "deployed", "verified", "rolled_back"];
  if (!allowed.includes(status)) throw new Error("Choose a valid approval state.");
  if (!db.prepare("UPDATE change_approvals SET status=?, updated_at=? WHERE id=?").run(status, now(), id).changes) throw new Error("Approval record not found.");
  return db.prepare("SELECT * FROM change_approvals WHERE id=?").get(id);
}

export function listDecisions() { return db.prepare("SELECT * FROM architecture_decisions ORDER BY updated_at DESC").all(); }
export function createDecision(input: { title: string; context: string; alternatives: string; decision: string; privacyImpact: string; consentImpact?: string; performanceImpact?: string; owner: string; reviewDate?: string; relatedDomain?: string; relatedScanId?: number; replacementPlan?: string }) {
  if (![input.title, input.context, input.alternatives, input.decision, input.privacyImpact, input.owner].every((value) => value?.trim())) throw new Error("Complete the required decision fields.");
  const time = now();
  const result = db.prepare("INSERT INTO architecture_decisions (title, context, alternatives, decision, privacy_impact, consent_impact, performance_impact, owner, review_date, related_domain, related_scan_id, replacement_plan, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)").run(
    input.title.slice(0, 120), input.context.slice(0, 1000), input.alternatives.slice(0, 1000), input.decision.slice(0, 1000),
    input.privacyImpact.slice(0, 1000), input.consentImpact?.slice(0, 500) || null, input.performanceImpact?.slice(0, 500) || null,
    input.owner.slice(0, 80), input.reviewDate || null, input.relatedDomain?.slice(0, 253) || null, input.relatedScanId || null,
    input.replacementPlan?.slice(0, 1000) || null, time, time,
  );
  return Number(result.lastInsertRowid);
}

export function listRequirements() { return db.prepare("SELECT * FROM privacy_requirements ORDER BY id").all(); }
export function createRequirement(name: string, ruleType: string, expectedValue: string) {
  const allowed = ["unknown_domains", "insecure_cookies", "unowned_services", "advertising_services", "third_parties", "storage_keys"];
  if (!name.trim() || !allowed.includes(ruleType)) throw new Error("Choose a supported requirement.");
  const time = now();
  const result = db.prepare("INSERT INTO privacy_requirements (name, rule_type, operator, expected_value, created_at, updated_at) VALUES (?, ?, 'max', ?, ?, ?)").run(name.slice(0, 120), ruleType, String(Math.max(0, Number(expectedValue) || 0)), time, time);
  return Number(result.lastInsertRowid);
}

export function evaluateRequirements(scanId: number) {
  const report = requiredReport(scanId);
  const inventory = serviceInventory();
  const values: Record<string, number | null> = {
    unknown_domains: report.services.filter((service) => service.confidence === "unknown").length,
    insecure_cookies: report.cookies.filter((cookie) => !cookie.secure).length,
    unowned_services: report.services.filter((service) => !inventory.find((item) => item.domain === service.domain)?.owner).length,
    advertising_services: report.services.filter((service) => service.category === "Advertising").length,
    third_parties: report.summary.third_parties,
    storage_keys: report.summary.storage_keys,
  };
  const requirements = listRequirements() as Row[];
  const results = requirements.filter((item) => Number(item.enabled)).map((item) => {
    const actual = values[String(item.rule_type)];
    const expected = Number(item.expected_value);
    const status = requirementStatus(actual, expected);
    return { id: item.id, name: item.name, rule_type: item.rule_type, actual, expected, status, evidence: actual === null ? "Required evidence was not captured." : `Observed ${actual}; maximum allowed ${expected}.` };
  });
  return { scan_id: scanId, status: results.some((item) => item.status === "failed") ? "failed" : results.some((item) => item.status === "inconclusive") ? "inconclusive" : "passed", results };
}

export function listForecasts() { return (db.prepare("SELECT * FROM impact_forecasts ORDER BY created_at DESC").all() as Row[]).map((row) => ({ ...row, forecast: JSON.parse(String(row.forecast_json)) })); }
export function createForecast(input: { name: string; serviceCategory: string; domains: string; expectedScripts?: number; cookieBehavior: string; storageUse: string; consentRequirement: string; pageLocations?: string; organization?: string; dataPurpose: string }) {
  if (![input.name, input.serviceCategory, input.domains, input.dataPurpose].every((value) => value?.trim())) throw new Error("Name, category, domains, and data purpose are required.");
  const domainCount = input.domains.split(/[\s,]+/).filter(Boolean).length;
  const forecast = forecastImpact({
    domainCount,
    expectedScripts: Number(input.expectedScripts) || 0,
    cookieBehavior: input.cookieBehavior,
    storageUse: input.storageUse,
    consentRequirement: input.consentRequirement,
    organizationKnown: Boolean(input.organization?.trim()),
  });
  const result = db.prepare("INSERT INTO impact_forecasts (name, service_category, domains, expected_scripts, cookie_behavior, storage_use, consent_requirement, page_locations, organization, data_purpose, forecast_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)").run(
    input.name.slice(0, 120), input.serviceCategory.slice(0, 80), input.domains.slice(0, 1000),
    Math.max(0, Number(input.expectedScripts) || 0), input.cookieBehavior.slice(0, 40), input.storageUse.slice(0, 40),
    input.consentRequirement.slice(0, 100), input.pageLocations?.slice(0, 500) || null, input.organization?.slice(0, 120) || null,
    input.dataPurpose.slice(0, 1000), JSON.stringify(forecast), now(),
  );
  return { id: Number(result.lastInsertRowid), forecast };
}

export function listJourneys() { return (db.prepare("SELECT * FROM user_journeys ORDER BY updated_at DESC").all() as Row[]).map((row) => ({ ...row, steps: JSON.parse(String(row.steps_json)) })); }
export function createJourney(name: string, startUrl: string, steps: string[]) {
  if (!name.trim() || !startUrl.startsWith("http")) throw new Error("Journey name and public start URL are required.");
  if (!steps.length) throw new Error("Add at least one safe navigation step.");
  const blockedWords = /(submit|purchase|buy|login|password|delete|pay)/i;
  if (steps.some((step) => blockedWords.test(step))) throw new Error("Journeys cannot submit forms, purchase, log in, or perform destructive actions.");
  const time = now();
  const result = db.prepare("INSERT INTO user_journeys (name, start_url, steps_json, safety_note, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)").run(
    name.slice(0, 120), startUrl.slice(0, 1000), JSON.stringify(steps.map((step) => step.slice(0, 200))),
    "Definition only. A reviewed runner must restrict actions to safe public navigation and non-submitting clicks.", time, time,
  );
  return Number(result.lastInsertRowid);
}

export function listConsentEvaluations() { return db.prepare("SELECT * FROM consent_evaluations ORDER BY created_at DESC").all(); }
export function createConsentEvaluation(input: { scanId?: number; acceptSteps: number; rejectSteps: number; rejectVisible: boolean; granular: boolean; revisitAvailable: boolean; defaultSelections: boolean; evaluatorNote?: string }) {
  let result = "Balanced";
  if (!input.rejectVisible) result = "Rejection difficult to locate";
  else if (input.rejectSteps > input.acceptSteps + 1) result = "Acceptance emphasized";
  else if (!input.granular) result = "Granularity limited";
  if (!Number.isFinite(input.acceptSteps) || !Number.isFinite(input.rejectSteps)) result = "Result inconclusive";
  const inserted = db.prepare("INSERT INTO consent_evaluations (scan_id, accept_steps, reject_steps, reject_visible, granular, revisit_available, default_selections, evaluator_note, result, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)").run(
    input.scanId || null, Math.max(0, input.acceptSteps), Math.max(0, input.rejectSteps), input.rejectVisible ? 1 : 0,
    input.granular ? 1 : 0, input.revisitAvailable ? 1 : 0, input.defaultSelections ? 1 : 0,
    input.evaluatorNote?.slice(0, 500) || null, result, now(),
  );
  return { id: Number(inserted.lastInsertRowid), result };
}

export function maturityModel(scanId: number) {
  const report = requiredReport(scanId);
  const inventory = serviceInventory().filter((item) => report.services.some((service) => service.domain === item.domain));
  const requirements = evaluateRequirements(scanId);
  const dimensions = [
    { name: "Service inventory", level: inventory.length === report.services.length ? 2 : 1, evidence: `${inventory.length}/${report.services.length} services inventoried` },
    { name: "Ownership", level: inventory.length && inventory.every((item) => item.owner) ? 3 : inventory.some((item) => item.owner) ? 2 : 1, evidence: `${inventory.filter((item) => item.owner).length}/${inventory.length} services owned` },
    { name: "Consent governance", level: listConsentEvaluations().length ? 2 : 1, evidence: `${listConsentEvaluations().length} interface evaluations` },
    { name: "Monitoring", level: listReports().filter((item) => item.target_domain === report.target_domain).length > 1 ? 3 : 1, evidence: `${listReports().filter((item) => item.target_domain === report.target_domain).length} case versions` },
    { name: "Requirement testing", level: requirements.status === "passed" ? 3 : requirements.results.length ? 2 : 1, evidence: `${requirements.results.length} requirements evaluated` },
  ];
  const labels = ["Unmanaged", "Unmanaged", "Documented", "Controlled", "Monitored", "Continuously improved"];
  return { scan_id: scanId, dimensions: dimensions.map((item) => ({ ...item, label: labels[item.level], next_action: item.level < 2 ? `Document ${item.name.toLowerCase()}` : item.level < 3 ? `Add controls for ${item.name.toLowerCase()}` : "Preserve and verify" })), disclaimer: "Maturity describes observable process evidence, not legal compliance." };
}

export function incidentForScan(scanId: number) {
  const report = requiredReport(scanId);
  const versions = listReports().filter((item) => item.target_domain === report.target_domain).sort((left, right) => new Date(left.created_at || 0).getTime() - new Date(right.created_at || 0).getTime());
  const firstSeen = new Map<string, ScanResult>();
  for (const version of versions) for (const service of version.services) if (!firstSeen.has(service.domain)) firstSeen.set(service.domain, version);
  return {
    target: report.target_domain,
    services: report.services.map((service) => ({
      service: service.name, domain: service.domain,
      first_seen_scan: firstSeen.get(service.domain)?.id,
      first_seen_at: firstSeen.get(service.domain)?.created_at,
      initiating_script: report.scripts.find((script) => script.includes(service.domain)) || "Not captured",
      consent_state: report.consent.status,
      persistence: versions.filter((version) => version.services.some((item) => item.domain === service.domain)).length,
      evidence_events: report.events.filter((event) => event.destination === service.domain).length,
    })),
    versions: versions.map((version) => ({ id: version.id, created_at: version.created_at, services: version.summary.third_parties })),
  };
}

export function architectureComparison(leftId: number, rightId: number) {
  const left = requiredReport(leftId);
  const right = requiredReport(rightId);
  const architecture = (report: ScanResult) => ({
    scan_id: report.id,
    website: report.target_domain,
    direct_dependencies: report.services.length,
    first_party_requests: report.first_party.reduce((sum, item) => sum + item.requests, 0),
    third_party_requests: report.services.reduce((sum, item) => sum + item.requests, 0),
    dependency_depth: report.services.length ? 1 : 0,
    organization_concentration_proxy: report.services.length ? Math.round(Math.max(...report.services.map((item) => item.requests)) / Math.max(1, report.services.reduce((sum, item) => sum + item.requests, 0)) * 100) : 0,
    optional_services: necessityForScan(report.id || 0).filter((item) => ["Optional", "Likely unnecessary"].includes(item.verdict)).length,
    storage_footprint: report.summary.cookies + report.summary.storage_keys,
    consent_boundary: report.consent.status,
  });
  return { left: architecture(left), right: architecture(right), context: "Architecture comparison explains structural differences; it does not rank legal compliance." };
}

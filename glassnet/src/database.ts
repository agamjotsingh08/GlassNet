// Lightweight local relational storage. Node ships SQLite, so this keeps the
// project easy to run while still giving scans, accounts, jobs, and watch lists
// transactional tables instead of one large JSON document.
import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

const file = path.join(process.cwd(), "data", "glassnet.sqlite");
fs.mkdirSync(path.dirname(file), { recursive: true });
export const db = new DatabaseSync(file);
db.exec("PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL;");

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY, email TEXT NOT NULL UNIQUE, password_hash TEXT NOT NULL,
    created_at TEXT NOT NULL, updated_at TEXT NOT NULL
  ) STRICT;
  CREATE TABLE IF NOT EXISTS sessions (
    id INTEGER PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token_hash TEXT NOT NULL UNIQUE, expires_at TEXT NOT NULL, created_at TEXT NOT NULL
  ) STRICT;
  CREATE TABLE IF NOT EXISTS websites (
    id INTEGER PRIMARY KEY, normalized_origin TEXT NOT NULL UNIQUE, hostname TEXT NOT NULL,
    registered_domain TEXT NOT NULL, title TEXT, first_seen_at TEXT NOT NULL, last_seen_at TEXT NOT NULL
  ) STRICT;
  CREATE TABLE IF NOT EXISTS scans (
    id INTEGER PRIMARY KEY, website_id INTEGER NOT NULL REFERENCES websites(id),
    user_id INTEGER REFERENCES users(id), status TEXT NOT NULL, started_at TEXT,
    completed_at TEXT, scanner_version TEXT NOT NULL, request_count INTEGER NOT NULL DEFAULT 0,
    cookie_count INTEGER NOT NULL DEFAULT 0, storage_count INTEGER NOT NULL DEFAULT 0,
    error_code TEXT, report_json TEXT, created_at TEXT NOT NULL
  ) STRICT;
  CREATE TABLE IF NOT EXISTS scan_jobs (
    id INTEGER PRIMARY KEY, scan_id INTEGER NOT NULL UNIQUE REFERENCES scans(id) ON DELETE CASCADE,
    status TEXT NOT NULL, progress_stage TEXT NOT NULL, attempts INTEGER NOT NULL DEFAULT 0,
    error_code TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
  ) STRICT;
  CREATE TABLE IF NOT EXISTS watch_targets (
    id INTEGER PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    website_id INTEGER NOT NULL REFERENCES websites(id) ON DELETE CASCADE, cadence TEXT NOT NULL,
    enabled INTEGER NOT NULL DEFAULT 1, last_checked_at TEXT, next_check_at TEXT, created_at TEXT NOT NULL,
    UNIQUE(user_id, website_id)
  ) STRICT;
  CREATE TABLE IF NOT EXISTS notifications (
    id INTEGER PRIMARY KEY, user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
    type TEXT NOT NULL, message TEXT NOT NULL, read_at TEXT, created_at TEXT NOT NULL
  ) STRICT;
  CREATE TABLE IF NOT EXISTS audit_events (
    id INTEGER PRIMARY KEY, actor_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
    event_type TEXT NOT NULL, object_type TEXT NOT NULL, object_id TEXT, metadata_json TEXT,
    created_at TEXT NOT NULL
  ) STRICT;
  CREATE TABLE IF NOT EXISTS user_feedback (
    id INTEGER PRIMARY KEY, scan_id INTEGER REFERENCES scans(id) ON DELETE SET NULL,
    user_id INTEGER REFERENCES users(id) ON DELETE SET NULL, kind TEXT NOT NULL,
    rating INTEGER, details TEXT, ruleset_version TEXT NOT NULL, ui_version TEXT NOT NULL,
    created_at TEXT NOT NULL
  ) STRICT;
  CREATE TABLE IF NOT EXISTS feature_flags (
    key TEXT PRIMARY KEY, enabled INTEGER NOT NULL DEFAULT 0, description TEXT NOT NULL
  ) STRICT;
  CREATE TABLE IF NOT EXISTS privacy_baselines (
    id INTEGER PRIMARY KEY, website_id INTEGER NOT NULL REFERENCES websites(id) ON DELETE CASCADE,
    scan_id INTEGER NOT NULL REFERENCES scans(id) ON DELETE CASCADE, label TEXT NOT NULL,
    created_at TEXT NOT NULL, UNIQUE(website_id)
  ) STRICT;
  CREATE TABLE IF NOT EXISTS privacy_reviews (
    id INTEGER PRIMARY KEY, base_scan_id INTEGER NOT NULL REFERENCES scans(id),
    candidate_scan_id INTEGER NOT NULL REFERENCES scans(id), status TEXT NOT NULL,
    summary_json TEXT NOT NULL, note TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
  ) STRICT;
  CREATE TABLE IF NOT EXISTS issues (
    id INTEGER PRIMARY KEY, scan_id INTEGER REFERENCES scans(id) ON DELETE SET NULL,
    title TEXT NOT NULL, category TEXT NOT NULL, severity TEXT NOT NULL, evidence TEXT NOT NULL,
    status TEXT NOT NULL, assignee TEXT, due_date TEXT, resolution TEXT, created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  ) STRICT;
  CREATE TABLE IF NOT EXISTS issue_comments (
    id INTEGER PRIMARY KEY, issue_id INTEGER NOT NULL REFERENCES issues(id) ON DELETE CASCADE,
    author TEXT NOT NULL, body TEXT NOT NULL, created_at TEXT NOT NULL
  ) STRICT;
  CREATE TABLE IF NOT EXISTS portfolios (
    id INTEGER PRIMARY KEY, name TEXT NOT NULL, description TEXT, created_at TEXT NOT NULL
  ) STRICT;
  CREATE TABLE IF NOT EXISTS portfolio_websites (
    portfolio_id INTEGER NOT NULL REFERENCES portfolios(id) ON DELETE CASCADE,
    website_id INTEGER NOT NULL REFERENCES websites(id) ON DELETE CASCADE,
    created_at TEXT NOT NULL, PRIMARY KEY(portfolio_id, website_id)
  ) STRICT;
  CREATE TABLE IF NOT EXISTS threshold_rules (
    id INTEGER PRIMARY KEY, name TEXT NOT NULL, rule_type TEXT NOT NULL, operator TEXT NOT NULL,
    value INTEGER NOT NULL, enabled INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL
  ) STRICT;
  CREATE TABLE IF NOT EXISTS public_passports (
    id INTEGER PRIMARY KEY, website_id INTEGER NOT NULL REFERENCES websites(id) ON DELETE CASCADE,
    public_slug TEXT NOT NULL UNIQUE, published INTEGER NOT NULL DEFAULT 0,
    owner_note TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
  ) STRICT;
  CREATE INDEX IF NOT EXISTS scans_website_created ON scans(website_id, created_at DESC);
  CREATE INDEX IF NOT EXISTS scans_user_created ON scans(user_id, created_at DESC);
  CREATE INDEX IF NOT EXISTS scan_jobs_status ON scan_jobs(status, updated_at);
  CREATE INDEX IF NOT EXISTS watch_next_check ON watch_targets(next_check_at);
  CREATE INDEX IF NOT EXISTS issues_status ON issues(status, updated_at DESC);
  CREATE INDEX IF NOT EXISTS reviews_candidate ON privacy_reviews(candidate_scan_id);
`);

const defaults = [
  ["consent_comparison", "Requires a consent-interaction ruleset."],
  ["policy_comparison", "Requires a policy parser and reviewed claim rules."],
  ["webhooks", "Requires a configured delivery endpoint."],
  ["email_alerts", "Requires a configured email provider."],
  ["research_collections", "Available after local account support is enabled."],
];
const insertFlag = db.prepare("INSERT OR IGNORE INTO feature_flags (key, enabled, description) VALUES (?, 0, ?)");
for (const [key, description] of defaults) insertFlag.run(key, description);

const starterRules = [
  ["No unknown domains", "unknown_domains", "max", 0],
  ["Third-party budget", "third_parties", "max", 12],
  ["Cookie budget", "cookies", "max", 20],
];
const insertRule = db.prepare("INSERT INTO threshold_rules (name, rule_type, operator, value, created_at) SELECT ?, ?, ?, ?, ? WHERE NOT EXISTS (SELECT 1 FROM threshold_rules WHERE name=?)");
for (const [name, type, operator, value] of starterRules) {
  insertRule.run(name, type, operator, value, new Date().toISOString(), name);
}

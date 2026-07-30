// GlassNet keeps completed scans in one local SQLite file.
// The database is ignored by Git, so a user's scan history is not published.
import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

const dataFolder = path.join(process.cwd(), "data");
fs.mkdirSync(dataFolder, { recursive: true });

export const db = new DatabaseSync(path.join(dataFolder, "glassnet.sqlite"));
db.exec("PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL;");

db.exec(`
  CREATE TABLE IF NOT EXISTS websites (
    id INTEGER PRIMARY KEY,
    normalized_origin TEXT NOT NULL UNIQUE,
    hostname TEXT NOT NULL,
    registered_domain TEXT NOT NULL,
    title TEXT,
    first_seen_at TEXT NOT NULL,
    last_seen_at TEXT NOT NULL
  ) STRICT;

  CREATE TABLE IF NOT EXISTS scans (
    id INTEGER PRIMARY KEY,
    website_id INTEGER NOT NULL REFERENCES websites(id),
    status TEXT NOT NULL,
    started_at TEXT,
    completed_at TEXT,
    scanner_version TEXT NOT NULL,
    request_count INTEGER NOT NULL DEFAULT 0,
    cookie_count INTEGER NOT NULL DEFAULT 0,
    storage_count INTEGER NOT NULL DEFAULT 0,
    error_code TEXT,
    report_json TEXT,
    created_at TEXT NOT NULL
  ) STRICT;

  CREATE TABLE IF NOT EXISTS scan_jobs (
    id INTEGER PRIMARY KEY,
    scan_id INTEGER NOT NULL UNIQUE REFERENCES scans(id) ON DELETE CASCADE,
    status TEXT NOT NULL,
    progress_stage TEXT NOT NULL,
    attempts INTEGER NOT NULL DEFAULT 0,
    error_code TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  ) STRICT;

  CREATE INDEX IF NOT EXISTS scans_website_created
    ON scans(website_id, created_at DESC);

  CREATE INDEX IF NOT EXISTS scans_status_created
    ON scans(status, created_at DESC);
`);

// This local repository is intentionally small. It is replaceable by a
// relational database repository before a multi-user deployment.
import fs from "node:fs";
import path from "node:path";
import { config } from "./config.js";
import type { ScanResult } from "./types.js";

export function listReports(): ScanResult[] {
  try { return JSON.parse(fs.readFileSync(config.historyFile, "utf8")); } catch { return []; }
}

export function saveReport(report: ScanResult): ScanResult {
  const oldReports = listReports();
  report.id = oldReports.length ? Math.max(...oldReports.map((item) => item.id || 0)) + 1 : 1;
  report.created_at = new Date().toISOString();
  fs.mkdirSync(path.dirname(config.historyFile), { recursive: true });
  fs.writeFileSync(config.historyFile, JSON.stringify([report, ...oldReports].slice(0, 30), null, 2));
  return report;
}

export function findReport(id: number): ScanResult | undefined { return listReports().find((item) => item.id === id); }

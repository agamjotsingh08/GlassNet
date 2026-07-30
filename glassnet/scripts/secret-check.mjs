// A lightweight repository check for common secret formats.
// It reports file paths and pattern names, never the matched secret value.
import fs from "node:fs";
import { execFileSync } from "node:child_process";
import path from "node:path";

const ignoredFiles = new Set(["package-lock.json", ".env", "secret-check.mjs"]);
const patterns = [
  ["private key", /BEGIN (RSA|OPENSSH|EC) PRIVATE KEY/],
  ["GitHub token", /gh[pousr]_[A-Za-z0-9_]{30,}/],
  ["Google API key", /AIza[0-9A-Za-z_-]{30,}/],
  ["AWS access key", /AKIA[0-9A-Z]{16}/],
  ["Stripe secret key", /sk_(live|test)_[0-9A-Za-z]{20,}/],
  ["Slack token", /xox[baprs]-[0-9A-Za-z-]{10,}/],
  ["bearer credential", /authorization\s*[:=]\s*["']Bearer\s+[A-Za-z0-9._~-]{16,}/i],
  ["credential in URL", /https?:\/\/[^/\s:@]+:[^/\s@]+@/i],
  ["hard-coded password", /password\s*[:=]\s*["'][^"' ]{8,}/i],
  ["assigned secret", /(api[_-]?key|access[_-]?token|client[_-]?secret|jwt[_-]?secret)\s*[:=]\s*["'][^"' ]{12,}/i],
];

const findings = [];
const repositoryRoot = execFileSync("git", ["rev-parse", "--show-toplevel"], { encoding: "utf8" }).trim();
const trackedFiles = execFileSync("git", ["-C", repositoryRoot, "ls-files", "--cached", "--others", "--exclude-standard"], { encoding: "utf8" })
  .split(/\r?\n/)
  .filter(Boolean)
  .filter((file) => !ignoredFiles.has(file.split(/[\\/]/).pop()));

for (const file of trackedFiles) {
  const fullPath = path.join(repositoryRoot, file);
  if (!fs.existsSync(fullPath) || !fs.statSync(fullPath).isFile()) continue;
  const content = fs.readFileSync(fullPath, "utf8");
  for (const [name, pattern] of patterns) {
    if (pattern.test(content)) findings.push(`${file}: possible ${name}`);
  }
}
if (findings.length) {
  console.error(findings.join("\n"));
  process.exit(1);
}
console.log("No common secret patterns found in tracked project files.");

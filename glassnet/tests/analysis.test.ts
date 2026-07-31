import assert from "node:assert/strict";
import test from "node:test";
import { analyzeReport, riskRules } from "../src/analysis.js";

function report(overrides: Record<string, unknown> = {}) {
  return {
    status: "completed", mode: "full", scanner_version: "test", url: "https://example.com/",
    site_name: "Example", target_domain: "example.com", score: 95, score_label: "Low exposure",
    notice: "Test", limitations: [], summary: { requests: 1, third_parties: 0, cookies: 0, third_party_cookies: 0, storage_keys: 0, scripts: 0 },
    categories: {}, services: [], first_party: [], cookies: [], storage: [], scripts: [], events: [],
    requests: [{ id: 1, domain: "example.com", url: "https://example.com/", method: "GET", resource_type: "document", party: "First party", category: "Documents", initiator: "https://example.com/", status: 200, transferred_bytes: 100, timestamp_ms: 5, consent_state: "Not tested", confidence: "verified", classification_method: "Registered-domain match" }],
    security_headers: { "content-security-policy": "default-src 'self'", "strict-transport-security": "max-age=100", "x-content-type-options": "nosniff", "referrer-policy": "strict-origin", "permissions-policy": "camera=()", "cross-origin-opener-policy": "same-origin", "cross-origin-resource-policy": "same-origin", "cross-origin-embedder-policy": "require-corp" },
    final_url: "https://example.com/", redirect_chain: [], iframes: [], forms: [], permissions: [], downloads: [],
    script_signals: { suspicious_obfuscation: 0, miner_signature: false, details: [] },
    coverage: { page_loaded: true, duration_ms: 2000, redirects_followed: 0, checks_completed: 14, checks_unavailable: 0 },
    graph: { nodes: [], edges: [] }, ...overrides,
  } as any;
}

test("risk summary supports low, some concerns, high, and unable results", () => {
  assert.equal(analyzeReport(report()).risk.level, "Low observed risk");
  assert.equal(analyzeReport(report({ requests: [...report().requests, { ...report().requests[0], id: 2, domain: "unknown.test", url: "https://unknown.test/a.js", resource_type: "script", party: "Third party", category: "Unknown", confidence: "unknown" }] })).risk.level, "Some concerns found");
  assert.equal(analyzeReport(report({ forms: [{ action: "http://other.test/send", action_domain: "other.test", method: "POST", secure: false, third_party: true, sensitive_fields: ["password"], autocomplete: [] }] })).risk.level, "High observed risk");
  assert.equal(analyzeReport(report({ requests: [], coverage: { ...report().coverage, page_loaded: false } })).risk.level, "Unable to determine");
});

test("conflicting signals preserve the serious observed result", () => {
  const result = analyzeReport(report({ downloads: [{ url: "https://example.com/file", suggested_filename: "file.bin", timestamp_ms: 1, cancelled: true }] }));
  assert.equal(result.risk.level, "High observed risk");
  assert.ok(result.risk.summary.includes("strong evidence"));
});

test("low-confidence unknown data does not create an unsupported verdict", () => {
  const result = analyzeReport(report({ cookies: [{ name: "mystery", domain: "example.com", path: "/", secure: true, httpOnly: false, sameSite: "Lax", session: true, firstParty: true, expires_at: null, consent_state: "Not tested", purpose: "Unknown", purpose_category: "Unknown", purpose_confidence: "Unknown", classification_source: "No match", security_notes: [] }] }));
  assert.equal(result.risk.level, "Low observed risk");
});

test("security checklist covers transport, redirects, frames, permissions, forms, downloads, and scripts", () => {
  const base = report();
  const result = analyzeReport(report({
    requests: [...base.requests, { ...base.requests[0], id: 2, url: "http://cdn.test/a.js", domain: "cdn.test", resource_type: "script", party: "Third party", category: "Unknown", confidence: "unknown" }],
    security_headers: {}, redirect_chain: ["https://one.test", "https://two.test", "https://three.test", "https://four.test"],
    iframes: [{ url: "https://frame.test", domain: "frame.test", third_party: true, hidden: true, sandbox: "" }],
    permissions: [{ name: "camera", requested: true, policy_declared: false, scanner_decision: "Not granted" }],
    forms: [{ action: "http://forms.test", action_domain: "forms.test", action_missing: false, method: "POST", secure: false, third_party: true, sensitive_fields: ["email"], autocomplete: [] }],
    downloads: [{ url: "https://example.com/a", suggested_filename: "a.bin", timestamp_ms: 1, cancelled: true }],
    script_signals: { suspicious_obfuscation: 1, miner_signature: true, details: ["two supporting signals"] },
  }));
  for (const id of ["HTTPS", "MIXED_CONTENT", "REDIRECTS", "IFRAMES", "PERMISSIONS", "FORMS", "DOWNLOADS", "OBFUSCATION", "MINING"]) {
    assert.ok(result.security_checks.some((item) => item.id === id));
  }
  assert.ok(result.security_checks.some((item) => item.id === "HEADER_CONTENT_SECURITY_POLICY" && item.status === "Needs review"));
});

test("completed checks use passed or review states instead of not observed", () => {
  const result = analyzeReport(report({ security_headers: {} }));
  assert.ok(!result.security_checks.some((item) => item.status === "Not observed"));
  assert.ok(result.security_checks.some((item) => item.id === "FORMS" && item.status === "Passed"));
  assert.ok(result.security_checks.some((item) => item.id === "COOKIE_SECURITY" && item.status === "Passed"));
});

test("minified code alone is excluded from the obfuscation rule", () => {
  const result = analyzeReport(report({ script_signals: { suspicious_obfuscation: 0, miner_signature: false, details: ["long compact file only"] } }));
  assert.ok(!result.findings.some((item) => item.rule_id === "OBFUSCATED_INLINE_SCRIPT"));
});

test("every rule documents evidence, exclusions, and beginner wording", () => {
  for (const rule of riskRules) {
    assert.ok(rule.required_evidence);
    assert.ok(rule.exclusions);
    assert.ok(rule.beginner);
  }
  const result = analyzeReport(report({ final_url: "http://example.com/" }));
  for (const finding of result.findings) {
    assert.ok(finding.evidence);
    assert.ok(finding.beginner_explanation);
    assert.doesNotMatch(finding.beginner_explanation, /completely safe|definitely malicious|guaranteed secure/i);
  }
});

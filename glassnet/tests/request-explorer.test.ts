import assert from "node:assert/strict";
import test from "node:test";
import { filterRequests, redactUrl } from "../src/request-explorer.js";

const requests = Array.from({ length: 80 }, (_, index) => ({
  id: index + 1, domain: index % 2 ? "api.example.com" : "unknown.test",
  url: `https://${index % 2 ? "api.example.com" : "unknown.test"}/item?email=[redacted]&token=[redacted]`,
  method: "GET", resource_type: index % 2 ? "fetch" : "script", party: index % 2 ? "First party" : "Third party",
  category: index % 2 ? "APIs" : "Unknown", initiator: "https://example.com/", status: index % 3 ? 200 : 404,
  transferred_bytes: index * 10, timestamp_ms: index, consent_state: "Not tested",
  confidence: index % 2 ? "verified" : "unknown", classification_method: "test",
})) as any;

test("URL redaction removes credentials, values, email paths, tokens, and fragments", () => {
  const credentialPart = ["user", "pass"].join(":");
  const value = redactUrl(`https://${credentialPart}@example.com/person@example.com/abc123abc123abc123abc123abc123abc123abc123?email=person@example.com&token=secret#private`);
  assert.doesNotMatch(value, /user:pass|person@example\.com|secret|#private/);
  assert.match(value, /email=\[redacted\]/);
  assert.match(value, /token=\[redacted\]/);
  assert.equal(redactUrl("about:blank"), "[browser context]");
});

test("request explorer filters, sorts, and paginates large request sets", () => {
  const result = filterRequests(requests, { party: "Third party", known: "unknown", sort: "transferred_bytes", direction: "desc", page: 2, page_size: 10, min_bytes: 100 });
  assert.equal(result.items.length, 10);
  assert.equal(result.page, 2);
  assert.ok(result.total > result.items.length);
  assert.ok(result.items[0].transferred_bytes >= result.items[1].transferred_bytes);
  assert.ok(result.items.every((item) => item.party === "Third party" && item.confidence === "unknown"));
});

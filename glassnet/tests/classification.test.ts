import test from "node:test";
import assert from "node:assert/strict";
import { classify, mainDomain, scoreLabel } from "../src/classification.js";

test("classification recognizes a known analytics service", () => {
  const service = classify("www.google-analytics.com");
  assert.equal(service.name, "Google Analytics");
  assert.equal(service.category, "Analytics");
  assert.equal(service.confidence, "verified");
});

test("classification marks an unmatched domain as unknown", () => {
  assert.equal(classify("example-unknown.test").confidence, "unknown");
});

test("domain parsing keeps a registered domain", () => {
  assert.equal(mainDomain("assets.example.co.uk"), "example.co.uk");
});

test("privacy labels have clear score boundaries", () => {
  assert.equal(scoreLabel(85), "Low exposure");
  assert.equal(scoreLabel(40), "High exposure");
});

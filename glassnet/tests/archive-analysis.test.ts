import test from "node:test";
import assert from "node:assert/strict";
import { forecastImpact, necessityVerdict, requirementStatus } from "../src/archive-analysis.js";

test("necessity analysis does not call every third party unnecessary", () => {
  assert.equal(necessityVerdict("Authentication", true, "verified"), "Essential");
  assert.equal(necessityVerdict("Analytics", false, "likely"), "Optional");
  assert.equal(necessityVerdict("Unknown", null, "unknown"), "Unknown");
});

test("requirements distinguish failed and inconclusive evidence", () => {
  assert.equal(requirementStatus(2, 0), "failed");
  assert.equal(requirementStatus(0, 0), "passed");
  assert.equal(requirementStatus(null, 0), "inconclusive");
});

test("impact forecasts are clearly labeled and deterministic", () => {
  const result = forecastImpact({
    domainCount: 2,
    expectedScripts: 3,
    cookieBehavior: "persistent",
    storageUse: "local",
    consentRequirement: "required",
    organizationKnown: false,
  });
  assert.equal(result.label, "Forecast — not an observed scan");
  assert.equal(result.third_party_change, 2);
  assert.equal(result.privacy_debt_change, 3);
});

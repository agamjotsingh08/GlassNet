import assert from "node:assert/strict";
import test from "node:test";
import { classifyCookie, cookieSecurityNotes } from "../src/cookie-knowledge.js";

const cookie = (name: string, overrides = {}) => ({ name, domain: "example.com", secure: true, httpOnly: true, sameSite: "Lax", session: true, firstParty: true, ...overrides });

test("cookie classifier returns known, likely, and unknown purposes", () => {
  assert.equal(classifyCookie(cookie("_ga")).purpose_confidence, "Known");
  assert.equal(classifyCookie(cookie("session_id")).purpose_confidence, "Likely");
  assert.equal(classifyCookie(cookie("mystery_cookie")).purpose_confidence, "Unknown");
});

test("cookie security rules are contextual", () => {
  assert.ok(cookieSecurityNotes(cookie("session_id", { secure: false }), true).some((item) => item.includes("Secure")));
  assert.ok(cookieSecurityNotes(cookie("session_id", { httpOnly: false }), true).some((item) => item.includes("HttpOnly")));
  assert.ok(cookieSecurityNotes(cookie("display_preference", { secure: false, httpOnly: false }), true).length === 0);
  assert.ok(cookieSecurityNotes(cookie("display_preference", { sameSite: "None", secure: false }), true).some((item) => item.includes("SameSite=None")));
});

test("cookie classification never returns or accepts a cookie value", () => {
  const result = classifyCookie(cookie("_ga"));
  assert.ok(!("value" in result));
  assert.doesNotMatch(JSON.stringify(result), /secret-cookie-value/);
});

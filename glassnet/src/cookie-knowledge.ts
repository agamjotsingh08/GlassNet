import type { CookieInfo } from "./types.js";

export const COOKIE_CLASSIFIER_VERSION = "2026.07.1";

type CookieInput = Pick<CookieInfo, "name" | "domain" | "secure" | "httpOnly" | "sameSite" | "session" | "firstParty">;
type CookiePurpose = Pick<CookieInfo, "purpose" | "purpose_category" | "purpose_confidence" | "classification_source">;

const reviewedCookies = [
  {
    names: [/^_ga$/i],
    purpose: "Used by Google Analytics to distinguish users.",
    category: "Analytics",
    source: "https://support.google.com/analytics/answer/11397207 — reviewed 2026-07-31",
  },
  {
    names: [/^_ga_[a-z0-9]+$/i],
    purpose: "Used by Google Analytics to keep session state.",
    category: "Analytics",
    source: "https://support.google.com/analytics/answer/11397207 — reviewed 2026-07-31",
  },
  {
    names: [/^cf_clearance$/i],
    purpose: "Stores proof that a Cloudflare browser challenge was passed.",
    category: "Security",
    source: "https://developers.cloudflare.com/cloudflare-challenges/concepts/clearance/ — reviewed 2026-07-31",
  },
  {
    names: [/^__cf_bm$/i],
    purpose: "Supports Cloudflare bot-management checks.",
    category: "Security",
    source: "https://developers.cloudflare.com/fundamentals/reference/policies-compliances/cloudflare-cookies/ — reviewed 2026-07-31",
  },
];

const likelyPatterns = [
  { pattern: /^(session|session_id|sid|phpsessid|jsessionid)$/i, purpose: "Likely keeps the visitor's current website session active.", category: "Session management", source: "Exact session-name convention" },
  { pattern: /^(csrf|csrf_token|csrftoken|xsrf|xsrf_token)$/i, purpose: "Likely helps protect forms from cross-site request-forgery attacks.", category: "Security", source: "Exact anti-forgery name convention" },
  { pattern: /^(consent|cookie_consent|cookieconsent|privacy_preferences)$/i, purpose: "Likely remembers the visitor's privacy or cookie preference.", category: "Preferences", source: "Exact preference-name convention" },
  { pattern: /^(auth|auth_token|access_token|id_token)$/i, purpose: "May support authentication or an active signed-in session.", category: "Authentication", source: "Exact authentication-name convention" },
];

export function classifyCookie(input: CookieInput): CookiePurpose {
  for (const definition of reviewedCookies) {
    if (definition.names.some((pattern) => pattern.test(input.name))) {
      return {
        purpose: definition.purpose,
        purpose_category: definition.category,
        purpose_confidence: "Known",
        classification_source: `${definition.source}; classifier ${COOKIE_CLASSIFIER_VERSION}`,
      };
    }
  }

  for (const rule of likelyPatterns) {
    if (rule.pattern.test(input.name)) {
      return {
        purpose: rule.purpose,
        purpose_category: rule.category,
        purpose_confidence: "Likely",
        classification_source: `${rule.source}; classifier ${COOKIE_CLASSIFIER_VERSION}`,
      };
    }
  }

  return {
    purpose: "GlassNet could not confidently determine this cookie's purpose.",
    purpose_category: "Unknown",
    purpose_confidence: "Unknown",
    classification_source: `No reviewed match; classifier ${COOKIE_CLASSIFIER_VERSION}`,
  };
}

export function cookieSecurityNotes(cookie: CookieInput, pageUsesHttps: boolean): string[] {
  const notes: string[] = [];
  const sensitive = ["Session management", "Authentication"].includes(classifyCookie(cookie).purpose_category);
  if (pageUsesHttps && sensitive && !cookie.secure) notes.push("A session-related cookie does not use Secure.");
  if (sensitive && !cookie.httpOnly) notes.push("A session-related cookie does not use HttpOnly.");
  if (cookie.sameSite === "None" && !cookie.secure) notes.push("SameSite=None is used without Secure.");
  return notes;
}

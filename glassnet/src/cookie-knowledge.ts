import type { CookieInfo } from "./types.js";

export const COOKIE_CLASSIFIER_VERSION = "2026.07.2";

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
  { pattern: /^(_gid|_gat|_gat_[a-z0-9_-]+)$/i, purpose: "Likely supports website audience measurement or controls analytics request frequency.", category: "Analytics", source: "Analytics-name convention" },
  { pattern: /^(_fbp|_fbc)$/i, purpose: "Likely supports advertising measurement associated with Meta services.", category: "Advertising", source: "Advertising-name convention" },
  { pattern: /^(visitor|visitor_id|uid|user_id|device_id|browser_id)$/i, purpose: "Likely distinguishes this browser for site functionality, measurement, or returning-visitor recognition.", category: "Visitor recognition", source: "Exact visitor-identifier name convention" },
  { pattern: /^(?:[a-z0-9]+_)?(?:pref|prefs|preference|preferences|settings|theme|language|lang|locale|timezone|tz)(?:_[a-z0-9]+)?$/i, purpose: "Likely remembers a display, language, or website preference.", category: "Preferences", source: "Conservative preference-name convention" },
  { pattern: /^(cart|basket|shopping_cart|checkout_session)$/i, purpose: "Likely remembers shopping-cart or checkout state.", category: "Shopping", source: "Exact shopping-state name convention" },
  { pattern: /^(ab|ab_test|experiment|variant|bucket|edgebucket)$/i, purpose: "Likely assigns the browser to traffic routing, an experiment, or a website variant.", category: "Routing or experimentation", source: "Exact experiment and routing-name convention" },
  { pattern: /^(intercom-id|intercom-session|intercom-device-id)(-[a-z0-9]+)?$/i, purpose: "Likely supports a customer-help chat session or recognizes the browser for that service.", category: "Customer support", source: "Customer-support cookie-name convention" },
  { pattern: /^(__stripe_mid|__stripe_sid|m|private_machine_identifier)$/i, purpose: "Likely supports payment processing or fraud prevention.", category: "Payments", source: "Payment-service cookie-name convention" },
  { pattern: /^(csv)$/i, purpose: "Likely stores a small website preference, version marker, or client state. The short name does not reveal a more specific purpose.", category: "Site functionality", source: "Exact short-name rule with first-party context" },
];

export function classifyCookie(input: CookieInput): CookiePurpose {
  if (!input.name.trim() || !input.domain.trim()) {
    return {
      purpose: "GlassNet could not determine a purpose because the cookie name or domain was unavailable.",
      purpose_category: "Unknown",
      purpose_confidence: "Unknown",
      classification_source: `Incomplete cookie metadata; classifier ${COOKIE_CLASSIFIER_VERSION}`,
    };
  }
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

  if (input.httpOnly && input.session) return {
    purpose: "Likely keeps temporary session or security state that page JavaScript does not need to read.",
    purpose_category: "Session management",
    purpose_confidence: "Likely",
    classification_source: `HttpOnly session-cookie context; classifier ${COOKIE_CLASSIFIER_VERSION}`,
  };
  if (input.firstParty && input.session) return {
    purpose: "Likely keeps temporary state needed while the visitor uses this website.",
    purpose_category: "Session management",
    purpose_confidence: "Likely",
    classification_source: `First-party session context; classifier ${COOKIE_CLASSIFIER_VERSION}`,
  };
  if (input.firstParty) return {
    purpose: "Likely remembers a website preference, browser state, or returning-visitor marker.",
    purpose_category: "Site functionality",
    purpose_confidence: "Likely",
    classification_source: `First-party persistent-cookie context; classifier ${COOKIE_CLASSIFIER_VERSION}`,
  };
  return {
    purpose: input.session
      ? "Likely keeps temporary state for an external service used by the page."
      : "Likely helps an external service remember this browser, provide functionality, or measure activity.",
    purpose_category: "External service",
    purpose_confidence: "Likely",
    classification_source: `Third-party cookie context; classifier ${COOKIE_CLASSIFIER_VERSION}`,
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

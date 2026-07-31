import { mainDomain } from "./classification.js";
import type { Finding, RiskSummary, ScanResult, SecurityCheck } from "./types.js";

export const RULESET_VERSION = "2026.07.1";

type AnalysisInput = Omit<ScanResult, "findings" | "security_checks" | "risk">;
type RuleMatch = { evidence: string; limitation?: string };
type Rule = {
  id: string;
  name: string;
  category: string;
  severity: Finding["severity"];
  confidence: Finding["confidence"];
  required_evidence: string;
  exclusions: string;
  explanation: string;
  beginner: string;
  remediation: string;
  evaluate: (report: AnalysisInput) => RuleMatch | undefined;
};

const isHttps = (value: string) => value.startsWith("https://");
const isSensitiveCookie = (category: string) => ["Session management", "Authentication"].includes(category);

export const riskRules: Rule[] = [
  {
    id: "HTTP_FINAL_PAGE", name: "Final page does not use HTTPS", category: "Transport", severity: "high", confidence: "high",
    required_evidence: "The final navigation URL uses HTTP.", exclusions: "Local targets are blocked and are not evaluated.",
    explanation: "The final page was delivered without HTTPS encryption.", beginner: "The connection to the final page was not encrypted, so information travelling between the browser and website could be easier to interfere with.",
    remediation: "Redirect all public traffic to HTTPS and keep the final destination on HTTPS.",
    evaluate: (report) => !isHttps(report.final_url) ? { evidence: `Final URL: ${report.final_url}` } : undefined,
  },
  {
    id: "MIXED_ACTIVE_CONTENT", name: "Active mixed content observed", category: "Transport", severity: "high", confidence: "high",
    required_evidence: "An HTTPS page requested an HTTP script, stylesheet, frame, fetch, or XHR resource.", exclusions: "Does not apply when the final page itself uses HTTP.",
    explanation: "An active page resource used an unencrypted HTTP connection.", beginner: "Part of the page's working code was loaded without encryption, which can make that resource easier to alter in transit.",
    remediation: "Load scripts, styles, frames, and API requests through HTTPS.",
    evaluate: (report) => {
      if (!isHttps(report.final_url)) return undefined;
      const items = report.requests.filter((item) => item.url.startsWith("http://") && ["script", "stylesheet", "document", "fetch", "xhr"].includes(item.resource_type));
      return items.length ? { evidence: `${items.length} active HTTP request(s) on an HTTPS page.` } : undefined;
    },
  },
  {
    id: "MIXED_PASSIVE_CONTENT", name: "Passive mixed content observed", category: "Transport", severity: "medium", confidence: "high",
    required_evidence: "An HTTPS page requested an HTTP image, media, or font resource.", exclusions: "Does not apply when the final page itself uses HTTP.",
    explanation: "A passive page resource used an unencrypted HTTP connection.", beginner: "An image, font, or media file was loaded without encryption. This is usually less dangerous than an insecure script, but it still weakens the page's protection.",
    remediation: "Serve every page resource through HTTPS.",
    evaluate: (report) => {
      if (!isHttps(report.final_url)) return undefined;
      const items = report.requests.filter((item) => item.url.startsWith("http://") && ["image", "media", "font"].includes(item.resource_type));
      return items.length ? { evidence: `${items.length} passive HTTP request(s) on an HTTPS page.` } : undefined;
    },
  },
  {
    id: "CSP_MISSING", name: "Content Security Policy not observed", category: "Headers", severity: "low", confidence: "high",
    required_evidence: "The observed main response has no Content-Security-Policy header.", exclusions: "Report-only policies and protections delivered outside the captured response may not be visible.",
    explanation: "The main response did not include a Content-Security-Policy header.", beginner: "GlassNet did not see a browser rule that limits where page code and content may come from. Missing this header alone does not prove the site is insecure.",
    remediation: "Define and test a Content-Security-Policy appropriate for the website.",
    evaluate: (report) => !report.security_headers["content-security-policy"] ? { evidence: "Content-Security-Policy was absent from the captured main response." } : undefined,
  },
  {
    id: "HSTS_MISSING", name: "HSTS not observed", category: "Headers", severity: "low", confidence: "high",
    required_evidence: "The final page uses HTTPS and the main response has no Strict-Transport-Security header.", exclusions: "Does not apply to an HTTP final page; preload status is not checked.",
    explanation: "The HTTPS response did not include Strict-Transport-Security.", beginner: "GlassNet did not see an instruction telling browsers to keep using HTTPS on future visits. Missing this header alone does not prove the site is insecure.",
    remediation: "Consider HSTS after confirming the whole site and required subdomains support HTTPS.",
    evaluate: (report) => isHttps(report.final_url) && !report.security_headers["strict-transport-security"] ? { evidence: "Strict-Transport-Security was absent from the captured HTTPS response." } : undefined,
  },
  {
    id: "UNKNOWN_THIRD_PARTY_SCRIPT", name: "Unknown third-party scripts", category: "Third parties", severity: "medium", confidence: "high",
    required_evidence: "A third-party script request has an unknown domain classification.", exclusions: "First-party scripts and classified services are excluded.",
    explanation: "The page loaded executable code from an external domain GlassNet could not classify.", beginner: "The website loaded code from another service, but GlassNet could not confidently identify who operates it or why it is needed.",
    remediation: "Confirm the owner and purpose of each unknown script domain.",
    evaluate: (report) => {
      const items = report.requests.filter((item) => item.resource_type === "script" && item.party === "Third party" && item.confidence === "unknown");
      return items.length ? { evidence: `${items.length} unknown third-party script request(s).` } : undefined;
    },
  },
  {
    id: "EXTENSIVE_TRACKING", name: "Extensive tracking activity", category: "Tracking", severity: "medium", confidence: "high",
    required_evidence: "At least three classified analytics, behavior-analytics, or advertising services are observed.", exclusions: "Unknown domains do not count toward this rule.",
    explanation: "Several independently classified tracking services were contacted.", beginner: "The page appears to use several outside services to measure visitors or advertising activity.",
    remediation: "Review whether every tracking service is necessary and correctly disclosed.",
    evaluate: (report) => {
      const trackers = report.services.filter((service) => ["Analytics", "Behavior analytics", "Advertising"].includes(service.category));
      return trackers.length >= 3 ? { evidence: `${trackers.length} classified tracking services were observed.` } : undefined;
    },
  },
  {
    id: "SESSION_COOKIE_NO_SECURE", name: "Session-related cookie missing Secure", category: "Cookies", severity: "high", confidence: "medium",
    required_evidence: "HTTPS page, session/authentication cookie classification, and Secure=false.", exclusions: "Preference and analytics cookies are excluded.",
    explanation: "A likely session-related cookie did not use the Secure attribute.", beginner: "The cookie may be allowed over an unencrypted connection. For session-related cookies, this can increase exposure if the site is accessed insecurely.",
    remediation: "Use Secure on session and authentication cookies served by HTTPS sites.",
    evaluate: (report) => {
      const items = report.cookies.filter((cookie) => isSensitiveCookie(cookie.purpose_category) && !cookie.secure && isHttps(report.final_url));
      return items.length ? { evidence: `${items.length} session-related cookie(s) without Secure.` } : undefined;
    },
  },
  {
    id: "SESSION_COOKIE_NO_HTTPONLY", name: "Session-related cookie missing HttpOnly", category: "Cookies", severity: "medium", confidence: "medium",
    required_evidence: "Session/authentication cookie classification and HttpOnly=false.", exclusions: "Cookies that are not classified as session or authentication are excluded.",
    explanation: "A likely session-related cookie could be read by page JavaScript.", beginner: "Page scripts may be able to read this session-related cookie. HttpOnly can reduce that exposure when JavaScript access is not required.",
    remediation: "Use HttpOnly for session cookies unless browser JavaScript genuinely needs access.",
    evaluate: (report) => {
      const items = report.cookies.filter((cookie) => isSensitiveCookie(cookie.purpose_category) && !cookie.httpOnly);
      return items.length ? { evidence: `${items.length} session-related cookie(s) without HttpOnly.` } : undefined;
    },
  },
  {
    id: "SAMESITE_NONE_WITHOUT_SECURE", name: "SameSite=None cookie missing Secure", category: "Cookies", severity: "high", confidence: "high",
    required_evidence: "Cookie has SameSite=None and Secure=false.", exclusions: "Other SameSite modes are excluded.",
    explanation: "A cross-site cookie used SameSite=None without Secure.", beginner: "This cookie is configured for cross-site use but is missing the encryption-only protection normally required with that setting.",
    remediation: "Pair SameSite=None with Secure.",
    evaluate: (report) => {
      const items = report.cookies.filter((cookie) => cookie.sameSite === "None" && !cookie.secure);
      return items.length ? { evidence: `${items.length} SameSite=None cookie(s) without Secure.` } : undefined;
    },
  },
  {
    id: "LONG_REDIRECT_CHAIN", name: "Long redirect chain", category: "Navigation", severity: "medium", confidence: "high",
    required_evidence: "Four or more redirects were followed before the final page.", exclusions: "Short redirect chains are excluded.",
    explanation: "The browser passed through an unusually long sequence of redirects.", beginner: "The browser was sent through several addresses before reaching the page. This can be legitimate, but the destinations deserve review.",
    remediation: "Remove unnecessary redirects and verify each cross-domain destination.",
    evaluate: (report) => report.redirect_chain.length >= 4 ? { evidence: `${report.redirect_chain.length} redirects were followed.` } : undefined,
  },
  {
    id: "CROSS_DOMAIN_REDIRECT", name: "Final destination changed domain", category: "Navigation", severity: "medium", confidence: "high",
    required_evidence: "Submitted and final registered domains differ.", exclusions: "Subdomain and same registered-domain changes are excluded.",
    explanation: "The final page belongs to a different registered domain than the submitted address.", beginner: "The address ended on a different main domain. This can be expected, but users should know where they actually arrived.",
    remediation: "Confirm that the final destination is expected and controlled by the intended organization.",
    evaluate: (report) => mainDomain(new URL(report.url).hostname) !== mainDomain(new URL(report.final_url).hostname) ? { evidence: `${report.url} redirected to ${report.final_url}.` } : undefined,
  },
  {
    id: "HIDDEN_THIRD_PARTY_IFRAME", name: "Hidden third-party iframe", category: "Embedded content", severity: "medium", confidence: "high",
    required_evidence: "A third-party iframe is invisible, tiny, or off-screen.", exclusions: "Visible and first-party frames are excluded.",
    explanation: "An external page was embedded in a frame that was not visibly presented.", beginner: "The page included content from another domain in a hidden frame. Hidden frames can have legitimate uses, so this needs review rather than an automatic malicious label.",
    remediation: "Document why the hidden frame is needed and restrict it with an appropriate sandbox policy.",
    evaluate: (report) => {
      const items = report.iframes.filter((frame) => frame.third_party && frame.hidden);
      return items.length ? { evidence: `${items.length} hidden third-party iframe(s).` } : undefined;
    },
  },
  {
    id: "SENSITIVE_FORM_OVER_HTTP", name: "Sensitive form submits without HTTPS", category: "Forms", severity: "serious", confidence: "high",
    required_evidence: "A form contains password, email, payment, or identity fields and submits to HTTP.", exclusions: "Forms without sensitive field types are excluded.",
    explanation: "A form with sensitive fields used an unencrypted submission destination.", beginner: "Information entered into this form may be sent without encryption, making it easier to intercept while travelling across the network.",
    remediation: "Submit sensitive forms only to HTTPS endpoints.",
    evaluate: (report) => {
      const items = report.forms.filter((form) => form.sensitive_fields.length && !form.secure);
      return items.length ? { evidence: `${items.length} sensitive form(s) submit to a non-HTTPS destination.` } : undefined;
    },
  },
  {
    id: "THIRD_PARTY_SENSITIVE_FORM", name: "Sensitive form submits to a third party", category: "Forms", severity: "high", confidence: "high",
    required_evidence: "A form contains sensitive field types and its action uses another registered domain.", exclusions: "First-party form destinations are excluded.",
    explanation: "A form with sensitive fields sends its submission to another domain.", beginner: "Information entered into this form appears to go directly to another company or service. This may be intentional, but it should be clearly understood.",
    remediation: "Verify the third-party processor, purpose, security controls, and user notice.",
    evaluate: (report) => {
      const items = report.forms.filter((form) => form.sensitive_fields.length && form.third_party);
      return items.length ? { evidence: `${items.length} sensitive form(s) submit to a third-party domain.` } : undefined;
    },
  },
  {
    id: "UNEXPECTED_PERMISSION_REQUEST", name: "Sensitive browser permission requested", category: "Permissions", severity: "medium", confidence: "high",
    required_evidence: "The page called a camera, microphone, geolocation, notification, clipboard, USB, Bluetooth, or payment permission API.", exclusions: "A policy declaration without an actual API call is excluded.",
    explanation: "The page requested access to a sensitive browser capability during observation.", beginner: "The page asked the browser for access to a device or personal capability. GlassNet did not grant it, but the request is worth understanding.",
    remediation: "Request sensitive permissions only after a clear user action and explanation.",
    evaluate: (report) => {
      const items = report.permissions.filter((permission) => permission.requested);
      return items.length ? { evidence: `Requested: ${items.map((item) => item.name).join(", ")}.` } : undefined;
    },
  },
  {
    id: "AUTOMATIC_DOWNLOAD", name: "Automatic download attempted", category: "Downloads", severity: "serious", confidence: "high",
    required_evidence: "A download event occurred without GlassNet clicking or submitting anything.", exclusions: "GlassNet performs no user interaction, so user-initiated downloads are not part of this scan.",
    explanation: "The page attempted to start a file download during passive observation.", beginner: "The website tried to download a file without GlassNet asking it to. The download was cancelled and never opened.",
    remediation: "Require an explicit user action before starting downloads and verify the file source.",
    evaluate: (report) => report.downloads.length ? { evidence: `${report.downloads.length} download attempt(s) were cancelled.` } : undefined,
  },
  {
    id: "OBFUSCATED_INLINE_SCRIPT", name: "Suspicious inline-script structure", category: "Scripts", severity: "medium", confidence: "medium",
    required_evidence: "A large inline script combines high encoded-string density, repeated dynamic execution, and a very long line.", exclusions: "Compact or minified code alone never matches.",
    explanation: "An inline script matched several conservative obfuscation signals.", beginner: "A script was structured in a way that makes its behavior unusually difficult to inspect. Minified code by itself is not treated as suspicious.",
    remediation: "Review the matching inline script from the original source and replace packed code where possible.",
    evaluate: (report) => report.script_signals.suspicious_obfuscation ? { evidence: `${report.script_signals.suspicious_obfuscation} inline script(s) matched multiple signals.` } : undefined,
  },
  {
    id: "MINER_SIGNATURE", name: "Cryptocurrency-mining signature observed", category: "Scripts", severity: "serious", confidence: "high",
    required_evidence: "A reviewed miner host or script signature is combined with worker or WebAssembly behavior.", exclusions: "A generic cryptocurrency keyword or WebAssembly use alone is excluded.",
    explanation: "The scan matched multiple signals associated with browser cryptocurrency mining.", beginner: "The page showed a combination of signals used by browser-based cryptocurrency miners. This is based on observed script evidence, not a generic keyword.",
    remediation: "Remove the mining script and investigate how it was introduced.",
    evaluate: (report) => report.script_signals.miner_signature ? { evidence: report.script_signals.details.join("; ") || "Reviewed miner signature and supporting runtime signal." } : undefined,
  },
];

function buildFindings(report: AnalysisInput): Finding[] {
  return riskRules.flatMap((rule) => {
    const match = rule.evaluate(report);
    if (!match) return [];
    return [{
      rule_id: rule.id, title: rule.name, category: rule.category, severity: rule.severity,
      confidence: rule.confidence, explanation: rule.explanation,
      beginner_explanation: rule.beginner, evidence: match.evidence,
      limitation: match.limitation || rule.exclusions, remediation: rule.remediation,
      ruleset_version: RULESET_VERSION,
    }];
  });
}

function check(input: SecurityCheck): SecurityCheck { return input; }

function buildSecurityChecks(report: AnalysisInput): SecurityCheck[] {
  const finalHttps = isHttps(report.final_url);
  const mixed = report.requests.filter((item) => finalHttps && item.url.startsWith("http://"));
  const cookieWarnings = report.cookies.flatMap((cookie) => cookie.security_notes);
  const permissionRequests = report.permissions.filter((item) => item.requested);
  const hiddenFrames = report.iframes.filter((item) => item.hidden && item.third_party);
  const insecureForms = report.forms.filter((item) => item.sensitive_fields.length && !item.secure);
  const checks: SecurityCheck[] = [
    check({ id: "HTTPS", name: "HTTPS", status: finalHttps ? "Passed" : "Concern", severity: finalHttps ? "info" : "high", confidence: "high", observation: finalHttps ? "The final page used HTTPS." : "The final page did not use HTTPS.", why_it_matters: "HTTPS encrypts traffic between the browser and website.", evidence: report.final_url, limitation: "This checks the observed navigation, not every page on the website.", beginner_explanation: finalHttps ? "The observed page connection was encrypted." : "The observed page connection was not encrypted." }),
    check({ id: "MIXED_CONTENT", name: "Mixed content", status: mixed.length ? "Concern" : finalHttps ? "Passed" : "Unable to test", severity: mixed.length ? "high" : "info", confidence: "high", observation: mixed.length ? `${mixed.length} HTTP resource(s) were requested by the HTTPS page.` : finalHttps ? "No mixed HTTP resources were observed." : "Mixed content requires an HTTPS final page.", why_it_matters: "Unencrypted resources can weaken an otherwise encrypted page.", evidence: mixed.slice(0, 3).map((item) => item.url).join("; ") || "Captured request protocols.", limitation: "Only resources requested during this scan are covered.", beginner_explanation: mixed.length ? "Some page resources were loaded without encryption." : "GlassNet did not observe unencrypted resources on the HTTPS page." }),
    check({ id: "HTTP_TO_HTTPS", name: "HTTP to HTTPS redirect", status: report.url.startsWith("http://") ? finalHttps ? "Passed" : "Concern" : "Unable to test", severity: report.url.startsWith("http://") && !finalHttps ? "high" : "info", confidence: "high", observation: report.url.startsWith("http://") ? finalHttps ? "The tested HTTP address ended on HTTPS." : "The tested HTTP address did not end on HTTPS." : "The submitted address already used HTTPS, so an HTTP upgrade was not tested.", why_it_matters: "An automatic upgrade helps visitors reach the encrypted version.", evidence: `${report.url} → ${report.final_url}`, limitation: "GlassNet tests only the submitted address and observed redirect chain.", beginner_explanation: report.url.startsWith("http://") ? finalHttps ? "The website moved the browser from an unencrypted address to an encrypted one." : "The website did not move this tested address to HTTPS." : "This scan began on HTTPS, so there was no HTTP visit to test." }),
  ];

  const headers = [
    ["content-security-policy", "Content-Security-Policy", "Helps limit where executable page content can come from."],
    ["strict-transport-security", "Strict-Transport-Security", "Tells browsers to prefer HTTPS for future visits."],
    ["x-content-type-options", "X-Content-Type-Options", "Helps browsers avoid treating files as a different content type."],
    ["referrer-policy", "Referrer-Policy", "Controls how much referring-address information leaves the page."],
    ["permissions-policy", "Permissions-Policy", "Limits access to sensitive browser capabilities."],
    ["cross-origin-opener-policy", "Cross-Origin-Opener-Policy", "Can isolate the page from other browsing contexts."],
    ["cross-origin-resource-policy", "Cross-Origin-Resource-Policy", "Can restrict which sites load a resource."],
    ["cross-origin-embedder-policy", "Cross-Origin-Embedder-Policy", "Supports stronger cross-origin isolation when needed."],
  ];
  for (const [key, name, purpose] of headers) {
    const value = report.security_headers[key];
    checks.push(check({ id: `HEADER_${key.toUpperCase().replaceAll("-", "_")}`, name, status: value ? "Passed" : "Not observed", severity: "low", confidence: "high", observation: value ? `${name} was present.` : `${name} was not present in the observed main response.`, why_it_matters: purpose, evidence: value || "Header absent from the captured response.", limitation: "A missing header alone does not prove that the website is insecure.", beginner_explanation: value ? `The page supplied this browser protection.` : `GlassNet did not see this optional browser protection on the scanned response.` }));
  }

  checks.push(
    check({ id: "COOKIE_SECURITY", name: "Cookie security", status: cookieWarnings.length ? "Concern" : report.cookies.length ? "Passed" : "Not observed", severity: cookieWarnings.length ? "medium" : "info", confidence: "medium", observation: cookieWarnings.length ? `${cookieWarnings.length} contextual cookie warning(s).` : report.cookies.length ? "No contextual cookie-attribute warning was produced." : "No cookies were observed.", why_it_matters: "Secure, HttpOnly, and SameSite attributes can reduce specific cookie risks.", evidence: cookieWarnings.join("; ") || "Captured cookie attributes.", limitation: "Cookie purpose can be uncertain, and some cookies intentionally need JavaScript access.", beginner_explanation: cookieWarnings.length ? "One or more cookies may be missing a protection relevant to their likely purpose." : "No major cookie-attribute concern was identified from the available metadata." }),
    check({ id: "REDIRECTS", name: "Redirects", status: report.redirect_chain.length >= 4 ? "Needs review" : "Passed", severity: report.redirect_chain.length >= 4 ? "medium" : "info", confidence: "high", observation: `${report.redirect_chain.length} redirect(s) were followed.`, why_it_matters: "Redirects determine where the browser actually lands.", evidence: [...report.redirect_chain, report.final_url].join(" → "), limitation: "Legitimate authentication and regional routing can use cross-domain redirects.", beginner_explanation: report.redirect_chain.length ? "The browser visited other addresses before reaching the final page." : "The page loaded without an observed redirect chain." }),
    check({ id: "PERMISSIONS", name: "Browser permissions", status: permissionRequests.length ? "Needs review" : "Not observed", severity: permissionRequests.length ? "medium" : "info", confidence: "high", observation: permissionRequests.length ? `Requested: ${permissionRequests.map((item) => item.name).join(", ")}.` : "No sensitive permission API call was observed.", why_it_matters: "Camera, microphone, location, and device access should follow a clear user action.", evidence: permissionRequests.length ? "Instrumented browser API calls." : "No instrumented API call.", limitation: "Policy declarations and actual requests are different; later user interactions may request permissions.", beginner_explanation: permissionRequests.length ? "The page asked the browser for sensitive access; GlassNet did not grant it." : "The page did not ask for a monitored browser permission during this scan." }),
    check({ id: "IFRAMES", name: "Hidden third-party frames", status: hiddenFrames.length ? "Needs review" : "Not observed", severity: hiddenFrames.length ? "medium" : "info", confidence: "high", observation: hiddenFrames.length ? `${hiddenFrames.length} hidden third-party frame(s) were observed.` : "No hidden third-party frame was observed.", why_it_matters: "Frames can load another website inside the page.", evidence: hiddenFrames.map((item) => item.url).join("; ") || "Captured frame elements.", limitation: "Hidden frames can support legitimate measurement or security features.", beginner_explanation: hiddenFrames.length ? "The page loaded external content in a frame that was not visibly presented." : "GlassNet did not observe hidden external frames." }),
    check({ id: "FORMS", name: "Form destinations", status: insecureForms.length ? "Concern" : report.forms.length ? "Passed" : "Not observed", severity: insecureForms.length ? "high" : "info", confidence: "high", observation: insecureForms.length ? `${insecureForms.length} sensitive form(s) used a non-HTTPS action.` : report.forms.length ? `${report.forms.length} form destination(s) were inspected without submission.` : "No forms were observed.", why_it_matters: "A form destination controls where entered information would be sent.", evidence: report.forms.map((item) => item.action).join("; ") || "No form elements.", limitation: "GlassNet never submits forms and cannot verify server-side handling.", beginner_explanation: insecureForms.length ? "A form could send sensitive information without encryption." : "No insecure sensitive form destination was observed." }),
    check({ id: "DOWNLOADS", name: "Automatic downloads", status: report.downloads.length ? "Concern" : "Not observed", severity: report.downloads.length ? "high" : "info", confidence: "high", observation: report.downloads.length ? `${report.downloads.length} download attempt(s) were cancelled.` : "No automatic download was observed.", why_it_matters: "Unexpected downloads can expose users to unwanted files.", evidence: report.downloads.map((item) => item.suggested_filename).join("; ") || "No download event.", limitation: "GlassNet does not click download links or inspect file contents.", beginner_explanation: report.downloads.length ? "The page tried to start a download; GlassNet cancelled it and did not open the file." : "The page did not automatically start a download during observation." }),
    check({ id: "OBFUSCATION", name: "Script obfuscation signals", status: report.script_signals.suspicious_obfuscation ? "Needs review" : "Not observed", severity: report.script_signals.suspicious_obfuscation ? "medium" : "info", confidence: report.script_signals.suspicious_obfuscation ? "medium" : "high", observation: report.script_signals.suspicious_obfuscation ? `${report.script_signals.suspicious_obfuscation} inline script(s) matched multiple conservative signals.` : "No inline script matched the combined obfuscation rule.", why_it_matters: "Obfuscation can make code behavior difficult to review.", evidence: report.script_signals.details.join("; ") || "Aggregated inline-script measurements.", limitation: "Minified production code alone is never treated as suspicious.", beginner_explanation: report.script_signals.suspicious_obfuscation ? "Some code was unusually difficult to inspect and deserves manual review." : "GlassNet did not find the combined signals used for this check." }),
    check({ id: "MINING", name: "Cryptocurrency-mining signatures", status: report.script_signals.miner_signature ? "Concern" : "Not observed", severity: report.script_signals.miner_signature ? "high" : "info", confidence: "high", observation: report.script_signals.miner_signature ? "A reviewed miner signature and supporting runtime signal were both observed." : "No combined mining signature was observed.", why_it_matters: "Browser miners can consume device resources without a visitor expecting it.", evidence: report.script_signals.details.join("; ") || "Reviewed signature and runtime-signal check.", limitation: "Generic cryptocurrency words and WebAssembly alone do not trigger this result.", beginner_explanation: report.script_signals.miner_signature ? "The page matched multiple signals used by browser cryptocurrency miners." : "GlassNet did not observe the combined evidence required for a mining warning." }),
  );
  return checks;
}

function buildRisk(report: AnalysisInput, findings: Finding[], checks: SecurityCheck[]): RiskSummary {
  const limitations = [
    `Observed one page for ${Math.max(0, Math.round(report.coverage.duration_ms / 100) / 10)} seconds.`,
    "Results depend on scan time, device profile, region, and interaction state.",
    "GlassNet did not sign in, submit forms, accept prompts, or click consent controls.",
  ];
  if (!report.coverage.page_loaded || report.requests.length === 0) {
    return { level: "Unable to determine", summary: "GlassNet did not collect enough page-load evidence for a reliable observed-risk result.", reasons: ["The page did not load fully or produced too little network evidence."], concern_count: findings.length, evidence_anchor: "findings", limitations, ruleset_version: RULESET_VERSION };
  }
  const serious = findings.filter((item) => item.severity === "serious" && item.confidence === "high");
  const high = findings.filter((item) => item.severity === "high" && item.confidence === "high");
  if (serious.length || high.length >= 2) {
    return { level: "High observed risk", summary: "The scan found strong evidence of one serious concern or several related high-confidence concerns.", reasons: findings.slice(0, 4).map((item) => item.explanation), concern_count: findings.length, evidence_anchor: "findings", limitations, ruleset_version: RULESET_VERSION };
  }
  if (findings.length) {
    return { level: "Some concerns found", summary: "The page loaded, but GlassNet observed configuration, cookie, third-party, or behavior concerns that deserve review.", reasons: findings.slice(0, 4).map((item) => item.explanation), concern_count: findings.length, evidence_anchor: "findings", limitations, ruleset_version: RULESET_VERSION };
  }
  const importantUnavailable = checks.filter((item) => item.status === "Unable to test" && ["HTTPS", "Mixed content"].includes(item.name));
  if (importantUnavailable.length) {
    return { level: "Unable to determine", summary: "Important transport checks could not be completed.", reasons: importantUnavailable.map((item) => item.observation), concern_count: 0, evidence_anchor: "findings", limitations, ruleset_version: RULESET_VERSION };
  }
  return { level: "Low observed risk", summary: "No major concerns were observed during this scan. This does not guarantee that the website is completely safe.", reasons: ["The page loaded and no evidence-based risk rule matched."], concern_count: 0, evidence_anchor: "findings", limitations, ruleset_version: RULESET_VERSION };
}

export function analyzeReport(report: AnalysisInput) {
  const findings = buildFindings(report);
  const securityChecks = buildSecurityChecks(report);
  return { findings, security_checks: securityChecks, risk: buildRisk(report, findings, securityChecks) };
}

// GlassNet observes public browser metadata in a fresh isolated profile.
// It never stores cookie values, request bodies, form fields, or login sessions.
import { config } from "./config.js";
import { createIsolatedContext } from "./browser-pool.js";
import { classify, mainDomain, scoreLabel } from "./classification.js";
import { isSafeRequestUrl } from "./url-safety.js";
import type { CookieInfo, ScanEvent, ScanMode, ScanResult, StorageInfo } from "./types.js";

type ProgressUpdate = { stage: string; domains: number; requests: number };

export async function scanPublicWebsite(
  website: string,
  mode: ScanMode = "full",
  onProgress?: (update: ProgressUpdate) => void,
): Promise<ScanResult> {
  const targetDomain = mainDomain(new URL(website).hostname);
  const domains = new Map<string, { requests: number; types: Set<string> }>();
  const events: ScanEvent[] = [];
  const startedAt = Date.now();
  let sequence = 0;
  let liveRequests = 0;

  const addEvent = (type: ScanEvent["type"], source: string, destination: string, category: string) => {
    if (events.length >= config.maxRequests) return;
    sequence += 1;
    events.push({
      sequence,
      offset_ms: Date.now() - startedAt,
      type,
      source,
      destination,
      category,
      consent_state: mode === "consent" ? "initial" : "not_tested",
    });
  };

  const browserLease = await createIsolatedContext({
    viewport: { width: 1360, height: 800 },
    acceptDownloads: false,
  });
  const context = browserLease.context;
  const page = await context.newPage();
  let title = targetDomain;
  let cookies: CookieInfo[] = [];
  let storage: StorageInfo[] = [];
  let scripts: string[] = [];
  let securityHeaders: Record<string, string> = {};

  await page.route("**/*", async (route) => {
    if (await isSafeRequestUrl(route.request().url())) await route.continue();
    else await route.abort("blockedbyclient");
  });

  page.on("response", (response) => {
    if (domains.size >= config.maxRequests) return;
    try {
      const domain = mainDomain(new URL(response.url()).hostname);
      const item = domains.get(domain) || { requests: 0, types: new Set<string>() };
      item.requests += 1;
      item.types.add(response.request().resourceType());
      domains.set(domain, item);
      liveRequests += 1;
      addEvent("response", targetDomain, domain, response.request().resourceType());
      onProgress?.({ stage: "mapping_network", domains: domains.size, requests: liveRequests });
    } catch {
      // Browser-internal response URLs are not useful evidence.
    }
  });

  try {
    onProgress?.({ stage: "opening_browser", domains: 0, requests: 0 });
    const mainResponse = await page.goto(website, {
      waitUntil: "domcontentloaded",
      timeout: config.scanTimeoutMs,
    });
    addEvent("navigation", targetDomain, targetDomain, "document");

    if (mainResponse) {
      const allowed = [
        "content-security-policy",
        "strict-transport-security",
        "referrer-policy",
        "permissions-policy",
        "x-content-type-options",
        "x-frame-options",
      ];
      const headers = await mainResponse.allHeaders();
      securityHeaders = Object.fromEntries(
        allowed.filter((name) => headers[name]).map((name) => [name, headers[name]]),
      );
    }

    const observationTime = mode === "quick" ? 900 : mode === "full" ? 2500 : 1800;
    await page.waitForTimeout(observationTime);
    title = (await page.title()).slice(0, 200) || targetDomain;
    onProgress?.({ stage: "reading_storage", domains: domains.size, requests: liveRequests });

    const browserCookies = await context.cookies();
    cookies = browserCookies.map((cookie) => ({
      domain: mainDomain(cookie.domain.replace(/^\./, "")),
      secure: cookie.secure,
      httpOnly: cookie.httpOnly,
      sameSite: cookie.sameSite,
      session: cookie.expires === -1,
      firstParty: mainDomain(cookie.domain.replace(/^\./, "")) === targetDomain,
    }));
    for (const cookie of cookies) {
      addEvent("cookie", targetDomain, cookie.domain, cookie.firstParty ? "first-party" : "third-party");
    }

    if (mode !== "quick") {
      storage = await page.evaluate((maximumKeys) => {
        const values: StorageInfo[] = [];
        for (let index = 0; index < localStorage.length && values.length < maximumKeys; index += 1) {
          values.push({ type: "localStorage", origin: location.origin, key: localStorage.key(index) || "" });
        }
        for (let index = 0; index < sessionStorage.length && values.length < maximumKeys; index += 1) {
          values.push({ type: "sessionStorage", origin: location.origin, key: sessionStorage.key(index) || "" });
        }
        return values;
      }, config.maxStorageKeys);
      for (const item of storage) addEvent("storage", targetDomain, targetDomain, item.type);

      scripts = await page.locator("script[src]").evaluateAll(
        (items) => items.map((item) => (item as HTMLScriptElement).src).slice(0, 100),
      );
      for (const script of scripts) {
        try {
          addEvent("script", targetDomain, mainDomain(new URL(script).hostname), "script");
        } catch {
          // Ignore malformed script source values.
        }
      }
    }
  } finally {
    await browserLease.release();
  }

  onProgress?.({ stage: "classifying_services", domains: domains.size, requests: liveRequests });
  const firstParty: ScanResult["first_party"] = [];
  const services: ScanResult["services"] = [];
  let requestCount = 0;
  for (const [domain, item] of [...domains.entries()].sort()) {
    requestCount += item.requests;
    const connection = { domain, requests: item.requests, types: [...item.types].sort() };
    if (domain === targetDomain) firstParty.push(connection);
    else services.push({ ...classify(domain), ...connection });
  }

  const categories: Record<string, number> = {};
  for (const service of services) categories[service.category] = (categories[service.category] || 0) + 1;
  const thirdPartyCookies = cookies.filter((cookie) => !cookie.firstParty).length;
  const servicePenalty = services.reduce((total, service) => total + service.weight, 0);
  const score = Math.max(0, 100 - Math.min(servicePenalty + Math.min(cookies.length, 20) + Math.min(thirdPartyCookies * 2, 20), 100));

  const nodes: unknown[] = [{ data: { id: targetDomain, label: targetDomain, kind: "website" } }];
  const edges: unknown[] = [];
  for (const service of services) {
    nodes.push({ data: { id: service.domain, label: service.name, kind: service.category, details: service } });
    edges.push({ data: { source: targetDomain, target: service.domain } });
  }
  addEvent("complete", targetDomain, targetDomain, "scan");

  return {
    status: "completed",
    mode,
    scanner_version: config.scannerVersion,
    url: website,
    site_name: title,
    target_domain: targetDomain,
    score,
    score_label: scoreLabel(score),
    notice: "This score describes observable privacy exposure. It does not declare a site safe or unsafe.",
    limitations: [
      "This report observes one public page load.",
      "Cookie and storage values are intentionally not stored.",
      "Consent, location, and account state can change the result.",
    ],
    summary: {
      requests: requestCount,
      third_parties: services.length,
      cookies: cookies.length,
      third_party_cookies: thirdPartyCookies,
      storage_keys: storage.length,
      scripts: scripts.length,
    },
    categories,
    services,
    first_party: firstParty,
    cookies,
    storage,
    scripts,
    events,
    security_headers: securityHeaders,
    consent: {
      status: mode === "consent" ? "passive_observation" : "not_tested",
      pre_consent_requests: mode === "consent" ? requestCount : 0,
      note: mode === "consent"
        ? "GlassNet recorded the initial state without clicking a consent control. Accept and reject automation is not claimed when a reliable control was not identified."
        : "Run a Consent Investigation to record the page's initial consent state.",
    },
    graph: { nodes, edges },
  };
}

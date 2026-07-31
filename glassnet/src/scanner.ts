// GlassNet observes public browser metadata in a fresh isolated profile.
// It never stores cookie values, request bodies, form fields, or login sessions.
import { config } from "./config.js";
import { analyzeReport } from "./analysis.js";
import { createIsolatedContext } from "./browser-pool.js";
import { classify, mainDomain, scoreLabel } from "./classification.js";
import { classifyCookie, cookieSecurityNotes } from "./cookie-knowledge.js";
import { redactUrl, requestCategory } from "./request-explorer.js";
import { isSafeRequestUrl } from "./url-safety.js";
import type { Request, Response } from "playwright";
import type { CookieInfo, DownloadInfo, FormInfo, FrameInfo, PermissionInfo, RequestInfo, ScanEvent, ScanMode, ScanResult, StorageInfo } from "./types.js";

type ProgressUpdate = { stage: string; domains: number; requests: number };

export async function scanPublicWebsite(
  website: string,
  mode: ScanMode = "full",
  onProgress?: (update: ProgressUpdate) => void,
): Promise<ScanResult> {
  const targetDomain = mainDomain(new URL(website).hostname);
  const domains = new Map<string, { requests: number; types: Set<string> }>();
  const events: ScanEvent[] = [];
  const requests: RequestInfo[] = [];
  const requestTasks: Promise<void>[] = [];
  const seenRequests = new Set<Request>();
  const downloads: DownloadInfo[] = [];
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
    });
  };

  const browserLease = await createIsolatedContext({
    viewport: { width: 1360, height: 800 },
    acceptDownloads: false,
  });
  const context = browserLease.context;
  await context.addInitScript(() => {
    const root = globalThis as typeof globalThis & { __glassnetPermissionRequests?: string[] };
    root.__glassnetPermissionRequests = [];
    const record = (name: string) => root.__glassnetPermissionRequests?.push(name);
    const wrap = (owner: Record<string, unknown> | undefined, method: string, name: string) => {
      if (!owner || typeof owner[method] !== "function") return;
      const original = owner[method] as (...args: unknown[]) => unknown;
      owner[method] = function (...args: unknown[]) { record(name); return original.apply(this, args); };
    };
    wrap(navigator.geolocation as unknown as Record<string, unknown>, "getCurrentPosition", "geolocation");
    wrap(navigator.geolocation as unknown as Record<string, unknown>, "watchPosition", "geolocation");
    wrap(navigator.mediaDevices as unknown as Record<string, unknown>, "getUserMedia", "camera or microphone");
    wrap((globalThis as unknown as { Notification?: Record<string, unknown> }).Notification, "requestPermission", "notifications");
    wrap(navigator.clipboard as unknown as Record<string, unknown>, "readText", "clipboard");
    wrap(navigator.clipboard as unknown as Record<string, unknown>, "writeText", "clipboard");
    wrap((navigator as unknown as { usb?: Record<string, unknown> }).usb, "requestDevice", "USB");
    wrap((navigator as unknown as { bluetooth?: Record<string, unknown> }).bluetooth, "requestDevice", "Bluetooth");
    wrap((globalThis as unknown as { PaymentRequest?: { prototype?: Record<string, unknown> } }).PaymentRequest?.prototype, "show", "payment");
  });
  const page = await context.newPage();
  let title = targetDomain;
  let cookies: CookieInfo[] = [];
  let storage: StorageInfo[] = [];
  let scripts: string[] = [];
  let securityHeaders: Record<string, string> = {};
  let pageLoaded = false;
  let finalUrl = website;
  let redirectChain: string[] = [];
  let iframes: FrameInfo[] = [];
  let forms: FormInfo[] = [];
  let permissions: PermissionInfo[] = [];
  let scriptSignals = { suspicious_obfuscation: 0, miner_signature: false, details: [] as string[] };
  let minerRuntimeObserved = false;
  let loadFailure = "";
  const navigationRedirects: string[] = [];

  await page.route("**/*", async (route) => {
    const browserRequest = route.request();
    if (browserRequest.isNavigationRequest() && browserRequest.redirectedFrom()) {
      try {
        if (browserRequest.frame() === page.mainFrame()) navigationRedirects.push(redactUrl(browserRequest.redirectedFrom()!.url()));
      } catch { /* Navigation may detach while redirecting. */ }
      if (navigationRedirects.length > config.maxRedirects) return route.abort("blockedbyclient");
    }
    if (await isSafeRequestUrl(browserRequest.url())) await route.continue();
    else await route.abort("blockedbyclient");
  });

  page.on("response", (response) => {
    if (domains.size >= config.maxRequests) return;
    try {
      const browserRequest = response.request();
      const domain = mainDomain(new URL(response.url()).hostname);
      const item = domains.get(domain) || { requests: 0, types: new Set<string>() };
      item.requests += 1;
      item.types.add(browserRequest.resourceType());
      domains.set(domain, item);
      liveRequests += 1;
      addEvent("response", targetDomain, domain, browserRequest.resourceType());
      onProgress?.({ stage: "mapping_network", domains: domains.size, requests: liveRequests });

      if (seenRequests.size < config.maxRequests && !seenRequests.has(browserRequest)) {
        seenRequests.add(browserRequest);
        requestTasks.push((async () => {
          const service = classify(domain);
          const length = Number(await response.headerValue("content-length")) || 0;
          let initiator = "[unavailable]";
          try { initiator = redactUrl(browserRequest.frame().url()); } catch { /* Worker requests may not have a frame. */ }
          requests.push({
            id: 0,
            domain,
            url: redactUrl(response.url()),
            method: browserRequest.method(),
            resource_type: browserRequest.resourceType(),
            party: domain === targetDomain ? "First party" : "Third party",
            category: requestCategory(browserRequest.resourceType(), service.category),
            initiator,
            status: response.status(),
            transferred_bytes: Math.max(0, length),
            timestamp_ms: Date.now() - startedAt,
            consent_state: "Not tested",
            confidence: domain === targetDomain ? "verified" : service.confidence,
            classification_method: domain === targetDomain ? "Registered-domain match" : service.confidence === "unknown" ? "No known-service match" : "Reviewed domain rule",
            redirect_from: browserRequest.redirectedFrom() ? redactUrl(browserRequest.redirectedFrom()!.url()) : undefined,
          });
        })());
      }
    } catch {
      // Browser-internal response URLs are not useful evidence.
    }
  });

  page.on("requestfailed", (browserRequest) => {
    if (seenRequests.size >= config.maxRequests || seenRequests.has(browserRequest)) return;
    seenRequests.add(browserRequest);
    try {
      const domain = mainDomain(new URL(browserRequest.url()).hostname);
      const service = classify(domain);
      requests.push({
        id: 0, domain, url: redactUrl(browserRequest.url()), method: browserRequest.method(),
        resource_type: browserRequest.resourceType(), party: domain === targetDomain ? "First party" : "Third party",
        category: requestCategory(browserRequest.resourceType(), service.category), initiator: "[unavailable]",
        status: 0, transferred_bytes: 0, timestamp_ms: Date.now() - startedAt,
        consent_state: "Not tested", confidence: domain === targetDomain ? "verified" : service.confidence,
        classification_method: "Failed request; domain classification only",
        redirect_from: browserRequest.redirectedFrom() ? redactUrl(browserRequest.redirectedFrom()!.url()) : undefined,
      });
    } catch { /* Ignore non-HTTP browser requests. */ }
  });

  page.on("download", (download) => {
    downloads.push({
      url: redactUrl(download.url()),
      suggested_filename: download.suggestedFilename().slice(0, 160),
      timestamp_ms: Date.now() - startedAt,
      cancelled: true,
    });
    void download.cancel().catch(() => undefined);
  });

  try {
    onProgress?.({ stage: "opening_browser", domains: 0, requests: 0 });
    let mainResponse: Response | null = null;
    try {
      mainResponse = await page.goto(website, {
        waitUntil: "domcontentloaded",
        timeout: config.scanTimeoutMs,
      });
    } catch (error) {
      loadFailure = error instanceof Error ? error.message.slice(0, 160) : "The page did not finish loading.";
    }
    pageLoaded = Boolean(mainResponse);
    finalUrl = redactUrl(page.url());
    if (mainResponse) {
      const redirects: string[] = [];
      let previous = mainResponse.request().redirectedFrom();
      while (previous) {
        redirects.unshift(redactUrl(previous.url()));
        previous = previous.redirectedFrom();
      }
      redirectChain = redirects;
    }
    if (!redirectChain.length && navigationRedirects.length) redirectChain = navigationRedirects.slice(0, config.maxRedirects);
    addEvent("navigation", targetDomain, targetDomain, "document");

    if (mainResponse) {
      const allowed = [
        "content-security-policy",
        "strict-transport-security",
        "referrer-policy",
        "permissions-policy",
        "x-content-type-options",
        "x-frame-options",
        "cross-origin-opener-policy",
        "cross-origin-resource-policy",
        "cross-origin-embedder-policy",
      ];
      const headers = await mainResponse.allHeaders();
      securityHeaders = Object.fromEntries(
        allowed.filter((name) => headers[name]).map((name) => [name, headers[name]]),
      );
    }

    const observationTime = mode === "quick" ? 900 : 2500;
    await page.waitForTimeout(observationTime);
    title = (await page.title()).slice(0, 200) || targetDomain;
    onProgress?.({ stage: "reading_storage", domains: domains.size, requests: liveRequests });

    const browserCookies = await context.cookies();
    cookies = browserCookies.slice(0, config.maxCookies).map((cookie) => {
      const domain = mainDomain(cookie.domain.replace(/^\./, ""));
      const basic = {
        name: cookie.name.slice(0, 160),
        domain,
        path: cookie.path.slice(0, 240),
        secure: cookie.secure,
        httpOnly: cookie.httpOnly,
        sameSite: cookie.sameSite,
        session: cookie.expires === -1,
        firstParty: domain === targetDomain,
      };
      const purpose = classifyCookie(basic);
      return {
        ...basic,
        expires_at: cookie.expires === -1 ? null : new Date(cookie.expires * 1000).toISOString(),
        consent_state: "Not tested" as const,
        ...purpose,
        security_notes: cookieSecurityNotes(basic, finalUrl.startsWith("https://")),
      };
    });
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

      const scriptUrls = await page.locator("script[src]").evaluateAll(
        (items) => items.map((item) => (item as HTMLScriptElement).src).slice(0, 100),
      );
      scripts = scriptUrls.map(redactUrl);
      for (const script of scripts) {
        try {
          addEvent("script", targetDomain, mainDomain(new URL(script).hostname), "script");
        } catch {
          // Ignore malformed script source values.
        }
      }
    }

    const frameRows = await page.locator("iframe").evaluateAll((items) => items.slice(0, 100).map((item) => {
      const frame = item as HTMLIFrameElement;
      const style = getComputedStyle(frame);
      const box = frame.getBoundingClientRect();
      return {
        url: frame.src || "about:blank",
        hidden: frame.hidden || frame.getAttribute("aria-hidden") === "true" || style.display === "none" || style.visibility === "hidden" || Number(style.opacity) === 0 || box.width <= 2 || box.height <= 2 || box.bottom < 0 || box.right < 0,
        sandbox: frame.getAttribute("sandbox") || "",
      };
    }));
    iframes = frameRows.map((frame) => {
      const safeUrl = redactUrl(frame.url);
      let domain = targetDomain;
      try { domain = mainDomain(new URL(frame.url).hostname); } catch { /* about:blank remains first party. */ }
      return { url: safeUrl, domain, third_party: domain !== targetDomain, hidden: frame.hidden, sandbox: frame.sandbox.slice(0, 240) };
    });

    const formRows = await page.locator("form").evaluateAll((items) => items.slice(0, 100).map((item) => {
      const form = item as HTMLFormElement;
      const fields = [...form.querySelectorAll("input, textarea, select")];
      const sensitive = fields.map((field) => (field as HTMLInputElement).type || field.tagName.toLowerCase()).filter((type) => ["password", "email", "tel", "number"].includes(type));
      const autocomplete = fields.map((field) => field.getAttribute("autocomplete") || "").filter(Boolean);
      return { action: form.action || location.href, actionMissing: !form.hasAttribute("action"), method: (form.method || "get").toUpperCase(), sensitive, autocomplete };
    }));
    forms = formRows.map((form) => {
      let actionDomain = targetDomain;
      try { actionDomain = mainDomain(new URL(form.action).hostname); } catch { /* Missing actions submit to the current page. */ }
      return {
        action: redactUrl(form.action), action_domain: actionDomain, action_missing: form.actionMissing, method: form.method,
        secure: form.action.startsWith("https://"), third_party: actionDomain !== targetDomain,
        sensitive_fields: [...new Set(form.sensitive)], autocomplete: [...new Set(form.autocomplete)].slice(0, 20),
      };
    });

    const permissionNames = await page.evaluate(() => {
      const root = globalThis as typeof globalThis & { __glassnetPermissionRequests?: string[] };
      return [...new Set(root.__glassnetPermissionRequests || [])];
    });
    const permissionPolicy = securityHeaders["permissions-policy"] || "";
    const monitoredPermissions = ["camera", "microphone", "geolocation", "notifications", "clipboard", "payment", "USB", "Bluetooth"];
    permissions = monitoredPermissions.map((name) => ({
      name,
      requested: permissionNames.some((item) => item.toLowerCase().includes(name.toLowerCase()) || (name === "camera" && item === "camera or microphone") || (name === "microphone" && item === "camera or microphone")),
      policy_declared: permissionPolicy.toLowerCase().includes(name.toLowerCase()),
      scanner_decision: "Not granted" as const,
    }));

    const inlineSignals = await page.locator("script:not([src])").evaluateAll((items) => items.slice(0, 100).map((item) => {
      const text = item.textContent || "";
      const encoded = (text.match(/(?:\\x[0-9a-f]{2}|\\u[0-9a-f]{4}|[A-Za-z0-9+/]{80,}={0,2})/gi) || []).length;
      const dynamic = (text.match(/\b(?:eval|Function|setTimeout|setInterval)\s*\(/g) || []).length;
      const longestLine = text.split("\n").reduce((longest, line) => Math.max(longest, line.length), 0);
      const runtime = /WebAssembly|new\s+Worker\s*\(/.test(text);
      return { length: text.length, encoded, dynamic, longestLine, runtime };
    }));
    const suspicious = inlineSignals.filter((item) => item.length > 20_000 && item.longestLine > 10_000 && item.dynamic >= 3 && item.encoded >= 5);
    minerRuntimeObserved = inlineSignals.some((item) => item.runtime);
    scriptSignals = {
      suspicious_obfuscation: suspicious.length,
      miner_signature: false,
      details: [
        ...(suspicious.length ? [`${suspicious.length} inline script(s) matched encoded-string, dynamic-execution, size, and line-length thresholds.`] : []),
      ],
    };
  } finally {
    await browserLease.release();
  }

  await Promise.allSettled(requestTasks);
  requests.sort((left, right) => left.timestamp_ms - right.timestamp_ms).forEach((item, index) => { item.id = index + 1; });
  const minerHosts = ["coin-hive.com", "authedmine.com", "webminepool.com"];
  const minerRequest = requests.some((item) => minerHosts.some((host) => item.domain === host || item.domain.endsWith(`.${host}`)));
  scriptSignals.miner_signature = minerRequest && minerRuntimeObserved;
  if (minerRequest) scriptSignals.details.push("A request matched the reviewed miner-host list.");
  if (minerRequest && minerRuntimeObserved) scriptSignals.details.push("Worker or WebAssembly behavior was also present.");

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

  const baseReport: Omit<ScanResult, "findings" | "security_checks" | "risk"> = {
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
      ...(loadFailure ? [`Page load issue: ${loadFailure}`] : []),
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
    requests,
    security_headers: securityHeaders,
    final_url: finalUrl,
    redirect_chain: redirectChain,
    iframes,
    forms,
    permissions,
    downloads,
    script_signals: scriptSignals,
    coverage: {
      page_loaded: pageLoaded,
      duration_ms: Date.now() - startedAt,
      redirects_followed: redirectChain.length,
      checks_completed: 0,
      checks_unavailable: 0,
    },
    graph: { nodes, edges },
  };
  const analysis = analyzeReport(baseReport);
  baseReport.coverage.checks_completed = analysis.security_checks.filter((item) => item.status !== "Unable to test").length;
  baseReport.coverage.checks_unavailable = analysis.security_checks.filter((item) => item.status === "Unable to test").length;
  return { ...baseReport, ...analysis };
}

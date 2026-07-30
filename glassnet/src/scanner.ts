// Browser collection only records privacy-relevant metadata. It does not keep
// cookie values, form fields, passwords, response bodies, or personal content.
import { chromium } from "playwright";
import { config } from "./config.js";
import { classify, mainDomain, scoreLabel } from "./classification.js";
import { isSafeRequestUrl } from "./url-safety.js";
import type { CookieInfo, ScanResult, StorageInfo } from "./types.js";

export async function scanPublicWebsite(website: string): Promise<ScanResult> {
  const targetDomain = mainDomain(new URL(website).hostname);
  const domains = new Map<string, { requests: number; types: Set<string> }>();
  // Some managed Windows computers block Playwright's bundled browser. In that
  // case, use the locally installed Chrome browser without changing its profile.
  let browser;
  try {
    browser = await chromium.launch({ headless: true });
  } catch (firstError) {
    try {
      browser = await chromium.launch({ channel: "chrome", headless: true });
    } catch {
      throw new Error("GlassNet could not start an isolated browser. Windows or security software may be blocking browser automation on this computer.");
    }
  }
  const context = await browser.newContext({ viewport: { width: 1280, height: 720 }, acceptDownloads: false });
  const page = await context.newPage();
  let title = targetDomain;
  let cookies: CookieInfo[] = [];
  let storage: StorageInfo[] = [];
  let scripts: string[] = [];

  // Every requested destination is checked again, including redirects and assets.
  await page.route("**/*", async (route) => {
    if (await isSafeRequestUrl(route.request().url())) await route.continue();
    else await route.abort("blockedbyclient");
  });
  page.on("response", (response) => {
    if (domains.size >= config.maxRequests) return;
    const hostname = new URL(response.url()).hostname;
    const domain = mainDomain(hostname);
    const item = domains.get(domain) || { requests: 0, types: new Set<string>() };
    item.requests += 1;
    item.types.add(response.request().resourceType());
    domains.set(domain, item);
  });

  try {
    await page.goto(website, { waitUntil: "domcontentloaded", timeout: config.scanTimeoutMs });
    await page.waitForTimeout(2500);
    title = (await page.title()).slice(0, 200) || targetDomain;
    const browserCookies = await context.cookies();
    cookies = browserCookies.map((cookie) => ({
      domain: mainDomain(cookie.domain.replace(/^\./, "")), secure: cookie.secure,
      httpOnly: cookie.httpOnly, sameSite: cookie.sameSite, session: cookie.expires === -1,
      firstParty: mainDomain(cookie.domain.replace(/^\./, "")) === targetDomain,
    }));
    storage = await page.evaluate(() => {
      const values: { type: "localStorage" | "sessionStorage"; origin: string; key: string }[] = [];
      for (let index = 0; index < localStorage.length; index += 1) values.push({ type: "localStorage", origin: location.origin, key: localStorage.key(index) || "" });
      for (let index = 0; index < sessionStorage.length; index += 1) values.push({ type: "sessionStorage", origin: location.origin, key: sessionStorage.key(index) || "" });
      return values;
    });
    scripts = await page.locator("script[src]").evaluateAll((items) => items.map((item) => (item as HTMLScriptElement).src).slice(0, 100));
  } finally {
    await context.close();
    await browser.close();
  }

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
  const nodes: unknown[] = [{ data: { id: "you", label: "You", kind: "person" } }, { data: { id: targetDomain, label: targetDomain, kind: "website" } }];
  const edges: unknown[] = [{ data: { source: "you", target: targetDomain } }];
  for (const service of services) {
    nodes.push({ data: { id: service.domain, label: service.name, kind: service.category, details: service } });
    edges.push({ data: { source: targetDomain, target: service.domain } });
  }
  return {
    status: "completed", scanner_version: config.scannerVersion, url: website, site_name: title, target_domain: targetDomain,
    score, score_label: scoreLabel(score),
    notice: "This score describes observable privacy exposure. It does not declare a site safe or unsafe.",
    limitations: ["This report observes one public page load.", "Cookie and storage values are intentionally not stored.", "Consent, location, and account state can change the result."],
    summary: { requests: requestCount, third_parties: services.length, cookies: cookies.length, third_party_cookies: thirdPartyCookies, storage_keys: storage.length, scripts: scripts.length },
    categories, services, first_party: firstParty, cookies, storage, scripts, graph: { nodes, edges },
  };
}

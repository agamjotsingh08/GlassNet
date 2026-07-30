// A browser process is expensive, but a Playwright context is the real
// isolation boundary. GlassNet reuses the process and creates a clean context
// for every scan, then recycles the process before it becomes long-lived.
import { chromium } from "playwright";
import type { Browser, BrowserContext, BrowserContextOptions } from "playwright";

const maxScansPerBrowser = 10;
const maxBrowserAgeMs = 20 * 60 * 1000;
const maxServerMemoryBytes = 350 * 1024 * 1024;

let currentBrowser: Browser | null = null;
let openingBrowser: Promise<Browser> | null = null;
let openedAt = 0;
let finishedScans = 0;
let activeContexts = 0;
let recycleRequested = false;
let launches = 0;

async function launchBrowser(): Promise<Browser> {
  let browser: Browser;
  try {
    browser = await chromium.launch({ headless: true });
  } catch {
    try {
      browser = await chromium.launch({ channel: "chrome", headless: true });
    } catch {
      throw new Error("GlassNet could not start an isolated browser. Windows or security software may be blocking browser automation.");
    }
  }

  launches += 1;
  openedAt = Date.now();
  finishedScans = 0;
  recycleRequested = false;
  browser.on("disconnected", () => {
    if (currentBrowser === browser) currentBrowser = null;
  });
  currentBrowser = browser;
  return browser;
}

async function getBrowser(): Promise<Browser> {
  if (currentBrowser?.isConnected()) return currentBrowser;
  if (!openingBrowser) {
    openingBrowser = launchBrowser().finally(() => {
      openingBrowser = null;
    });
  }
  return openingBrowser;
}

async function recycleWhenIdle() {
  const tooOld = openedAt > 0 && Date.now() - openedAt >= maxBrowserAgeMs;
  const serverMemoryHigh = process.memoryUsage().rss >= maxServerMemoryBytes;
  recycleRequested ||= finishedScans >= maxScansPerBrowser || tooOld || serverMemoryHigh;
  if (!recycleRequested || activeContexts > 0 || !currentBrowser) return;

  const browser = currentBrowser;
  currentBrowser = null;
  recycleRequested = false;
  await browser.close().catch(() => undefined);
}

export async function createIsolatedContext(options: BrowserContextOptions) {
  await recycleWhenIdle();
  const browser = await getBrowser();
  activeContexts += 1;
  let context: BrowserContext;

  try {
    context = await browser.newContext(options);
  } catch (error) {
    activeContexts -= 1;
    currentBrowser = null;
    await browser.close().catch(() => undefined);
    throw error;
  }

  let released = false;
  return {
    context,
    reusedBrowser: finishedScans > 0 || activeContexts > 1,
    release: async () => {
      if (released) return;
      released = true;
      await context.close().catch(() => undefined);
      activeContexts = Math.max(0, activeContexts - 1);
      finishedScans += 1;
      await recycleWhenIdle();
    },
  };
}

export function browserPoolStats() {
  return {
    connected: Boolean(currentBrowser?.isConnected()),
    launches,
    active_contexts: activeContexts,
    completed_contexts: finishedScans,
    browser_age_ms: openedAt ? Date.now() - openedAt : 0,
    recycle_after_scans: maxScansPerBrowser,
  };
}

export async function closeBrowserPool() {
  recycleRequested = true;
  if (activeContexts > 0 || !currentBrowser) return;
  const browser = currentBrowser;
  currentBrowser = null;
  await browser.close().catch(() => undefined);
}

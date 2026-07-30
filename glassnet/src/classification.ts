import { getDomain } from "tldts";
import type { Service } from "./types.js";

type Rule = Omit<Service, "domain" | "requests" | "types"> & { domains: string[] };

const rules: Rule[] = [
  { domains: ["google-analytics.com", "googletagmanager.com"], name: "Google Analytics", category: "Analytics", explanation: "Measures how visitors use the website so its owner can understand usage patterns.", essential: false, confidence: "verified", weight: 8 },
  { domains: ["doubleclick.net", "googlesyndication.com", "googleadservices.com"], name: "Google Advertising", category: "Advertising", explanation: "Helps deliver or measure advertising and may be used across websites.", essential: false, confidence: "verified", weight: 12 },
  { domains: ["facebook.com", "facebook.net", "connect.facebook.net"], name: "Meta Pixel", category: "Advertising", explanation: "May measure visits and advertising results for Meta services.", essential: false, confidence: "verified", weight: 12 },
  { domains: ["stripe.com", "stripe.network"], name: "Stripe", category: "Payment", explanation: "Provides payment and fraud-prevention services.", essential: true, confidence: "verified", weight: 2 },
  { domains: ["cloudflare.com", "cloudflare.net"], name: "Cloudflare", category: "Content delivery", explanation: "Helps deliver the website quickly and protect it from malicious traffic.", essential: true, confidence: "verified", weight: 1 },
  { domains: ["akamai.net", "akamaized.net", "akamaihd.net"], name: "Akamai", category: "Content delivery", explanation: "Delivers website files through nearby servers for speed and reliability.", essential: true, confidence: "verified", weight: 1 },
  { domains: ["fonts.googleapis.com", "fonts.gstatic.com"], name: "Google Fonts", category: "Website feature", explanation: "Downloads fonts used by the website's design.", essential: true, confidence: "verified", weight: 1 },
  { domains: ["hotjar.com", "hotjar.io"], name: "Hotjar", category: "Behavior analytics", explanation: "May record interaction patterns such as clicks, scrolling, and page movement.", essential: false, confidence: "verified", weight: 10 },
  { domains: ["sentry.io"], name: "Sentry", category: "Error monitoring", explanation: "Collects technical error information so developers can fix problems.", essential: true, confidence: "verified", weight: 2 },
];

export function mainDomain(hostname: string): string { return getDomain(hostname) || hostname; }

export function classify(domain: string): Omit<Service, "requests" | "types"> {
  for (const rule of rules) for (const option of rule.domains) {
    if (domain === option || domain.endsWith("." + option)) return { domain, ...rule };
  }
  return { domain, name: domain, category: "Other third party", explanation: "This outside service supplies content or functionality to the website.", essential: null, confidence: "unknown", weight: 3 };
}

export function scoreLabel(score: number): string {
  if (score >= 85) return "Low exposure";
  if (score >= 65) return "Moderate exposure";
  if (score >= 40) return "High exposure";
  return "Very high exposure";
}

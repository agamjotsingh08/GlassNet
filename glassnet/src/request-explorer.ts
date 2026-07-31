import type { RequestInfo } from "./types.js";

export function redactUrl(value: string): string {
  try {
    const parsed = new URL(value);
    if (!['http:', 'https:'].includes(parsed.protocol)) return "[browser context]";
    parsed.username = "";
    parsed.password = "";
    parsed.hash = "";
    const safePath = parsed.pathname.split("/").map((part) => {
      if (/^[^@\s]+@[^@\s]+\.[^@\s]+$/i.test(decodeURIComponent(part))) return "[redacted-email]";
      if (part.length > 40 && /[a-z]/i.test(part) && /\d/.test(part)) return "[redacted-id]";
      return part;
    }).join("/");
    const names = [...new Set([...parsed.searchParams.keys()].map((name) => {
      if (name.length > 40 || /^[^@\s]+@[^@\s]+\.[^@\s]+$/i.test(name)) return "parameter";
      return name.replace(/[^a-z0-9_.-]/gi, "_");
    }))];
    return `${parsed.origin}${safePath}${names.length ? `?${names.map((name) => `${encodeURIComponent(name)}=[redacted]`).join("&")}` : ""}`;
  } catch {
    return "[unavailable]";
  }
}

export function requestCategory(resourceType: string, serviceCategory: string): string {
  if (serviceCategory === "Analytics" || serviceCategory === "Behavior analytics") return "Analytics";
  if (serviceCategory === "Advertising") return "Advertising";
  if (serviceCategory === "Payment") return "Payments";
  const names: Record<string, string> = {
    document: "Documents", script: "Scripts", image: "Images", stylesheet: "Styles",
    font: "Fonts", fetch: "APIs", xhr: "APIs", websocket: "WebSockets", media: "Other",
  };
  return names[resourceType] || (serviceCategory === "Other third party" ? "Unknown" : "Other");
}

export function filterRequests(requests: RequestInfo[], query: Record<string, unknown>) {
  const search = String(query.search || "").trim().toLowerCase();
  const party = String(query.party || "");
  const type = String(query.type || "");
  const category = String(query.category || "");
  const consent = String(query.consent || "");
  const known = String(query.known || "");
  const status = Number(query.status || 0);
  const minimumBytes = Math.max(0, Number(query.min_bytes || 0));
  const page = Math.max(1, Number(query.page || 1));
  const pageSize = Math.min(100, Math.max(10, Number(query.page_size || 25)));
  const sort = ["timestamp_ms", "domain", "status", "transferred_bytes", "resource_type"].includes(String(query.sort)) ? String(query.sort) : "timestamp_ms";
  const direction = String(query.direction) === "desc" ? -1 : 1;

  const filtered = requests.filter((item) => {
    if (search && !`${item.domain} ${item.url}`.toLowerCase().includes(search)) return false;
    if (party && item.party !== party) return false;
    if (type && item.resource_type !== type) return false;
    if (category && item.category !== category) return false;
    if (consent && item.consent_state !== consent) return false;
    if (status && item.status !== status) return false;
    if (known === "known" && item.confidence === "unknown") return false;
    if (known === "unknown" && item.confidence !== "unknown") return false;
    return item.transferred_bytes >= minimumBytes;
  }).sort((left, right) => {
    const a = left[sort as keyof RequestInfo];
    const b = right[sort as keyof RequestInfo];
    return (typeof a === "number" && typeof b === "number" ? a - b : String(a).localeCompare(String(b))) * direction;
  });

  const start = (page - 1) * pageSize;
  return { items: filtered.slice(start, start + pageSize), page, page_size: pageSize, total: filtered.length, pages: Math.max(1, Math.ceil(filtered.length / pageSize)) };
}

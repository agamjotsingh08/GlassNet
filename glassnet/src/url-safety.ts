// URL safety is separate because every scanner entry point must follow the same rules.
import dns from "node:dns/promises";
import net from "node:net";

function isPublicAddress(address: string): boolean {
  if (net.isIP(address) === 4) {
    const part = address.split(".").map(Number);
    return !(part[0] === 0 || part[0] === 10 || part[0] === 127 ||
      (part[0] === 169 && part[1] === 254) ||
      (part[0] === 172 && part[1] >= 16 && part[1] <= 31) ||
      (part[0] === 192 && part[1] === 168));
  }
  const value = address.toLowerCase();
  return value !== "::1" && !value.startsWith("fc") && !value.startsWith("fd") && !value.startsWith("fe80:");
}

export async function safePublicUrl(value: unknown): Promise<string> {
  let text = String(value || "").trim();
  if (!text.startsWith("http://") && !text.startsWith("https://")) text = "https://" + text;
  const url = new URL(text);
  if (!url.hostname || !["http:", "https:"].includes(url.protocol)) throw new Error("Enter a valid public website address.");
  if (url.username || url.password || (url.port && !["80", "443"].includes(url.port))) throw new Error("Use a normal public website address.");
  const addresses = await dns.lookup(url.hostname, { all: true });
  if (!addresses.length || addresses.some((item) => !isPublicAddress(item.address))) throw new Error("Only public internet websites can be scanned.");
  return url.toString();
}

export async function isSafeRequestUrl(value: string): Promise<boolean> {
  try {
    await safePublicUrl(value);
    return true;
  } catch {
    return false;
  }
}

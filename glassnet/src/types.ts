// Shared shapes keep the scanner, API, database, and browser interface aligned.
export type CookieInfo = {
  domain: string;
  secure: boolean;
  httpOnly: boolean;
  sameSite: string;
  session: boolean;
  firstParty: boolean;
};

export type StorageInfo = { type: "localStorage" | "sessionStorage"; origin: string; key: string };
export type ScanMode = "quick" | "full";

export type ScanEvent = {
  sequence: number;
  offset_ms: number;
  type: "navigation" | "response" | "cookie" | "storage" | "script" | "complete";
  source: string;
  destination: string;
  category: string;
};

export type Service = {
  domain: string;
  name: string;
  category: string;
  explanation: string;
  essential: boolean | null;
  confidence: "verified" | "likely" | "unknown";
  weight: number;
  requests: number;
  types: string[];
};

export type ScanStatus = "created" | "validating" | "capturing" | "analyzing" | "completed" | "failed";

export type ScanResult = {
  id?: number;
  created_at?: string;
  status: ScanStatus;
  mode: ScanMode;
  scanner_version: string;
  url: string;
  site_name: string;
  target_domain: string;
  score: number;
  score_label: string;
  notice: string;
  limitations: string[];
  summary: { requests: number; third_parties: number; cookies: number; third_party_cookies: number; storage_keys: number; scripts: number };
  categories: Record<string, number>;
  services: Service[];
  first_party: { domain: string; requests: number; types: string[] }[];
  cookies: CookieInfo[];
  storage: StorageInfo[];
  scripts: string[];
  events: ScanEvent[];
  security_headers: Record<string, string>;
  graph: { nodes: unknown[]; edges: unknown[] };
};

// Shared data types. Keeping these in one file prevents the API, scanner, and
// storage code from disagreeing about what a scan report looks like.

export type CookieInfo = {
  domain: string;
  secure: boolean;
  httpOnly: boolean;
  sameSite: string;
  session: boolean;
  firstParty: boolean;
};

export type StorageInfo = { type: "localStorage" | "sessionStorage"; origin: string; key: string };

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
  graph: { nodes: unknown[]; edges: unknown[] };
};

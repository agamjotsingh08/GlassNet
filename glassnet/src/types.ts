// Shared shapes keep the scanner, API, database, and browser interface aligned.
export type CookieInfo = {
  name: string;
  domain: string;
  path: string;
  secure: boolean;
  httpOnly: boolean;
  sameSite: string;
  session: boolean;
  firstParty: boolean;
  expires_at: string | null;
  consent_state: "Not tested";
  purpose: string;
  purpose_category: string;
  purpose_confidence: "Known" | "Likely" | "Unknown";
  classification_source: string;
  security_notes: string[];
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

export type RequestInfo = {
  id: number;
  domain: string;
  url: string;
  method: string;
  resource_type: string;
  party: "First party" | "Third party";
  category: string;
  initiator: string;
  status: number;
  transferred_bytes: number;
  timestamp_ms: number;
  consent_state: "Not tested";
  confidence: "verified" | "likely" | "unknown";
  classification_method: string;
  redirect_from?: string;
};

export type Finding = {
  rule_id: string;
  title: string;
  category: string;
  severity: "low" | "medium" | "high" | "serious";
  confidence: "low" | "medium" | "high";
  explanation: string;
  beginner_explanation: string;
  evidence: string;
  limitation: string;
  remediation: string;
  ruleset_version: string;
};

export type SecurityCheck = {
  id: string;
  name: string;
  status: "Passed" | "Concern" | "Needs review" | "Not observed" | "Unable to test";
  severity: "info" | "low" | "medium" | "high";
  confidence: "low" | "medium" | "high";
  observation: string;
  why_it_matters: string;
  evidence: string;
  limitation: string;
  beginner_explanation: string;
};

export type RiskSummary = {
  level: "Low observed risk" | "Some concerns found" | "High observed risk" | "Unable to determine";
  summary: string;
  reasons: string[];
  concern_count: number;
  evidence_anchor: "findings";
  limitations: string[];
  ruleset_version: string;
};

export type FrameInfo = { url: string; domain: string; third_party: boolean; hidden: boolean; sandbox: string; };
export type FormInfo = { action: string; action_domain: string; action_missing: boolean; method: string; secure: boolean; third_party: boolean; sensitive_fields: string[]; autocomplete: string[]; };
export type PermissionInfo = { name: string; requested: boolean; policy_declared: boolean; scanner_decision: "Not granted"; };
export type DownloadInfo = { url: string; suggested_filename: string; timestamp_ms: number; cancelled: true; };

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
  requests: RequestInfo[];
  security_headers: Record<string, string>;
  final_url: string;
  redirect_chain: string[];
  iframes: FrameInfo[];
  forms: FormInfo[];
  permissions: PermissionInfo[];
  downloads: DownloadInfo[];
  script_signals: { suspicious_obfuscation: number; miner_signature: boolean; details: string[] };
  coverage: { page_loaded: boolean; duration_ms: number; redirects_followed: number; checks_completed: number; checks_unavailable: number };
  findings: Finding[];
  security_checks: SecurityCheck[];
  risk: RiskSummary;
  graph: { nodes: unknown[]; edges: unknown[] };
};

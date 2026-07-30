// Pure archive calculations are kept separate so they can be tested without
// opening a browser or writing to the local database.
export function necessityVerdict(category: string, essential: boolean | null, confidence: string): string {
  if (confidence === "unknown") return "Unknown";
  if (essential === true || ["Authentication", "Security", "Payments", "Content delivery"].includes(category)) return "Essential";
  if (["Advertising", "Social media"].includes(category)) return "Likely unnecessary";
  if (["Analytics", "Customer support", "Embedded content"].includes(category)) return "Optional";
  return "Operationally useful";
}

export function requirementStatus(actual: number | null, maximum: number): "passed" | "failed" | "inconclusive" {
  if (actual === null) return "inconclusive";
  return actual <= maximum ? "passed" : "failed";
}

export function forecastImpact(input: {
  domainCount: number;
  expectedScripts: number;
  cookieBehavior: string;
  storageUse: string;
  consentRequirement: string;
  organizationKnown: boolean;
}) {
  const cookieImpact = input.cookieBehavior === "none" ? 0 : input.cookieBehavior === "session" ? 1 : 3;
  const storageImpact = input.storageUse === "none" ? 0 : 2;
  return {
    label: "Forecast — not an observed scan",
    third_party_change: input.domainCount,
    dependency_depth_change: input.expectedScripts > 1 ? 2 : 1,
    cookie_footprint_change: cookieImpact,
    storage_footprint_change: storageImpact,
    consent_review: input.consentRequirement === "none" ? "Confirm that no consent boundary is needed" : "Consent boundary expected",
    privacy_debt_change: input.organizationKnown ? Math.max(0, input.domainCount - 1) : input.domainCount + 1,
    policy_disclosure: "Review whether the stated purpose and category require documentation.",
    uncertainty: "Actual behavior must be compared after deployment.",
  };
}

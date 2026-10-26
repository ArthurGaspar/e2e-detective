/**
 * Turns the evidence for one failed test into the numeric features the
 * classifier uses. Every feature is something a human investigator would also
 * look at; none of them reads the injected scenario.
 *
 * Features are always computed from evidence (never stored on their own), so a
 * change here applies to every past case at the next training run.
 */
import { locatorFromError, type NetworkCall, type TestEvidence } from "./evidence";
import { healLeads, parseLocator, type HealLead } from "./heal";

export const FEATURES = [
  "passed_on_retry",
  "failed_attempts",
  "same_error_every_attempt",
  "element_missing",
  "value_mismatch",
  "test_timeout",
  "api_5xx",
  "api_4xx",
  "requests_failed",
  "requests_pending",
  "console_errors",
  "slowest_api_s",
  "error_banner",
  "heal_score",
  "near_match_differs_by_number",
  "element_disabled",
  "failed_on_assertion",
] as const;

export type FeatureName = (typeof FEATURES)[number];
export type FeatureVector = Record<FeatureName, number>;

/** The evidence features are computed from; stored with every case and training sample. */
export interface FeatureInput {
  outcome: string;
  attempts: { error: string; api: NetworkCall[]; consoleErrors: string[] }[];
  /** ARIA snapshot of the page at the end of the last attempt. */
  snapshot: string;
  /** Best heal lead for the missing element, if any. */
  healLead: HealLead | null;
}

const API = /\/api\//;

export function inputFromEvidence(t: TestEvidence): FeatureInput {
  const last = t.attempts[t.attempts.length - 1];
  return {
    outcome: t.outcome,
    attempts: t.attempts.map((a) => ({ error: a.error, api: a.network.filter((n) => API.test(n.url)), consoleErrors: a.consoleErrors })),
    snapshot: last?.snapshot ?? "",
    healLead: last ? (healLeads(last.locator, last.candidates)[0] ?? null) : null,
  };
}

/** Removes numbers, quotes and timings so two runs of the same failure compare equal. */
export const errorSignature = (e: string) =>
  e
    .split("\n")
    .slice(0, 3)
    .join(" ")
    .replace(/\d+(\.\d+)?/g, "#")
    .replace(/\s+/g, " ")
    .trim();

export function extractFeatures(x: FeatureInput): FeatureVector {
  const lastError = x.attempts[x.attempts.length - 1]?.error ?? "";
  const api = x.attempts.flatMap((a) => a.api);
  const errors = x.attempts.map((a) => a.error);
  const noResponse = api.filter((n) => n.status === 0);

  return {
    passed_on_retry: x.outcome === "flaky" ? 1 : 0,
    failed_attempts: x.attempts.length,
    same_error_every_attempt: x.attempts.length > 1 && new Set(errors.map(errorSignature)).size === 1 ? 1 : 0,
    element_missing: /element\(s\) not found|waiting for (getBy|locator)|resolved to 0 elements/i.test(lastError) ? 1 : 0,
    value_mismatch: /Expected[\s\S]*Received/i.test(lastError) && !/element\(s\) not found/i.test(lastError) ? 1 : 0,
    test_timeout: /Test timeout of \d+ms exceeded/.test(lastError) ? 1 : 0,
    api_5xx: api.filter((n) => n.status >= 500).length,
    api_4xx: api.filter((n) => n.status >= 400 && n.status < 500).length,
    // No response with a network error (connection refused, dropped)...
    requests_failed: noResponse.filter((n) => n.failure).length,
    // ...versus no response yet: still in flight when the test gave up.
    requests_pending: noResponse.filter((n) => !n.failure).length,
    console_errors: x.attempts.reduce((s, a) => s + a.consoleErrors.length, 0),
    slowest_api_s: Math.round(Math.max(0, ...api.map((n) => n.ms)) / 100) / 10,
    error_banner: /alert[^\n]*(answered|Failed to fetch|cold)/i.test(x.snapshot) ? 1 : 0,
    heal_score: x.healLead?.score ?? 0,
    // "Closed cases (1)" where the test expected "Closed cases (2)": the page is in the wrong state.
    near_match_differs_by_number: numberOnlyDifference(lastError, x.healLead) ? 1 : 0,
    // The element is there but can't be used, which a rename doesn't explain.
    element_disabled: /element is not enabled|not enabled|is disabled/i.test(lastError) ? 1 : 0,
    failed_on_assertion: /^\s*(Error: )?expect\(/.test(lastError) ? 1 : 0,
  };
}

function numberOnlyDifference(error: string, lead: HealLead | null): boolean {
  const locator = locatorFromError(error);
  if (!locator || !lead) return false;
  const wanted = parseLocator(locator).value;
  const found = lead.candidate.name || lead.candidate.testId || "";
  const digits = /\d/;
  const strip = (s: string) => s.replace(/\d+/g, "#").trim().toLowerCase();
  return digits.test(wanted) && wanted !== found && strip(wanted) === strip(found);
}

export const toArray = (f: FeatureVector) => FEATURES.map((k) => f[k]);

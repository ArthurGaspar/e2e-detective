import type { Model } from "../../agent/src/model";
import type { Cause } from "../../agent/src/scenarios";
import type { CaseDoc, Index } from "../../agent/src/store";

export type { CaseDoc, Cause, Index, Model };

/**
 * Case documents live on the `runs-data` branch. In production the build sets
 * VITE_DATA_URL to that branch on raw.githubusercontent.com, so new patrols
 * show up without redeploying the site. In development, vite.config.ts serves
 * a local data directory at /data/.
 */
const DATA_URL: string = import.meta.env.VITE_DATA_URL ?? `${import.meta.env.BASE_URL}data/`;
// The patrol publishes a retrained model next to the cases; the bundled one is a fallback.
const BUNDLED_MODEL_URL = `${import.meta.env.BASE_URL}model.json`;

async function getJson<T>(url: string): Promise<T> {
  const res = await fetch(url, { cache: "no-cache" });
  if (!res.ok) throw new Error(`${url} answered ${res.status}`);
  return res.json() as Promise<T>;
}

export const loadIndex = () => getJson<Index>(`${DATA_URL}index.json`);
export const loadCase = (id: string) => getJson<CaseDoc>(`${DATA_URL}cases/${id}.json`);
export const loadModel = () => getJson<Model>(`${DATA_URL}model.json`).catch(() => getJson<Model>(BUNDLED_MODEL_URL));
export const assetUrl = (path: string) => `${DATA_URL}${path}`;

export const CAUSE_LABEL: Record<Cause, string> = {
  flaky: "Flaky",
  environment: "Environment",
  real_bug: "Real bug",
  outdated_test: "Outdated test",
};

export const CAUSE_BLURB: Record<Cause, string> = {
  flaky: "Timing or luck. The same test can pass on retry.",
  environment: "The infrastructure failed, not the code under test.",
  real_bug: "The app misbehaves. Someone needs to fix the code.",
  outdated_test: "The app changed on purpose; the test still uses old names.",
};

export const CAUSES: Cause[] = ["flaky", "environment", "real_bug", "outdated_test"];

export const FEATURE_LABEL: Record<string, string> = {
  passed_on_retry: "Passed on retry",
  failed_attempts: "Failed attempts",
  same_error_every_attempt: "Same error every attempt",
  element_missing: "Element not found",
  value_mismatch: "Wrong value shown",
  test_timeout: "Test timed out",
  api_5xx: "API 5xx responses",
  api_4xx: "API 4xx responses",
  requests_failed: "Requests that failed (network error)",
  requests_pending: "Requests still waiting at failure",
  console_errors: "Console errors",
  slowest_api_s: "Slowest API call (s)",
  error_banner: "Error banner on page",
  heal_score: "Best heal-lead score",
  near_match_differs_by_number: "Near match differs only by a number",
  element_disabled: "Element present but disabled",
  failed_on_assertion: "Failed on a check, not an action",
};

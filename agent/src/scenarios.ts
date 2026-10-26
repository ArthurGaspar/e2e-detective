/**
 * Faults the patrol can secretly inject into a test run. The `cause` is the
 * ground truth recorded with the run; the classifier never sees it.
 */
export type Cause = "flaky" | "environment" | "real_bug" | "outdated_test";

export const CAUSES: Cause[] = ["flaky", "environment", "real_bug", "outdated_test"];

export interface Scenario {
  id: string;
  cause: Cause | null;
  /** App build to load, via the crime scene's `release` switch. */
  release?: string;
  network?: "latency" | "outage" | "drop";
  /** Relative frequency when the patrol draws scenarios. */
  weight: number;
}

export const SCENARIOS: Scenario[] = [
  { id: "clean", cause: null, weight: 45 },
  { id: "latency", cause: "flaky", network: "latency", weight: 15 },
  { id: "outage", cause: "environment", network: "outage", weight: 6 },
  { id: "drop", cause: "environment", network: "drop", weight: 4 },
  { id: "bug-accuse", cause: "real_bug", release: "bug-accuse", weight: 5 },
  { id: "bug-evidence", cause: "real_bug", release: "bug-evidence", weight: 5 },
  { id: "bug-close", cause: "real_bug", release: "bug-close", weight: 5 },
  { id: "redesign", cause: "outdated_test", release: "redesign", weight: 15 },
];

export const scenarioById = (id: string) => SCENARIOS.find((s) => s.id === id) ?? SCENARIOS[0];

/** Weighted draw; `rand` returns a number in [0, 1). */
export function drawScenario(rand: () => number, faultsOnly = false): Scenario {
  const pool = faultsOnly ? SCENARIOS.filter((s) => s.cause) : SCENARIOS;
  const total = pool.reduce((s, x) => s + x.weight, 0);
  let r = rand() * total;
  for (const s of pool) {
    r -= s.weight;
    if (r < 0) return s;
  }
  return SCENARIOS[0];
}

/** Stable key for a test inside a chaos plan: "file.spec.ts > title". */
export const testKey = (file: string, title: string) => `${file.replace(/\\/g, "/").split("/").pop()} > ${title}`;

// Latency scenario: each API request has this chance of a delay longer than the
// 5 s action timeout, so a retry often (not always) passes.
export const SLOW_REQUEST_CHANCE = 0.45;
export const SLOW_REQUEST_MS: [number, number] = [5_500, 8_000];

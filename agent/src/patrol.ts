/**
 * One patrol: run every journey test once against the crime scene, with a
 * secretly drawn fault per test, then open a case for each failure.
 */
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import { readReport } from "./evidence";
import { extractFeatures, inputFromEvidence } from "./features";
import { healLeads } from "./heal";
import { type Model, predict, rulesVerdict, topCause } from "./model";
import { drawScenario, scenarioById, testKey } from "./scenarios";
import type { CaseDoc, RunDoc, Store } from "./store";

export const ROOT = resolve(import.meta.dirname, "../..");
export const MODEL_PATH = join(ROOT, "model/model.json");

export function loadModel(): Model | null {
  return existsSync(MODEL_PATH) ? (JSON.parse(readFileSync(MODEL_PATH, "utf8")) as Model) : null;
}

/** Small seedable PRNG (mulberry32) so a patrol's fault plan can be reproduced. */
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function playwright(args: string[], env: Record<string, string>) {
  return spawnSync("npx", ["playwright", "test", ...args], {
    cwd: ROOT,
    env: { ...process.env, ...env },
    encoding: "utf8",
    shell: process.platform === "win32",
    maxBuffer: 64 * 1024 * 1024,
  });
}

function listTests(): { key: string; title: string; file: string }[] {
  const res = playwright(["--list", "--reporter=json"], {});
  const json = JSON.parse(res.stdout.slice(res.stdout.indexOf("{")));
  const out: { key: string; title: string; file: string }[] = [];
  const walk = (s: { specs?: { title: string; file: string }[]; suites?: unknown[] }) => {
    for (const spec of s.specs ?? []) out.push({ key: testKey(spec.file, spec.title), title: spec.title, file: spec.file });
    for (const child of (s.suites ?? []) as (typeof s)[]) walk(child);
  };
  for (const s of json.suites) walk(s);
  return out;
}

export interface PatrolOptions {
  store: Store;
  model: Model | null;
  seed: number;
  trigger: string;
  target?: string;
  /** Force every test to this scenario (used by tests and demos). */
  scenario?: string;
  /** Never draw the clean scenario; sweeps use this to collect failures faster. */
  faultsOnly?: boolean;
}

export interface PatrolResult {
  run: RunDoc;
  cases: CaseDoc[];
}

export async function patrol(opts: PatrolOptions): Promise<PatrolResult> {
  const startedAt = new Date();
  const runId = `${startedAt.toISOString().replace(/[-:]/g, "").replace(/\.\d+Z$/, "Z")}-${opts.seed.toString(36)}`;
  const draw = rng(opts.seed);
  const tests = listTests();
  const plan = Object.fromEntries(tests.map((t) => [t.key, opts.scenario ?? drawScenario(draw, opts.faultsOnly).id]));

  const workDir = join(ROOT, ".patrol", runId);
  mkdirSync(workDir, { recursive: true });
  const reportPath = join(workDir, "report.json");
  const env: Record<string, string> = {
    CHAOS_PLAN: JSON.stringify(plan),
    PW_JSON_REPORT: reportPath,
    PW_OUTPUT_DIR: join(workDir, "results"),
  };
  if (opts.target) env.TARGET_URL = opts.target;
  playwright([], env);
  if (!existsSync(reportPath)) throw new Error("Playwright did not produce a report; is the crime scene reachable?");

  const evidence = readReport(reportPath, testKey);
  const cases: CaseDoc[] = [];
  const run: RunDoc = {
    _id: runId,
    startedAt: startedAt.toISOString(),
    finishedAt: new Date().toISOString(),
    target: opts.target ?? "http://localhost:4400/",
    trigger: opts.trigger,
    tests: [],
  };

  for (const t of evidence) {
    const scenario = scenarioById(plan[t.key] ?? "clean");
    const entry = {
      key: t.key,
      title: t.title,
      outcome: t.outcome,
      durationMs: t.attempts.reduce((s, a) => s + a.durationMs, 0),
      scenario: scenario.id,
      cause: scenario.cause,
    } as RunDoc["tests"][number];
    if (t.attempts.length) {
      const features = extractFeatures(inputFromEvidence(t));
      const last = t.attempts[t.attempts.length - 1];
      const suspects = opts.model ? predict(opts.model, features) : null;
      const rules = rulesVerdict(features);
      const cause = suspects ? topCause(suspects) : rules;
      const c: CaseDoc = {
        _id: `${runId}-${cases.length + 1}`,
        runId,
        openedAt: run.finishedAt,
        test: { key: t.key, title: t.title, file: t.file },
        outcome: t.outcome,
        attempts: t.attempts.map((a) => ({
          retry: a.retry,
          status: a.status,
          durationMs: a.durationMs,
          error: a.error,
          locator: a.locator,
          api: a.network.filter((n) => /\/api\//.test(n.url)),
          consoleErrors: a.consoleErrors,
        })),
        snapshot: last.snapshot,
        screenshot: null,
        features,
        suspects: suspects ?? ({ flaky: 0, environment: 0, real_bug: 0, outdated_test: 0, [rules]: 1 } as CaseDoc["suspects"]),
        verdict: { cause, confidence: suspects ? suspects[cause] : 1, by: suspects ? "model" : "rules" },
        rulesVerdict: rules,
        healLeads: healLeads(last.locator, last.candidates),
        truth: { scenario: scenario.id, cause: scenario.cause },
      };
      await opts.store.saveCase(c, last.screenshot);
      cases.push(c);
      entry.caseId = c._id;
    }
    run.tests.push(entry);
  }
  await opts.store.saveRun(run);
  rmSync(workDir, { recursive: true, force: true });
  return { run, cases };
}

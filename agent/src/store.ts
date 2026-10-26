/**
 * Run and case documents, stored as MongoDB-style JSON documents in a
 * directory (in CI, a checkout of the `runs-data` branch):
 *
 *   runs/<runId>.json      one document per patrol run
 *   cases/<caseId>.json    one document per failed test
 *   cases/<caseId>.jpg     last screencast frame of the failure
 *   index.json             summaries the dashboard loads first
 *
 * Documents keep MongoDB conventions (`_id`, nested fields), so a database
 * implementation of `Store` could replace the files without changing callers.
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Cause } from "./scenarios";
import type { FeatureInput, FeatureVector } from "./features";
import type { HealLead } from "./heal";
import type { NetworkCall } from "./evidence";

export interface RunTest {
  key: string;
  title: string;
  outcome: string;
  durationMs: number;
  scenario: string;
  cause: Cause | null;
  caseId?: string;
}

export interface RunDoc {
  _id: string;
  startedAt: string;
  finishedAt: string;
  target: string;
  trigger: string;
  tests: RunTest[];
}

export interface CaseReport {
  model: string;
  writtenAt: string;
  verdict: Cause;
  confidence: number;
  summary: string;
  clues: string[];
  nextStep: string;
  fixedLocator?: string;
}

export interface CaseDoc {
  _id: string;
  runId: string;
  openedAt: string;
  test: { key: string; title: string; file: string };
  outcome: string;
  attempts: {
    retry: number;
    status: string;
    durationMs: number;
    error: string;
    locator: string | null;
    api: NetworkCall[];
    consoleErrors: string[];
  }[];
  snapshot: string;
  screenshot: string | null;
  features: FeatureVector;
  suspects: Record<Cause, number>;
  verdict: { cause: Cause; confidence: number; by: "model" | "rules" };
  rulesVerdict: Cause;
  healLeads: HealLead[];
  /** What was really injected. Hidden from the classifier, used to score it. */
  truth: { scenario: string; cause: Cause | null };
  report?: CaseReport;
}

export interface CaseSummary {
  _id: string;
  runId: string;
  openedAt: string;
  test: string;
  verdict: Cause;
  confidence: number;
  truth: Cause | null;
  reported: boolean;
  healable: boolean;
}

export interface Index {
  updatedAt: string;
  cases: CaseSummary[];
  runs: { _id: string; startedAt: string; trigger: string; passed: number; failed: number; flaky: number }[];
}

export interface Store {
  saveRun(run: RunDoc): Promise<void>;
  saveCase(c: CaseDoc, screenshot: Uint8Array | null): Promise<void>;
  getCase(id: string): Promise<CaseDoc | null>;
  listCases(): Promise<CaseDoc[]>;
  rebuildIndex(): Promise<Index>;
}

/** The evidence a case's features are computed from. */
export const inputFromCase = (c: CaseDoc): FeatureInput => ({
  outcome: c.outcome,
  attempts: c.attempts,
  snapshot: c.snapshot,
  healLead: c.healLeads[0] ?? null,
});

const summarize = (c: CaseDoc): CaseSummary => ({
  _id: c._id,
  runId: c.runId,
  openedAt: c.openedAt,
  test: c.test.title,
  verdict: c.report?.verdict ?? c.verdict.cause,
  confidence: c.verdict.confidence,
  truth: c.truth.cause,
  reported: Boolean(c.report),
  healable: c.healLeads.length > 0,
});

const KEEP_CASES = 400;
const KEEP_RUNS = 300;

export class JsonStore implements Store {
  constructor(private dir: string) {
    mkdirSync(join(dir, "runs"), { recursive: true });
    mkdirSync(join(dir, "cases"), { recursive: true });
  }

  private write(rel: string, data: unknown) {
    writeFileSync(join(this.dir, rel), JSON.stringify(data, null, 1));
  }

  async saveRun(run: RunDoc) {
    this.write(`runs/${run._id}.json`, run);
  }

  async saveCase(c: CaseDoc, screenshot: Uint8Array | null) {
    if (screenshot) {
      writeFileSync(join(this.dir, `cases/${c._id}.jpg`), screenshot);
      c.screenshot = `cases/${c._id}.jpg`;
    }
    this.write(`cases/${c._id}.json`, c);
  }

  async getCase(id: string) {
    const p = join(this.dir, `cases/${id}.json`);
    return existsSync(p) ? (JSON.parse(readFileSync(p, "utf8")) as CaseDoc) : null;
  }

  async listCases() {
    return readdirSync(join(this.dir, "cases"))
      .filter((f) => f.endsWith(".json"))
      .map((f) => JSON.parse(readFileSync(join(this.dir, "cases", f), "utf8")) as CaseDoc);
  }

  private listRuns() {
    return readdirSync(join(this.dir, "runs"))
      .filter((f) => f.endsWith(".json"))
      .map((f) => JSON.parse(readFileSync(join(this.dir, "runs", f), "utf8")) as RunDoc);
  }

  /** Drops the oldest documents beyond the retention limits, then rewrites index.json. */
  async rebuildIndex(): Promise<Index> {
    const byNewest = <T extends { _id: string }>(a: T, b: T) => b._id.localeCompare(a._id);
    const cases = (await this.listCases()).sort(byNewest);
    for (const old of cases.splice(KEEP_CASES)) {
      rmSync(join(this.dir, `cases/${old._id}.json`), { force: true });
      rmSync(join(this.dir, `cases/${old._id}.jpg`), { force: true });
    }
    const runs = this.listRuns().sort(byNewest);
    for (const old of runs.splice(KEEP_RUNS)) rmSync(join(this.dir, `runs/${old._id}.json`), { force: true });

    const index: Index = {
      updatedAt: new Date().toISOString(),
      cases: cases.map(summarize),
      runs: runs.map((r) => ({
        _id: r._id,
        startedAt: r.startedAt,
        trigger: r.trigger,
        passed: r.tests.filter((t) => t.outcome === "expected").length,
        failed: r.tests.filter((t) => t.outcome === "unexpected").length,
        flaky: r.tests.filter((t) => t.outcome === "flaky").length,
      })),
    };
    this.write("index.json", index);
    return index;
  }
}

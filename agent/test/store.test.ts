import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { JsonStore, type CaseDoc } from "../src/store";

const dirs: string[] = [];
afterEach(() => { for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }); });

function fixture(): CaseDoc {
  return JSON.parse(readFileSync(new URL("../../dashboard/public/sample/cases/20261026T201535Z-26ah13-3.json", import.meta.url), "utf8"));
}

describe("archive summaries", () => {
  it("keeps the LLM verdict and its confidence together when it overrides the classifier", async () => {
    const dir = mkdtempSync(join(tmpdir(), "case-summary-"));
    dirs.push(dir);
    const store = new JsonStore(dir);
    const c = fixture();
    c.verdict = { cause: "environment", confidence: 0.92, by: "model" };
    c.report = { verdict: "real_bug", confidence: 0.61, model: "test-model", writtenAt: c.openedAt, summary: "A different diagnosis", clues: [], nextStep: "Review the trace" };
    await store.saveCase(c, null);
    const index = await store.rebuildIndex();
    expect(index.cases[0]).toMatchObject({ verdict: "real_bug", confidence: 0.61, reported: true });
  });

  it("uses the original verdict and confidence when no LLM report exists", async () => {
    const dir = mkdtempSync(join(tmpdir(), "case-summary-"));
    dirs.push(dir);
    const store = new JsonStore(dir);
    const c = fixture();
    await store.saveCase(c, null);
    const index = await store.rebuildIndex();
    expect(index.cases[0]).toMatchObject({ verdict: c.verdict.cause, confidence: c.verdict.confidence, reported: false });
  });
});

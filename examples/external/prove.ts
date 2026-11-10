import { spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { analyzeTrace, formatTraceReport, type Diagnosis, type ReportFormat } from "../../agent/src/analyze-trace";

const root = fileURLToPath(new URL("../../", import.meta.url));
const output = join(root, ".scratch/external-proof");
const result = spawnSync(process.execPath, ["node_modules/playwright/cli.js", "test", "-c", "examples/external/playwright.config.ts"], { cwd: root, stdio: "inherit" });
if (result.error) throw result.error;
if (result.status !== 1) throw new Error(`Expected two intentional test failures; Playwright exited ${result.status}.`);
const run = JSON.parse(readFileSync(join(output, "results.json"), "utf8"));
const specs: any[] = [];
const walk = (suite: any) => { specs.push(...suite.specs ?? []); for (const child of suite.suites ?? []) walk(child); };
for (const suite of run.suites) walk(suite);
if (specs.length !== 2) throw new Error("Expected exactly two external proof tests.");
const expectations: Record<string, { name: string; diagnosis: Diagnosis; error: RegExp }> = {
  "wrong count expectation": { name: "count", diagnosis: "assertion_mismatch", error: /1 item left/ },
  "missing archive control": { name: "locator", diagnosis: "locator_not_found", error: /Archive tasks/ },
};
mkdirSync(join(output, "reports"), { recursive: true });
for (const spec of specs) {
  const expected = expectations[spec.title];
  const attempt = spec.tests[0]?.results[0];
  if (!expected || attempt?.status !== "failed" || !expected.error.test(attempt.error?.message ?? "")) {
    throw new Error(`External setup failed instead of the intended assertion: ${spec.title}`);
  }
  const trace = attempt.attachments.find((a: any) => a.name === "trace");
  if (!trace?.path) throw new Error(`No trace for ${spec.title}.`);
  const report = analyzeTrace(resolve(root, trace.path));
  if (report.findings.length !== 1 || report.findings[0].diagnosis !== expected.diagnosis || !report.context.urls.some((url) => url.startsWith("https://demo.playwright.dev/todomvc/"))) {
    throw new Error(`Unexpected diagnosis for ${spec.title}: ${report.findings.map((f) => f.diagnosis).join(", ")}`);
  }
  for (const [format, extension] of [["json", "json"], ["markdown", "md"], ["sarif", "sarif"]] as [ReportFormat, string][]) {
    writeFileSync(join(output, "reports", `${expected.name}.${extension}`), formatTraceReport(report, format));
  }
  console.log(`Verified ${spec.title}: ${expected.diagnosis}`);
}
console.log(`External proof passed. Reports: ${join(output, "reports")}`);

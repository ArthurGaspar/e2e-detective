import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { strToU8, zipSync } from "fflate";
import { afterEach, describe, expect, it } from "vitest";
import { analyzeTrace, formatTraceReport, type ReportFormat } from "../src/analyze-trace";

const dirs: string[] = [];
const root = fileURLToPath(new URL("../../", import.meta.url));
const captured = (name: string) => fileURLToPath(new URL(`./fixtures/external/${name}.zip`, import.meta.url));
const dir = () => { const value = mkdtempSync(join(tmpdir(), "trace-analysis-")); dirs.push(value); return value; };
afterEach(() => { for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true }); });
const options = { type: "context-options", version: 8 };
function trace(entries: Record<string, unknown[]>): string {
  const path = join(dir(), "trace.zip");
  writeFileSync(path, zipSync(Object.fromEntries(Object.entries(entries).map(([name, events]) => [name, strToU8(events.map((e) => JSON.stringify(e)).join("\n"))]))));
  return path;
}

describe("standalone trace analysis", () => {
  it("diagnoses a real TodoMVC assertion using only the ZIP, without lab evidence", () => {
    const report = analyzeTrace(captured("count"));
    expect(report.status).toBe("failures_observed");
    expect(report.findings).toHaveLength(1); // deduplicates runner, browser and top-level errors
    expect(report.findings[0]).toMatchObject({ diagnosis: "assertion_mismatch", locator: "locator('.todo-count')", location: { line: 11 } });
    expect(report.findings[0].evidence[0].text).toContain('Expected: "2 items left"');
    expect(report.findings[0].evidence[0].text).toContain('Received: "1 item left"');
    expect(report.findings[0].evidence[0].source.entry).toBe("test.trace");
    expect(report.context.urls).toContain("https://demo.playwright.dev/todomvc/");
    expect(report.input.sha256).toMatch(/^[a-f0-9]{64}$/);
    expect(report.warnings).toEqual([]);
  });

  it("diagnoses an absent TodoMVC button without proposing an automatic replacement", () => {
    const report = analyzeTrace(captured("locator"));
    expect(report.findings).toHaveLength(1);
    expect(report.findings[0]).toMatchObject({ diagnosis: "locator_not_found", location: { line: 16 } });
    expect(report.findings[0].locator).toContain("Archive tasks");
    expect(report.findings[0].suggestions.every((s) => s.requiresReview)).toBe(true);
  });

  it("reads generic network endpoints, console errors and library-only traces", () => {
    const report = analyzeTrace(trace({
      "trace.trace": [options, { type: "before", callId: "call@1", method: "goto", params: { url: "https://app.test/" } },
        { type: "after", callId: "call@1", error: { message: "net::ERR_CONNECTION_REFUSED" } },
        { type: "console", messageType: "error", text: "Failed to fetch" }],
      "trace.network": [{ type: "resource-snapshot", snapshot: { request: { url: "https://user:secret@app.test/orders?token=secret#private" }, response: { status: 503 }, time: 42 } }],
    }));
    expect(report.findings.map((f) => f.diagnosis)).toEqual(["network_failure", "http_error"]);
    expect(report.context.network[0]).toMatchObject({ url: "https://app.test/orders", status: 503, durationMs: 42 });
    expect(report.context.consoleErrors).toEqual(["Failed to fetch"]);
    expect(report.warnings[0]).toContain("No test.trace");
    expect(JSON.stringify(report)).not.toContain("secret");
  });

  it("does not blame an unrelated HTTP error for an assertion failure", () => {
    const report = analyzeTrace(trace({
      "test.trace": [options, { type: "error", message: "Expected: 4\nReceived: 3", stack: [{ file: "tests/example.ts", line: 10 }] }],
      "0-trace.network": [{ type: "resource-snapshot", snapshot: { request: { url: "https://app.test/favicon.ico" }, response: { status: 404 } } }],
    }));
    expect(report.findings.map((f) => f.diagnosis)).toEqual(["assertion_mismatch", "http_error"]);
    expect(report.findings[1].suggestions[0].text).toContain("does not establish why");
  });

  it.each([
    ["waiting for getByRole('button')\nelement is not enabled", "action_not_ready"],
    ["Test timeout of 30000ms exceeded", "timeout"],
    ["Unexpected internal failure", "unclassified"],
  ])("classifies %s conservatively", (message, diagnosis) => {
    const report = analyzeTrace(trace({ "test.trace": [options, { type: "error", message }] }));
    expect(report.findings[0].diagnosis).toBe(diagnosis);
    expect(report.findings[0].suggestions[0].requiresReview).toBe(true);
  });

  it("does not invent a failure or claim success when none is recorded", () => {
    const report = analyzeTrace(trace({ "trace.trace": [options] }));
    expect(report.status).toBe("no_failure_observed");
    expect(report.findings).toEqual([]);
    expect(report.limitations.join(" ")).toContain("does not prove the test passed");
  });

  it("rejects invalid ZIPs and unrelated archives", () => {
    const path = join(dir(), "invalid.zip");
    writeFileSync(path, "not a zip");
    expect(() => analyzeTrace(path)).toThrow("Cannot read trace ZIP");
    expect(() => analyzeTrace(trace({ "data.trace": [{ arbitrary: true }] }))).toThrow("No recognizable Playwright trace");
  });

  it("warns about truncated NDJSON instead of hiding missing evidence", () => {
    const path = join(dir(), "partial.zip");
    writeFileSync(path, zipSync({ "test.trace": strToU8(JSON.stringify(options) + '\n{"type":') }));
    expect(analyzeTrace(path).warnings).toEqual(["Ignored 1 malformed record(s) in test.trace."]);
  });

  it("renders all formats with reviewable evidence, source locations and no automatic SARIF fixes", () => {
    const report = analyzeTrace(captured("count"));
    expect(JSON.parse(formatTraceReport(report, "json"))).toEqual(report);
    const markdown = formatTraceReport(report, "markdown");
    expect(markdown).toContain("Suggestions (review required)");
    expect(markdown).toContain('Received: "1 item left"');
    const sarif = JSON.parse(formatTraceReport(report, "sarif"));
    expect(sarif.version).toBe("2.1.0");
    expect(sarif.runs[0].results[0]).toMatchObject({ ruleId: "assertion_mismatch", properties: { requiresReview: true } });
    expect(sarif.runs[0].results[0].locations[0].physicalLocation.region.startLine).toBe(11);
    expect(sarif.runs[0].results[0].locations[0].physicalLocation.artifactLocation.uri).toMatch(/^file:\/\/\/E:/);
    expect(sarif.runs[0].results[0].fixes).toBeUndefined();
  });

  it("keeps trace content inside Markdown code fences", () => {
    const report = analyzeTrace(trace({ "test.trace": [options, { type: "error", message: "Error\n```\n<script>bad()</script>" }] }));
    const md = formatTraceReport(report, "markdown");
    expect(md).toContain("````text\nError\n```\n<script>bad()</script>\n````");
  });
});

describe("analyze-trace CLI", () => {
  const cli = (args: string[]) => spawnSync(process.execPath, ["--import", "tsx", "agent/src/cli.ts", "analyze-trace", ...args], {
    cwd: root, encoding: "utf8", env: { ...process.env, MONGODB_URI: "mongodb://unreachable.invalid/db" }, timeout: 20_000,
  });
  it.each(["json", "markdown", "sarif"] as ReportFormat[])("writes %s without connecting to MongoDB", (format) => {
    const output = join(dir(), "nested", `report.${format}`);
    const result = cli([captured("count"), "--format", format, "--output", output]);
    expect(result.status, result.stderr).toBe(0);
    expect(readFileSync(output, "utf8")).toBe(formatTraceReport(analyzeTrace(captured("count")), format));
    expect(result.stdout).toBe("");
  });
  it("prints machine-readable JSON to stdout", () => {
    const result = cli([captured("locator")]);
    expect(result.status, result.stderr).toBe(0);
    expect(JSON.parse(result.stdout).findings[0].diagnosis).toBe("locator_not_found");
  });
  it("rejects unsupported formats, missing inputs and overwriting the input", () => {
    for (const args of [[], ["missing.zip"], [captured("count"), "--format", "html"], [captured("count"), "--output", captured("count")]]) {
      expect(cli(args).status).toBe(1);
    }
  });
});

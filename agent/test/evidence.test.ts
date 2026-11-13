import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { zipSync } from "fflate";
import { expect, it } from "vitest";
import { readReport } from "../src/evidence";

it("uses only the masked screenshot and never falls back to a trace frame", () => {
  const dir = mkdtempSync(join(tmpdir(), "detective-evidence-"));
  try {
    const trace = join(dir, "trace.zip");
    const report = join(dir, "report.json");
    const screenshot = Buffer.from([0xff, 0xd8, 0xff, 0xd9]);
    const screenshotPath = join(dir, "masked.jpg");
    writeFileSync(screenshotPath, screenshot);
    writeFileSync(trace, zipSync({ "screencast/frame-1.jpeg": new Uint8Array([1, 2, 3]) }));
    const attachments = [{ name: "trace", path: trace, contentType: "application/zip" }];
    const result = { retry: 0, status: "failed", duration: 1, attachments };
    const masked = { name: "masked-screenshot", contentType: "image/jpeg" };
    writeFileSync(report, JSON.stringify({ suites: [{ specs: [{
      file: "example.spec.ts",
      title: "example",
      tests: [{ status: "unexpected", results: [
        result,
        { ...result, attachments: [...attachments, { ...masked, body: screenshot.toString("base64") }] },
        { ...result, attachments: [...attachments, { ...masked, path: screenshotPath }] },
      ] }],
    }] }] }));

    const [test] = readReport(report, (file, title) => `${file} > ${title}`);
    expect(test.attempts.map((attempt) => attempt.screenshot)).toEqual([null, screenshot, screenshot]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

it("redacts stored evidence and projects out request and response data", () => {
  const dir = mkdtempSync(join(tmpdir(), "detective-redact-"));
  try {
    const report = join(dir, "report.json");
    const forensics = {
      network: [{
        url: "https://example.test/api/customer?name=private",
        status: 503, ms: 42, request: { headers: ["private"], body: "private" },
        response: { headers: ["private"], body: "private" },
      }],
      snapshot: 'textbox "CPF": 529.982.247-25',
      consoleErrors: ["lookup failed for 52998224725"],
      candidates: [{ role: "heading", tag: "h1", name: "52998224725", testId: null }],
    };
    writeFileSync(report, JSON.stringify({ suites: [{ specs: [{
      file: "example.spec.ts", title: "example",
      tests: [{ status: "unexpected", results: [{
        retry: 0, status: "failed", duration: 1, error: { message: "Failed for person@example.test" },
        attachments: [{ name: "forensics", body: Buffer.from(JSON.stringify(forensics)).toString("base64") }],
      }] }],
    }] }] }));
    const [test] = readReport(report, (file, title) => `${file} > ${title}`);
    expect(test.attempts[0]).toMatchObject({
      error: "Failed for [EMAIL]",
      network: [{ url: "https://example.test/api/customer", status: 503, ms: 42 }],
      snapshot: 'textbox "CPF": [CPF]',
      consoleErrors: ["lookup failed for [CPF]"],
      candidates: [{ name: "[CPF]" }],
    });
    expect(JSON.stringify(test)).not.toContain("private");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

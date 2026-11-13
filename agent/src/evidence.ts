/**
 * Collects evidence for failed tests from a Playwright JSON report and the
 * trace.zip of each failed attempt.
 *
 * Trace files are newline-delimited JSON inside the zip: `N-trace.trace`
 * (browser actions, console messages) and `N-trace.network` (HAR-like
 * request entries), one pair per browser context. The format is internal to
 * Playwright, so every field is read defensively. Fields that only exist
 * because the fault was injected by the harness (such as `_wasFulfilled`)
 * are deliberately ignored: they would leak the answer.
 */
import { readFileSync } from "node:fs";
import { strFromU8, unzipSync } from "fflate";
import type { Candidate } from "./heal";
import { redactText, redactUrl } from "./redact";

export interface NetworkCall {
  url: string;
  status: number; // 0 when the request failed without a response
  ms: number;
  failure?: string;
}

export interface AttemptEvidence {
  retry: number;
  status: string;
  durationMs: number;
  error: string;
  /** The locator the failing step waited for, if the error names one. */
  locator: string | null;
  network: NetworkCall[];
  consoleErrors: string[];
  snapshot: string;
  candidates: Candidate[];
  /** Masked screenshot captured by the fixture, as a JPEG. */
  screenshot: Uint8Array | null;
}

export interface TestEvidence {
  key: string;
  file: string;
  title: string;
  /** Playwright's outcome: "expected", "unexpected" (failed) or "flaky" (failed, then passed on retry). */
  outcome: string;
  attempts: AttemptEvidence[];
}

// Playwright errors contain ANSI color codes.
const stripAnsi = (s: string) => s.replace(/\u001b\[[0-9;]*m/g, "");

export function locatorFromError(message: string): string | null {
  const m = message.match(/(?:Locator:|waiting for)\s+((?:getBy\w+|locator)\([^\n]*?\))(?=\s*(?:\n|$|to be|Expected))/);
  if (m) return m[1].trim();
  const any = message.match(/(getBy\w+\((?:[^()]|\([^()]*\))*\)(?:\.(?:getBy\w+|locator|first|nth)\((?:[^()]|\([^()]*\))*\))*)/);
  return any ? any[1] : null;
}

function readTrace(path: string): Pick<AttemptEvidence, "network" | "consoleErrors"> {
  const files = unzipSync(readFileSync(path));
  const lines = (name: string) =>
    strFromU8(files[name])
      .split("\n")
      .filter(Boolean)
      .flatMap((l) => {
        try {
          return [JSON.parse(l)];
        } catch {
          return [];
        }
      });

  const network: NetworkCall[] = [];
  const consoleErrors: string[] = [];
  for (const name of Object.keys(files)) {
    if (/^\d+-trace\.network$/.test(name)) {
      for (const e of lines(name)) {
        const s = e.snapshot ?? {};
        const url = typeof s.request?.url === "string" ? redactUrl(s.request.url) : "";
        if (!url) continue;
        network.push({
          url,
          // Requests that never got a response are recorded with status -1.
          status: Math.max(0, Number(s.response?.status ?? 0)),
          ms: Math.max(0, Number(s.time ?? 0)),
          failure: redactText(String(s.response?._failureText ?? s._failureText ?? "")) || undefined,
        });
      }
    }
    if (/^\d+-trace\.trace$/.test(name)) {
      for (const e of lines(name)) {
        if (e.type === "console" && e.messageType === "error") consoleErrors.push(redactText(String(e.text ?? "")).slice(0, 300));
      }
    }
  }
  return { network, consoleErrors };
}

interface ReportAttachment {
  name: string;
  path?: string;
  body?: string;
  contentType: string;
}

interface ReportResult {
  retry: number;
  status: string;
  duration: number;
  error?: { message?: string };
  errors?: { message?: string }[];
  attachments: ReportAttachment[];
}

interface ReportSpec {
  title: string;
  file: string;
  tests: { status: string; results: ReportResult[] }[];
}

interface ReportSuite {
  specs?: ReportSpec[];
  suites?: ReportSuite[];
}

function* specs(suite: ReportSuite): Generator<ReportSpec> {
  for (const s of suite.specs ?? []) yield s;
  for (const child of suite.suites ?? []) yield* specs(child);
}

function attachmentText(a: ReportAttachment): string | null {
  if (a.body) return Buffer.from(a.body, "base64").toString("utf8");
  if (a.path) return readFileSync(a.path, "utf8");
  return null;
}

/** Every test in the report with its outcome; failed attempts carry full evidence. */
export function readReport(reportPath: string, keyOf: (file: string, title: string) => string): TestEvidence[] {
  const report = JSON.parse(readFileSync(reportPath, "utf8")) as { suites: ReportSuite[] };
  const out: TestEvidence[] = [];
  for (const root of report.suites) {
    for (const spec of specs(root)) {
      for (const t of spec.tests) {
        const attempts = t.results
          .filter((r) => r.status !== "passed" && r.status !== "skipped")
          .map((r): AttemptEvidence => {
            const error = redactText(stripAnsi(r.error?.message ?? r.errors?.[0]?.message ?? ""));
            const trace = r.attachments.find((a) => a.name === "trace" && a.path);
            const forensicsRaw = r.attachments.find((a) => a.name === "forensics");
            const forensics = forensicsRaw ? JSON.parse(attachmentText(forensicsRaw) ?? "{}") : {};
            const collected = Array.isArray(forensics.network) && Array.isArray(forensics.consoleErrors)
              ? {
                network: (forensics.network as NetworkCall[]).flatMap(({ url, status, ms, failure }) => {
                  const safe = redactUrl(url);
                  return safe ? [{ url: safe, status, ms, failure: failure ? redactText(failure) : undefined }] : [];
                }),
                consoleErrors: (forensics.consoleErrors as string[]).map((line) => redactText(line).slice(0, 300)),
              }
              : trace?.path ? readTrace(trace.path) : { network: [], consoleErrors: [] };
            const masked = r.attachments.find((a) => a.name === "masked-screenshot" && a.contentType === "image/jpeg");
            return {
              retry: r.retry,
              status: r.status,
              durationMs: r.duration,
              error: error.slice(0, 2000),
              locator: locatorFromError(error),
              ...collected,
              screenshot: masked?.body ? Buffer.from(masked.body, "base64") : masked?.path ? readFileSync(masked.path) : null,
              snapshot: redactText(String(forensics.snapshot ?? "")).slice(0, 4000),
              candidates: ((forensics.candidates ?? []) as Candidate[]).map(({ role, name, testId, tag }) => ({
                role: redactText(role), name: redactText(name), testId: testId === null ? null : redactText(testId), tag: redactText(tag),
              })),
            };
          });
        out.push({ key: keyOf(spec.file, spec.title), file: spec.file, title: spec.title, outcome: t.status, attempts });
      }
    }
  }
  return out;
}

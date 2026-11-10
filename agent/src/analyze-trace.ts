/** Standalone, offline diagnosis of ordinary Playwright traces. No lab labels or model required. */
import { createHash } from "node:crypto";
import { readFileSync, statSync } from "node:fs";
import { basename } from "node:path";
import { strFromU8, unzipSync } from "fflate";
import { locatorFromError } from "./evidence";

export type Diagnosis = "assertion_mismatch" | "locator_not_found" | "action_not_ready" | "network_failure" | "http_error" | "timeout" | "unclassified";
export type ReportFormat = "json" | "markdown" | "sarif";
interface Location { file: string; line: number; column?: number }
interface Reference { entry: string; line: number; callId?: string }
export interface Finding {
  id: string;
  diagnosis: Diagnosis;
  summary: string;
  certainty: "observed" | "inconclusive";
  action: string | null;
  locator: string | null;
  location: Location | null;
  evidence: { kind: string; text: string; source: Reference }[];
  suggestions: { text: string; requiresReview: true }[];
}
export interface TraceReport {
  schemaVersion: 1;
  tool: "e2e-detective";
  input: { name: string; sha256: string };
  status: "failures_observed" | "no_failure_observed";
  findings: Finding[];
  context: { urls: string[]; consoleErrors: string[]; network: { url: string; status: number; durationMs: number; failure: string | null; source: Reference }[] };
  warnings: string[];
  limitations: string[];
}

type Event = Record<string, any>;
interface RecordEvent { event: Event; source: Reference }
const text = (value: unknown): string => typeof value === "string" ? value.replace(/\u001b\[[0-9;]*m/g, "") : "";
const object = (value: unknown): value is Event => value !== null && typeof value === "object" && !Array.isArray(value);
const finite = (value: unknown) => typeof value === "number" && Number.isFinite(value) ? Math.max(0, value) : 0;

function safeUrl(value: unknown): string {
  try {
    const url = new URL(text(value));
    url.username = "";
    url.password = "";
    url.search = "";
    url.hash = "";
    return url.toString();
  } catch { return ""; }
}

function location(stack: unknown): Location | null {
  if (!Array.isArray(stack)) return null;
  const frame = stack.find((s) => object(s) && text(s.file) && finite(s.line) >= 1);
  return frame ? { file: text(frame.file), line: Math.floor(frame.line), ...(finite(frame.column) >= 1 ? { column: Math.floor(frame.column) } : {}) } : null;
}

function diagnose(error: string): Pick<Finding, "diagnosis" | "summary" | "certainty" | "suggestions"> {
  let diagnosis: Diagnosis = "unclassified";
  let summary = "The trace records a failure whose cause needs investigation.";
  let suggestion = "Inspect the recorded error and failing step in Playwright Trace Viewer, reproduce it, and verify the application requirements before changing code.";
  if (/net::ERR_|ECONNREFUSED|ENOTFOUND|ERR_CONNECTION|Failed to fetch/i.test(error)) {
    diagnosis = "network_failure";
    summary = "A recorded operation failed to reach a network resource.";
    suggestion = "Check the failing endpoint, DNS, connectivity and service availability; rerun before changing the test or adding retries.";
  } else if (/element is not (enabled|visible|stable)|element is outside|intercepts pointer events|not enabled|is disabled/i.test(error)) {
    diagnosis = "action_not_ready";
    summary = "The target was found but could not receive the requested action.";
    suggestion = "Review visibility, disabled state, overlays and preceding application state. Confirm the intended interaction before changing waits or locators.";
  } else if (/element\(s\) not found|resolved to 0 elements/i.test(error) || /waiting for (?:getBy|locator)/i.test(error) && !/locator resolved to|unexpected value|Received:/i.test(error)) {
    diagnosis = "locator_not_found";
    summary = "The failing step waited for a locator that did not resolve in time.";
    suggestion = "Compare the locator with the recorded page and prerequisites. Check for a missing feature, wrong state or changed accessible name; confirm the intended control before proposing a replacement.";
  } else if (/Expected[\s\S]*Received|unexpected value/i.test(error)) {
    diagnosis = "assertion_mismatch";
    summary = "The observed value did not match the test's expectation.";
    suggestion = "Compare the expected and received values with the setup steps and product requirements. Correct the assertion only if its expectation is wrong; otherwise investigate the application state.";
  } else if (/timeout|timed out/i.test(error)) {
    diagnosis = "timeout";
    summary = "The recorded operation exceeded its time limit; the underlying cause is unresolved.";
    suggestion = "Review the last completed step, pending work and application readiness. Reproduce the delay before increasing timeouts or introducing retries.";
  }
  return { diagnosis, summary, certainty: diagnosis === "unclassified" || diagnosis === "timeout" ? "inconclusive" : "observed", suggestions: [{ text: suggestion, requiresReview: true }] };
}

/** Parses entries in memory, never extracts files or executes trace contents. */
export function analyzeTrace(path: string): TraceReport {
  if (statSync(path).size > 32 * 1024 * 1024) throw new Error("Trace exceeds the 32 MiB compressed input limit.");
  const bytes = readFileSync(path);
  let expanded = 0;
  let files: ReturnType<typeof unzipSync>;
  try {
    files = unzipSync(bytes, { filter: (entry) => {
      if (!/\.(trace|network|stacks)$/.test(entry.name)) return false;
      expanded += entry.originalSize;
      if (expanded > 128 * 1024 * 1024) throw new Error("Trace exceeds the 128 MiB expanded metadata limit.");
      return true;
    } });
  } catch (error) { throw new Error(`Cannot read trace ZIP: ${(error as Error).message}`); }
  const report: TraceReport = {
    schemaVersion: 1, tool: "e2e-detective",
    input: { name: basename(path), sha256: createHash("sha256").update(bytes).digest("hex") },
    status: "no_failure_observed", findings: [],
    context: { urls: [], consoleErrors: [], network: [] }, warnings: [],
    limitations: [
      "Diagnoses describe recorded symptoms; a single trace does not establish root cause or flakiness.",
      "No failure observed does not prove the test passed. Library-only traces can omit assertions and test-level errors.",
      "The lab-trained classifier is not used for external traces. Suggestions require human review and never edit source files.",
      "URLs in network context omit credentials, queries and fragments; error messages and source paths may still contain private data.",
      "Playwright trace metadata is an internal format; missing or unsupported records can limit this report.",
    ],
  };
  const records: RecordEvent[] = [];
  const stackByCall = new Map<string, Location>();
  for (const [entry, data] of Object.entries(files)) {
    if (entry.endsWith(".stacks")) {
      try {
        const stacks = JSON.parse(strFromU8(data));
        for (const [id, frames] of stacks.stacks ?? []) {
          const first = frames[0];
          const loc = first && location([{ file: stacks.files?.[first[0]], line: first[1], column: first[2] }]);
          if (loc) stackByCall.set(id, loc);
        }
      } catch { report.warnings.push(`Could not parse stack metadata in ${entry}.`); }
      continue;
    }
    let malformed = 0;
    strFromU8(data).split("\n").forEach((line, index) => {
      if (!line.trim()) return;
      try {
        const event = JSON.parse(line);
        if (!object(event) || typeof event.type !== "string") { malformed++; return; }
        records.push({ event, source: { entry, line: index + 1, ...(text(event.callId) ? { callId: text(event.callId) } : {}) } });
      } catch { malformed++; }
    });
    if (malformed) report.warnings.push(`Ignored ${malformed} malformed record(s) in ${entry}.`);
  }
  if (!records.some(({ event, source }) => source.entry.endsWith(".trace") && event.type === "context-options")) {
    throw new Error("No recognizable Playwright trace metadata found in ZIP.");
  }
  const before = new Map<string, Event>();
  // Runner records contain assertion details and source locations absent from browser records.
  const ordered = [...records].sort((a, b) => Number(a.source.entry === "test.trace") - Number(b.source.entry === "test.trace"));
  for (const { event } of ordered) if (event.type === "before" && text(event.callId)) before.set(event.callId, event);
  const failed = new Map<string, RecordEvent>();
  for (const record of ordered) {
    const { event: e, source } = record;
    if (e.type === "after" && object(e.error) && text(e.error.message)) failed.set(`${text(e.callId) || source.entry + ":" + source.line}`, record);
    if (e.type === "frame-snapshot") {
      const url = safeUrl(e.snapshot?.frameUrl);
      if (url && !report.context.urls.includes(url)) report.context.urls.push(url);
    }
    if (e.type === "console" && e.messageType === "error") report.context.consoleErrors.push(text(e.text).slice(0, 2000));
    if (e.type === "resource-snapshot" && object(e.snapshot)) {
      const s = e.snapshot;
      const url = safeUrl(s.request?.url);
      if (!url) continue;
      report.context.network.push({ url, status: finite(s.response?.status), durationMs: finite(s.time), failure: text(s.response?._failureText ?? s._failureText) || null, source });
    }
  }
  for (const { event: e, source } of failed.values()) {
    const start = before.get(text(e.callId));
    const error = text(e.error.message);
    const loc = location(start?.stack) ?? stackByCall.get(text(e.callId)) ?? null;
    report.findings.push({
      id: `F${report.findings.length + 1}`, ...diagnose(error),
      action: text(start?.title) || text(start?.method) || null,
      locator: text(start?.params?.locator) || locatorFromError(error) || text(start?.params?.selector) || null,
      location: loc,
      evidence: [{ kind: "error", text: error, source }],
    });
  }
  // Top-level failures (including test timeouts) may have no matching failed action.
  for (const { event: e, source } of records) {
    if (e.type !== "error" || !text(e.message)) continue;
    const error = text(e.message);
    if (report.findings.some((f) => f.evidence.some((x) => x.text === error))) continue;
    report.findings.push({ id: `F${report.findings.length + 1}`, ...diagnose(error), action: null, locator: locatorFromError(error), location: location(e.stack), evidence: [{ kind: "error", text: error, source }] });
  }
  for (const call of report.context.network.filter((n) => n.status >= 400 || n.failure)) {
    report.findings.push({
      id: `F${report.findings.length + 1}`, diagnosis: call.failure ? "network_failure" : "http_error",
      summary: call.failure ? "A network request failed without a usable response." : `A network request returned HTTP ${call.status}.`,
      certainty: "observed", action: null, locator: null, location: null,
      evidence: [{ kind: "network", text: `${call.url}: ${call.failure ?? `HTTP ${call.status}`}`, source: call.source }],
      suggestions: [{ text: "Check whether this resource is required by the failing step. Inspect the endpoint and server logs; this request alone does not establish why the test failed.", requiresReview: true }],
    });
  }
  if (report.findings.length) report.status = "failures_observed";
  if (!Object.keys(files).includes("test.trace")) report.warnings.push("No test.trace runner stream found; assertion and test outcome evidence may be absent.");
  return report;
}

const markdownText = (s: string) => s.replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[c]!);
function codeBlock(s: string): string {
  const fence = "`".repeat(Math.max(3, ...[...s.matchAll(/`+/g)].map((m) => m[0].length + 1)));
  return `${fence}text\n${s}\n${fence}`;
}

export function formatTraceReport(report: TraceReport, format: ReportFormat): string {
  if (format === "json") return JSON.stringify(report, null, 2) + "\n";
  if (format === "markdown") {
    return [
      "# Trace investigation", `Input: ${markdownText(report.input.name)}`, `SHA-256: ${report.input.sha256}`, `Status: ${report.status}`,
      ...report.findings.flatMap((f) => [
        `## ${f.id}: ${f.diagnosis}`, f.summary, `Certainty: ${f.certainty}`,
        ...(f.action ? [`Action: ${markdownText(f.action)}`] : []),
        ...(f.location ? [`Source: ${markdownText(f.location.file)}:${f.location.line}:${f.location.column ?? 1}`] : []),
        ...(f.locator ? ["Locator:", codeBlock(f.locator)] : []),
        ...f.evidence.flatMap((e) => [`Evidence: ${markdownText(e.source.entry)}:${e.source.line}${e.source.callId ? ` (${markdownText(e.source.callId)})` : ""}`, codeBlock(e.text)]),
        "Suggestions (review required):", ...f.suggestions.map((s) => `- ${s.text}`),
      ]),
      "## Context", "Network requests:", codeBlock(JSON.stringify(report.context.network, null, 2)),
      "Console errors:", codeBlock(report.context.consoleErrors.join("\n") || "None recorded"),
      "## Warnings", ...report.warnings.map((w) => `- ${markdownText(w)}`),
      "## Limits", ...report.limitations.map((l) => `- ${l}`), "",
    ].join("\n\n");
  }
  const uri = (file: string) => /^[A-Za-z]:[\\/]/.test(file) ? `file:///${file.replace(/\\/g, "/").split("/").map((part, i) => i === 0 ? part : encodeURIComponent(part)).join("/")}` : file.startsWith("/") ? `file://${file.split("/").map(encodeURIComponent).join("/")}` : file.replace(/\\/g, "/").split("/").map(encodeURIComponent).join("/");
  const diagnoses = [...new Set(report.findings.map((f) => f.diagnosis))];
  return JSON.stringify({
    $schema: "https://json.schemastore.org/sarif-2.1.0.json", version: "2.1.0",
    runs: [{
      tool: { driver: { name: report.tool, rules: diagnoses.map((id) => ({ id, shortDescription: { text: id.replaceAll("_", " ") } })) } },
      results: report.findings.map((f) => ({
        ruleId: f.diagnosis, level: "warning", message: { text: `${f.summary}\n${f.evidence.map((e) => e.text).join("\n")}\nReview: ${f.suggestions.map((s) => s.text).join(" ")}` },
        ...(f.location ? { locations: [{ physicalLocation: { artifactLocation: { uri: uri(f.location.file) }, region: { startLine: f.location.line, ...(f.location.column ? { startColumn: f.location.column } : {}) } } }] } : {}),
        properties: { findingId: f.id, certainty: f.certainty, evidence: f.evidence, suggestions: f.suggestions, requiresReview: true },
      })),
      invocations: [{ executionSuccessful: true }],
      properties: { input: report.input, status: report.status, warnings: report.warnings, limitations: report.limitations, context: report.context },
    }],
  }, null, 2) + "\n";
}

/**
 * The interrogation: an LLM reads the evidence of a case and writes a report.
 *
 * The model gets a compact case brief (key clues in plain words, errors, API
 * calls, console, page snapshot), never the ground truth. It does not see the
 * classifier's verdict either: small models copy whatever answer they are
 * shown, and a second opinion is only useful if it is independent. Its reply
 * is validated before it is stored, so a malformed or off-list verdict cannot
 * reach the dashboard.
 */
import { CAUSES, type Cause } from "./scenarios";
import { parseJson, type Llm } from "./llm";
import { extractFeatures } from "./features";
import { inputFromCase, type CaseDoc, type CaseReport } from "./store";

const SYSTEM = `You are a QA detective. A browser test failed; decide why.
Possible causes:
- flaky: timing or nondeterminism; the same test can pass on retry. Typical clues: passed on retry, API requests still waiting for a response (slow) when the test stopped.
- environment: the infrastructure failed, not the code under test. Typical clues: HTTP 5xx, requests that failed with a network error, error banners about the server.
- real_bug: the app misbehaves. Typical clues: the element is there but shows the wrong value or message, consistently on every attempt, with healthy network calls.
- outdated_test: the app changed on purpose and the test still uses old names. Typical clues: an element is missing, but a similar one with a new name is on the page.
Reply with JSON only:
{"verdict": "flaky|environment|real_bug|outdated_test", "confidence": 0.0-1.0, "summary": "<one sentence>", "clues": ["<short clue>", "..."], "nextStep": "<what a developer should do>", "fixedLocator": "<only for outdated_test: the Playwright locator to use instead>"}`;

/** The case's notable features, in plain words. Small models use these far better than raw logs. */
function keyClues(c: CaseDoc): string {
  const f = extractFeatures(inputFromCase(c));
  const lead = c.healLeads[0];
  const clues = [
    f.passed_on_retry && "The test passed when it was retried.",
    f.requests_pending && `${f.requests_pending} API request(s) were still waiting for a response when the test stopped (slow, not refused).`,
    f.requests_failed && `${f.requests_failed} API request(s) failed with a network error.`,
    f.api_5xx && `${f.api_5xx} API response(s) were server errors (5xx).`,
    f.error_banner && "The page shows an error message about the server.",
    f.element_disabled && "The element the test needed is on the page but disabled.",
    f.near_match_differs_by_number && lead && `A near match is on the page, differing only by a number: ${lead.candidate.name || lead.candidate.testId}. The page is in the wrong state.`,
    !f.near_match_differs_by_number && lead && `The missing element may have been renamed; similar elements: ${c.healLeads.map((l) => `${l.locator} (similarity ${l.score})`).join("; ")}.`,
    f.same_error_every_attempt && "The same error happened on every attempt.",
  ].filter(Boolean);
  return clues.length ? `Key clues:\n- ${clues.join("\n- ")}` : "";
}

/** The case file as the model sees it: evidence only, no ground truth. */
function caseBrief(c: CaseDoc): string {
  const attempts = c.attempts
    .map((a, i) => {
      const api = a.api
        .map((n) => {
          const path = new URL(n.url).pathname;
          if (n.status) return `${n.status} ${path} ${Math.round(n.ms)}ms`;
          return n.failure ? `${path} failed: ${n.failure}` : `${path} still waiting for a response when the test stopped`;
        })
        .join("; ");
      return [
        `Attempt ${i + 1} (${a.status}, ${Math.round(a.durationMs)}ms)`,
        `  error: ${a.error.split("\n").slice(0, 6).join(" | ").slice(0, 600)}`,
        `  API calls: ${api || "none"}`,
        a.consoleErrors.length ? `  console errors: ${a.consoleErrors.slice(0, 3).join(" | ")}` : "",
      ]
        .filter(Boolean)
        .join("\n");
    })
    .join("\n");
  return [
    `Test: ${c.test.title}`,
    `Outcome: ${c.outcome === "flaky" ? "failed, then passed on retry" : "failed on every attempt"}`,
    keyClues(c),
    attempts,
    `Page at the end of the last attempt (ARIA snapshot):\n${c.snapshot.slice(0, 1800)}`,
  ]
    .filter(Boolean)
    .join("\n\n");
}

export function validateReport(raw: unknown, model: string): CaseReport {
  const r = raw as Partial<CaseReport> & { confidence?: unknown };
  if (!r || !CAUSES.includes(r.verdict as Cause)) throw new Error(`invalid verdict: ${JSON.stringify(r?.verdict)}`);
  const confidence = Math.min(1, Math.max(0, Number(r.confidence)));
  if (!Number.isFinite(confidence)) throw new Error("confidence is not a number");
  return {
    model,
    writtenAt: new Date().toISOString(),
    verdict: r.verdict as Cause,
    confidence: Math.round(confidence * 100) / 100,
    summary: String(r.summary ?? "").slice(0, 400),
    clues: (Array.isArray(r.clues) ? r.clues : []).map(String).slice(0, 6),
    nextStep: String(r.nextStep ?? "").slice(0, 400),
    fixedLocator: r.verdict === "outdated_test" && r.fixedLocator ? String(r.fixedLocator).slice(0, 200) : undefined,
  };
}

export async function interrogate(llm: Llm, c: CaseDoc, tries = 2): Promise<CaseReport> {
  let lastError = "";
  for (let i = 0; i < tries; i++) {
    const reply = await llm.chat(
      [
        { role: "system", content: SYSTEM },
        { role: "user", content: caseBrief(c) + (lastError ? `\n\nYour previous reply was invalid (${lastError}). Follow the JSON format exactly.` : "") },
      ],
      { json: true },
    );
    try {
      return validateReport(parseJson(reply), llm.model);
    } catch (err) {
      lastError = (err as Error).message;
    }
  }
  throw new Error(`No valid report after ${tries} tries: ${lastError}`);
}

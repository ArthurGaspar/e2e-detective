import { describe, expect, it } from "vitest";
import { locatorFromError } from "../src/evidence";
import { FEATURES, errorSignature, extractFeatures, inputFromEvidence, type FeatureVector } from "../src/features";
import { checkStep, quotedValues, suggest } from "../src/generate";
import { applyHeal, healLeads, parseLocator, similarity } from "../src/heal";
import { validateReport } from "../src/investigate";
import { evaluate, predict, rulesVerdict, topCause, train, type Sample } from "../src/model";
import { drawScenario, SCENARIOS } from "../src/scenarios";
import { rng } from "../src/patrol";
import type { TestEvidence } from "../src/evidence";

const zero = Object.fromEntries(FEATURES.map((f) => [f, 0])) as FeatureVector;
const fv = (over: Partial<FeatureVector>): FeatureVector => ({ ...zero, ...over });

describe("locatorFromError", () => {
  it("finds the locator in an expect failure", () => {
    const msg = "Error: expect(locator).toBeVisible() failed\n\nLocator: getByRole('heading', { name: 'Case board' })\nExpected: visible";
    expect(locatorFromError(msg)).toBe("getByRole('heading', { name: 'Case board' })");
  });
  it("finds the locator in an action timeout", () => {
    const msg = "TimeoutError: locator.click: Timeout 5000ms exceeded.\nCall log:\n  - waiting for getByTestId('close-case')\n";
    expect(locatorFromError(msg)).toBe("getByTestId('close-case')");
  });
  it("returns null without a locator", () => {
    expect(locatorFromError("Error: net::ERR_CONNECTION_REFUSED")).toBeNull();
  });
});

describe("heal", () => {
  it("parses role, test id and text locators", () => {
    expect(parseLocator("getByRole('button', { name: 'Add evidence' })")).toEqual({ kind: "role", role: "button", value: "Add evidence" });
    expect(parseLocator("getByTestId('close-case')")).toEqual({ kind: "testid", value: "close-case" });
    expect(parseLocator("locator('#x')").kind).toBe("other");
  });

  it("ranks the renamed button first", () => {
    const leads = healLeads("getByRole('button', { name: 'Add evidence' })", [
      { role: "button", name: "Sign out", testId: null, tag: "button" },
      { role: "button", name: "Log evidence", testId: "log-evidence-btn", tag: "button" },
      { role: "heading", name: "Evidence (2)", testId: null, tag: "h2" },
    ]);
    expect(leads[0].locator).toBe("getByRole('button', { name: 'Log evidence' })");
  });

  it("maps a renamed test id to the new test id", () => {
    const leads = healLeads("getByTestId('close-case')", [{ role: "button", name: "Archive case", testId: "archive-btn", tag: "button" }]);
    expect(leads[0]?.locator).toBe("getByTestId('archive-btn')");
  });

  it("ignores an identical element, which is not a rename", () => {
    expect(healLeads("getByRole('button', { name: 'Save' })", [{ role: "button", name: "Save", testId: null, tag: "button" }])).toEqual([]);
  });

  it("patches a double-quoted spec from a single-quoted error locator", () => {
    const src = `await page.getByRole("link", { name: "Open case file: X", exact: true }).click();
`;
    const out = applyHeal(src, "getByRole('link', { name: 'Open case file: X', exact: true })", "getByRole('link', { name: 'View file: X' })");
    expect(out).toBe(`await page.getByRole("link", { name: "View file: X" }).click();
`);
  });

  it("returns null when the locator is not in the source", () => {
    expect(applyHeal("await page.goto(\"./\");", "getByTestId('nope')", "getByTestId('x')")).toBeNull();
  });

  it("scores similar strings higher", () => {
    expect(similarity("Add evidence", "Log evidence")).toBeGreaterThan(similarity("Add evidence", "Sign out"));
  });
});

describe("features", () => {
  const evidence = (over: Partial<TestEvidence["attempts"][number]>, outcome = "unexpected"): TestEvidence => ({
    key: "k",
    file: "f.spec.ts",
    title: "t",
    outcome,
    attempts: [
      { retry: 0, status: "failed", durationMs: 100, error: "", locator: null, network: [], consoleErrors: [], snapshot: "", candidates: [], screenshot: null, ...over },
    ],
  });

  const features = (over: Partial<TestEvidence["attempts"][number]>, outcome?: string) =>
    extractFeatures(inputFromEvidence(evidence(over, outcome)));

  it("counts 5xx and failed API calls but ignores static files", () => {
    const f = features({
      network: [
        { url: "http://x/api/a.json", status: 503, ms: 10 },
        { url: "http://x/api/b.json", status: 0, ms: 5, failure: "net::ERR_CONNECTION_REFUSED" },
        { url: "http://x/app.js", status: 500, ms: 5 },
      ],
    });
    expect([f.api_5xx, f.requests_failed]).toEqual([1, 1]);
  });

  it("separates dropped requests from ones still in flight", () => {
    const f = features({
      network: [
        { url: "http://x/api/a.json", status: 0, ms: 3, failure: "net::ERR_INTERNET_DISCONNECTED" },
        { url: "http://x/api/b.json", status: 0, ms: 0 },
      ],
    });
    expect([f.requests_failed, f.requests_pending]).toEqual([1, 1]);
  });

  it("tells a counter that's off by one from a renamed element", () => {
    const counterError = "Error: expect(locator).toBeVisible() failed\n\nLocator: getByRole('heading', { name: 'Closed cases (2)' })\nError: element(s) not found";
    const off = extractFeatures({
      outcome: "unexpected",
      attempts: [{ error: counterError, api: [], consoleErrors: [] }],
      snapshot: "",
      healLead: { locator: "x", score: 0.9, candidate: { role: "heading", name: "Closed cases (1)", testId: null, tag: "h2" } },
    });
    const renamed = extractFeatures({
      outcome: "unexpected",
      attempts: [{ error: counterError.replace("Closed cases (2)", "Case board"), api: [], consoleErrors: [] }],
      snapshot: "",
      healLead: { locator: "x", score: 0.4, candidate: { role: "heading", name: "Investigations", testId: null, tag: "h1" } },
    });
    expect([off.near_match_differs_by_number, off.failed_on_assertion]).toEqual([1, 1]);
    expect(renamed.near_match_differs_by_number).toBe(0);
  });

  it("notices a disabled element", () => {
    expect(features({ error: "TimeoutError: locator.click: Timeout 5000ms exceeded.\n  - element is not enabled" }).element_disabled).toBe(1);
  });

  it("flags a pass on retry", () => {
    expect(features({}, "flaky").passed_on_retry).toBe(1);
  });

  it("separates a missing element from a wrong value", () => {
    const missing = features({ error: "Locator: getByText('x')\nError: element(s) not found" });
    const wrong = features({ error: "Locator: getByTestId('n')\nExpected: \"3\"\nReceived: \"2\"" });
    expect([missing.element_missing, missing.value_mismatch]).toEqual([1, 0]);
    expect([wrong.element_missing, wrong.value_mismatch]).toEqual([0, 1]);
  });

  it("normalizes numbers out of error signatures", () => {
    expect(errorSignature("Timeout 5000ms exceeded at 12:00")).toBe(errorSignature("Timeout 4870ms exceeded at 13:41"));
  });
});

describe("classifier", () => {
  const samples: Sample[] = [];
  const r = rng(1);
  for (let i = 0; i < 60; i++) {
    const noise = () => (r() < 0.1 ? 1 : 0);
    samples.push({ cause: "flaky", features: fv({ passed_on_retry: 1 - noise(), requests_pending: 1, element_missing: 1 }) });
    samples.push({ cause: "environment", features: fv({ api_5xx: 1 + noise(), console_errors: 1, error_banner: 1, element_missing: 1 }) });
    samples.push({ cause: "real_bug", features: fv({ value_mismatch: 1, same_error_every_attempt: 1, failed_attempts: 2 }) });
    samples.push({ cause: "outdated_test", features: fv({ element_missing: 1, same_error_every_attempt: 1, heal_score: 0.4 + r() * 0.3 }) });
  }

  it("learns separable causes", () => {
    const m = train(samples);
    expect(topCause(predict(m, fv({ api_5xx: 1, error_banner: 1, element_missing: 1 })))).toBe("environment");
    expect(topCause(predict(m, fv({ element_missing: 1, same_error_every_attempt: 1, heal_score: 0.6 })))).toBe("outdated_test");
  });

  it("returns probabilities that sum to one", () => {
    const p = predict(train(samples), fv({}));
    expect(Object.values(p).reduce((a, b) => a + b, 0)).toBeCloseTo(1, 2);
  });

  it("reports cross-validated accuracy alongside the baselines", () => {
    const m = evaluate(samples);
    expect(m.samples).toBe(samples.length);
    expect(m.accuracy).toBeGreaterThan(m.majorityAccuracy);
    expect(m.confusion.flat().reduce((a, b) => a + b, 0)).toBe(samples.length);
  });

  it("rules follow the manual checklist", () => {
    expect(rulesVerdict(fv({ passed_on_retry: 1, api_5xx: 2 }))).toBe("flaky");
    expect(rulesVerdict(fv({ api_5xx: 1 }))).toBe("environment");
    expect(rulesVerdict(fv({ element_missing: 1, heal_score: 0.5 }))).toBe("outdated_test");
    expect(rulesVerdict(fv({ value_mismatch: 1 }))).toBe("real_bug");
  });
});

describe("scenarios", () => {
  it("draws every scenario with a seeded generator", () => {
    const r = rng(42);
    const seen = new Set(Array.from({ length: 2000 }, () => drawScenario(r).id));
    expect(seen.size).toBe(SCENARIOS.length);
  });
});

describe("report validation", () => {
  it("accepts a well-formed report and clamps confidence", () => {
    const r = validateReport({ verdict: "flaky", confidence: 1.4, summary: "s", clues: ["a"], nextStep: "n" }, "m");
    expect(r.confidence).toBe(1);
    expect(r.fixedLocator).toBeUndefined();
  });
  it("rejects a verdict outside the list", () => {
    expect(() => validateReport({ verdict: "aliens", confidence: 0.5 }, "m")).toThrow(/invalid verdict/);
  });
});

describe("recorder guards", () => {
  const check = (item: string, step: Parameters<typeof checkStep>[1]) => checkStep(item, step, quotedValues(item));

  it("requires a check for a check item", () => {
    expect(check("Check that the 'Case board' heading is visible", { action: "click", target: { role: "button", name: "Case board" } })).toHaveProperty("error");
  });
  it("requires quoted values to be used", () => {
    expect(check("Fill the password field with 'elementary'", { action: "fill", target: { label: "Password" }, value: "secret" })).toHaveProperty("error");
    expect(check("Fill the password field with 'elementary'", { action: "fill", target: { label: "Password" }, value: "elementary" })).toEqual({ covered: ["elementary"] });
  });
  it("covers a multi-value item one value at a time", () => {
    const item = "Check that the suspects 'Dona Neide' and 'Tio Juca' are listed";
    expect(checkStep(item, { action: "expect_visible", target: { text: "Tio Juca" } }, quotedValues(item))).toEqual({ covered: ["tio juca"] });
  });
  it("does not treat apostrophes as quotes", () => {
    expect(quotedValues("Check the detective's name is shown")).toEqual([]);
  });
  it("suggests the closest names from a snapshot", () => {
    const snap = '- heading "Case board" [level=1]\n- link "Open case file: The Missing Brigadeiro"\n- link "Open case file: The Midnight Samba"';
    expect(suggest(snap, { role: "link", name: "Missing Brigadeiro" })[0]).toBe('link "Open case file: The Missing Brigadeiro"');
  });
});

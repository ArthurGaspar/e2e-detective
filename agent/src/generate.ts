/**
 * Journey -> Playwright test, by exploring the live app.
 *
 * Small local models are poor at writing a whole test in one go: they invent
 * page details and repeat mistakes during repair. Here the model drives a real
 * browser one step at a time instead. At each step it sees the current page's
 * ARIA snapshot and returns one action as JSON. The agent checks that the
 * locator matches exactly one element and that assertions hold *now*, rejects
 * anything else with a short reason, and records accepted steps as code. The
 * finished spec is then run once against the clean app to confirm it.
 */
import { spawn, spawnSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import { chromium, type Locator, type Page } from "@playwright/test";
import { similarity } from "./heal";
import { parseJson, type ChatMessage, type Llm } from "./llm";
import { ROOT } from "./patrol";

const SCENE = "http://localhost:4400/";
const MAX_STEPS = 30;

async function ensureScene(): Promise<() => void> {
  const up = () => fetch(SCENE).then((r) => r.ok, () => false);
  if (await up()) return () => {};
  const child = spawn("npx", ["tsx", "agent/src/serve.ts"], { cwd: ROOT, shell: process.platform === "win32", stdio: "ignore" });
  for (let i = 0; i < 50 && !(await up()); i++) await new Promise((r) => setTimeout(r, 200));
  return () => child.kill();
}

export interface Target {
  role?: string;
  name?: string;
  label?: string;
  testid?: string;
  text?: string;
}

export interface Step {
  action: "click" | "fill" | "expect_visible" | "expect_text" | "expect_count";
  target?: Target;
  value?: string;
  count?: number;
}

const q = (s: string) => JSON.stringify(s);

type Role = Parameters<Page["getByRole"]>[0];

/** Code for a locator. `exact: false` allows a unique partial name match. */
function locatorCode(t: Target, exact = true): string {
  const ex = exact ? ", exact: true" : "";
  if (t.role && t.name) return `page.getByRole(${q(t.role)}, { name: ${q(t.name)}${ex} })`;
  if (t.label) return exact ? `page.getByLabel(${q(t.label)}, { exact: true })` : `page.getByLabel(${q(t.label)})`;
  if (t.testid) return `page.getByTestId(${q(t.testid)})`;
  if (t.text) return exact ? `page.getByText(${q(t.text)}, { exact: true })` : `page.getByText(${q(t.text)})`;
  if (t.role) return `page.getByRole(${q(t.role)})`;
  throw new Error("target needs role+name, label, testid or text");
}

function resolve(page: Page, t: Target, exact = true): Locator {
  if (t.role && t.name) return page.getByRole(t.role as Role, { name: t.name, exact });
  if (t.label) return page.getByLabel(t.label, { exact });
  if (t.testid) return page.getByTestId(t.testid);
  if (t.text) return page.getByText(t.text, { exact });
  if (t.role) return page.getByRole(t.role as Role);
  throw new Error("target needs role+name, label, testid or text");
}

/** The closest names in an ARIA snapshot, for "did you mean" hints. */
export function suggest(snapshot: string, t: Target, limit = 3): string[] {
  const wanted = t.name ?? t.text ?? t.label ?? t.testid ?? "";
  const named = [...snapshot.matchAll(/^\s*- (\w+) "([^"]+)"/gm)].map((m) => ({ role: m[1], name: m[2] }));
  const texts = [...snapshot.matchAll(/^\s*- (?:\w+: |text: )(.+)$/gm)].map((m) => ({ role: "text", name: m[1].trim() }));
  const entries = [...named, ...texts];
  return entries
    .map((e) => ({ ...e, score: similarity(wanted, e.name) + (t.role && e.role === t.role ? 0.2 : 0) }))
    .filter((e) => e.score > 0.1)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((e) => `${e.role} "${e.name}"`);
}

/** Performs one step; returns the code line, or throws with a reason the model can act on. */
async function perform(page: Page, step: Step): Promise<string> {
  const target = step.target ?? {};
  let loc = resolve(page, target);
  let code = locatorCode(target);
  let n = await loc.count();
  if (n === 0 && !target.testid) {
    const partial = resolve(page, target, false);
    if ((await partial.count()) === 1) {
      [loc, code, n] = [partial, locatorCode(target, false), 1];
    }
  }
  // Snapshots show text-only elements as `- strong: Dona Neide`; that text is content, not an
  // accessible name, so a role+name check falls back to the exact text.
  if (n === 0 && step.action.startsWith("expect") && target.role && target.name) {
    const byText = resolve(page, { text: target.name });
    if ((await byText.count()) === 1) [loc, code, n] = [byText, locatorCode({ text: target.name }), 1];
  }
  if (step.action === "expect_count") {
    if (n !== step.count) throw new Error(`${code} matches ${n} elements, not ${step.count}.`);
    return `await expect(${code}).toHaveCount(${step.count});`;
  }
  if (n === 0) {
    const hints = suggest(await page.locator("main").ariaSnapshot(), target);
    throw new Error(`${code} matches nothing on this page.${hints.length ? ` Closest: ${hints.join(", ")}.` : ""}`);
  }
  if (n > 1) throw new Error(`${code} matches ${n} elements. Pick a more specific target.`);
  switch (step.action) {
    case "click":
      await loc.click({ timeout: 3_000 });
      await page.waitForLoadState("networkidle").catch(() => {});
      return `await ${code}.click();`;
    case "fill":
      await loc.fill(step.value ?? "", { timeout: 3_000 });
      return `await ${code}.fill(${q(step.value ?? "")});`;
    case "expect_visible":
      if (!(await loc.isVisible())) throw new Error(`${code} exists but is not visible.`);
      return `await expect(${code}).toBeVisible();`;
    case "expect_text": {
      const text = (await loc.innerText()).replace(/\s+/g, " ").trim();
      if (!step.value || !text.includes(step.value)) throw new Error(`${code} contains "${text}", which does not include "${step.value}".`);
      return `await expect(${code}).toContainText(${q(step.value)});`;
    }
    default:
      throw new Error(`Unknown action "${step.action}".`);
  }
}

const PLAN_SYSTEM = `You break a user journey into a checklist for a browser test.
Each item is ONE browser action or ONE check, in order, written as a short imperative sentence.
Actions: fill a field, click a button, click a link. Checks: something is visible, some text is shown, a count.
Include the clicks needed to reach every page the journey mentions (for example, opening a link from a list).
Every check names the exact text or number to look for, in single quotes. Never write vague checks like 'the details are shown'.
Include every value the journey mentions, in single quotes.
Example journey: "The user logs in as ana with password 123 and sees the inbox with 2 unread messages."
Example reply: {"items": ["Fill the username field with 'ana'", "Fill the password field with '123'", "Click the 'Log in' button", "Check that the 'Inbox' heading is visible", "Check that the unread counter shows '2'"]}
Reply with JSON only: {"items": ["...", "..."]}`;

const STEP_SYSTEM = `You operate a real browser to perform ONE checklist item of a test.
You get the item, the steps already done, and the current page as an ARIA snapshot.
Reply with JSON only: {"action": "...", "target": {...}, "value": "...", "count": 0}
Actions:
- click: {"role": "button"} or {"role": "link"} plus "name" copied from the snapshot.
- fill: target {"label": "<field label>"}, "value" is the text to type.
- expect_visible: target by role+name, or {"text": "<text on the page>"}.
- expect_text: target an element; "value" is text it must contain. Good for counters and messages.
- expect_count: target matches several elements; "count" is how many there must be.
Rules: copy names from the snapshot. Only links navigate; headings and cards are not clickable.
If your previous try was rejected, read the reason and change the target or action.`;

const MAX_TRIES_PER_ITEM = 3;

/** Values quoted in a checklist item. A quote between letters is an apostrophe, not a delimiter. */
export const quotedValues = (item: string) =>
  [...item.matchAll(/(?<![\p{L}])['"“‘]([^'"”’]{2,}?)['"”’](?![\p{L}])/gu)].map((m) => m[1].toLowerCase());

/**
 * Checks that an action does what its checklist item says: a "check" item
 * needs an assertion, a "fill" item a fill, a "click" item a click, and the
 * action must use at least one of the item's quoted values still to be covered.
 * An item listing several values ("check 'A', 'B' and 'C'") takes one action
 * per value. Returns the values the step covers, or the reason to reject it.
 */
export function checkStep(item: string, step: Step, remaining: string[]): { covered: string[] } | { error: string } {
  const lower = item.toLowerCase();
  const kind = /^(check|verify|confirm|see|ensure|assert)\b/.test(lower)
    ? "expect"
    : /^(fill|type|enter|write)\b/.test(lower)
      ? "fill"
      : /^(click|open|press|accuse|close|sign in|select|go)\b/.test(lower)
        ? "click"
        : null;
  const actionKind = step.action.startsWith("expect") ? "expect" : step.action;
  if (kind && kind !== actionKind) return { error: `this item needs a ${kind === "expect" ? "expect_* check" : kind} action, not ${step.action}` };
  if (!remaining.length) return { covered: [] };
  const used = JSON.stringify([step.value, step.target, step.count]).toLowerCase();
  const covered = remaining.filter((v) => used.includes(v));
  if (!covered.length) return { error: `the action must use ${remaining.map((v) => `"${v}"`).join(" or ")} from the item` };
  return { covered };
}

function verifySpec(file: string): { ok: boolean; output: string } {
  const res = spawnSync("npx", ["playwright", "test", file, "--retries=0", "--reporter=line"], {
    cwd: ROOT,
    encoding: "utf8",
    shell: process.platform === "win32",
    env: { ...process.env, CHAOS_PLAN: "{}" },
  });
  return { ok: res.status === 0, output: (res.stdout + res.stderr).replace(/\u001b\[[0-9;]*m/g, "").slice(-1500) };
}

export interface GenerateResult {
  file: string;
  ok: boolean;
  plan: string[];
  steps: number;
  rejected: number;
  reason?: string;
}

async function planJourney(llm: Llm, journey: string): Promise<string[]> {
  const reply = await llm.chat(
    [
      { role: "system", content: PLAN_SYSTEM },
      { role: "user", content: journey },
    ],
    { json: true },
  );
  const items = parseJson<{ items?: unknown }>(reply).items;
  if (!Array.isArray(items) || !items.length) throw new Error(`The model returned no checklist: ${reply.slice(0, 200)}`);
  return items.map(String).slice(0, MAX_STEPS);
}

export async function generate(llm: Llm, journeyPath: string, log = console.log): Promise<GenerateResult> {
  const stop = await ensureScene();
  const browser = await chromium.launch();
  try {
    const journey = readFileSync(journeyPath, "utf8").trim();
    const name = basename(journeyPath, ".md");
    const rel = `tests/generated/${name}.spec.ts`;
    const plan = await planJourney(llm, journey);
    const journeyText = journey.toLowerCase();
    log(`  plan:\n${plan.map((p, i) => `    ${i + 1}. ${p}`).join("\n")}`);

    const page = await browser.newPage();
    await page.goto(SCENE);
    const lines: string[] = [];
    let rejected = 0;
    let failure = "";

    for (const item of plan) {
      let lastError = "";
      // Only values the journey itself mentions are requirements; others are the planner's guesses.
      let remaining = quotedValues(item).filter((v) => journeyText.includes(v));
      let done = false;
      const budget = MAX_TRIES_PER_ITEM + Math.max(0, remaining.length - 1);
      for (let attempt = 1; attempt <= budget && !done; attempt++) {
        const snapshot = (await page.locator("main").ariaSnapshot()).slice(0, 3500);
        const messages: ChatMessage[] = [
          { role: "system", content: STEP_SYSTEM },
          {
            role: "user",
            content: [
              `Checklist item: ${item}`,
              remaining.length > 1 ? `Still to cover with this item: ${remaining.map((v) => `'${v}'`).join(", ")} (one per step)` : "",
              `Steps already done:\n${lines.length ? lines.join("\n") : "(none)"}`,
              lastError ? `Your previous try was rejected: ${lastError}` : "",
              `Current page (${new URL(page.url()).hash || "#/"}):\n${snapshot}`,
            ]
              .filter(Boolean)
              .join("\n\n"),
          },
        ];
        try {
          const step = parseJson<Step>(await llm.chat(messages, { json: true }));
          const verdict = checkStep(item, step, remaining);
          if ("error" in verdict) throw new Error(verdict.error);
          const line = await perform(page, step);
          lines.push(line);
          log(`  ✓ ${item}\n      ${line}`);
          remaining = remaining.filter((v) => !verdict.covered.includes(v));
          lastError = "";
          done = remaining.length === 0;
        } catch (err) {
          lastError = (err as Error).message.split("\n")[0].slice(0, 300);
          rejected++;
          log(`  ✗ ${item}: ${lastError}`);
        }
      }
      if (!done) {
        failure = `could not do "${item}": ${lastError}`;
        break;
      }
    }

    const title = journey.match(/^#\s*(.+)$/m)?.[1] ?? name;
    const spec = [
      `// Recorded by ${llm.model} from journeys/${name}.md: the agent planned the journey, then explored`,
      `// the app step by step; every step below was checked against the live page. Review before trusting it.`,
      `import { expect, test } from "../fixtures";`,
      ``,
      `test(${q(title.toLowerCase())}, async ({ page }) => {`,
      `  await page.goto("./");`,
      ...lines.map((l) => `  ${l}`),
      `});`,
      ``,
    ].join("\n");
    writeFileSync(join(ROOT, rel), spec);
    // Free the model's memory before starting another browser for verification.
    await llm.unload();
    if (failure || !lines.some((l) => l.startsWith("await expect("))) {
      return { file: rel, ok: false, plan, steps: lines.length, rejected, reason: failure || "no checks recorded" };
    }
    const verified = verifySpec(rel);
    return { file: rel, ok: verified.ok, plan, steps: lines.length, rejected, reason: verified.ok ? undefined : verified.output };
  } finally {
    await browser.close();
    stop();
  }
}

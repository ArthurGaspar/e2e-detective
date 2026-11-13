/**
 * Shared test fixture.
 *
 * - Applies the fault the patrol assigned to this test (CHAOS_PLAN env var):
 *   an app release switch or network trouble on the crime scene's API.
 * - When a test fails, collects forensics the trace doesn't hold: an ARIA
 *   snapshot of the page and the interactive elements on it, which the agent
 *   uses to suggest replacements for broken locators.
 */
import { test as base, expect } from "@playwright/test";
import { SLOW_REQUEST_CHANCE, SLOW_REQUEST_MS, scenarioById, testKey } from "../agent/src/scenarios";
import type { Candidate } from "../agent/src/heal";
import { captureMaskedScreenshot } from "../agent/src/screenshot";
import { collectNetwork } from "../agent/src/collect-network";
import { redactText } from "../agent/src/redact";

const plan: Record<string, string> = JSON.parse(process.env.CHAOS_PLAN ?? "{}");

export const test = base.extend<{ forensics: void }>({
  forensics: [
    async ({ page, context }, use, testInfo) => {
      const collection = collectNetwork(context);
      const scenario = scenarioById(plan[testKey(testInfo.file, testInfo.title)] ?? "clean");

      if (scenario.release) {
        await page.addInitScript((r) => sessionStorage.setItem("release", r), scenario.release);
      }
      if (scenario.network) {
        await page.route("**/api/**", async (route) => {
          if (scenario.network === "outage") return route.fulfill({ status: 503, body: "Service Unavailable" });
          if (scenario.network === "drop") return route.abort("internetdisconnected");
          if (Math.random() < SLOW_REQUEST_CHANCE) {
            const [lo, hi] = SLOW_REQUEST_MS;
            await new Promise((r) => setTimeout(r, lo + Math.random() * (hi - lo)));
          }
          return route.continue();
        });
      }

      await use();

      if (testInfo.status === testInfo.expectedStatus) return;
      const screenshot = page.isClosed() ? null : await captureMaskedScreenshot(page).catch(() => null);
      if (screenshot) {
        await testInfo.attach("masked-screenshot", { body: screenshot, contentType: "image/jpeg" });
      }
      const snapshot = await page.locator("body").ariaSnapshot({ timeout: 2_000 }).catch(() => "");
      const candidates: Candidate[] = await page
        .evaluate(() => {
          const roleOf = (el: Element) =>
            el.getAttribute("role") ??
            ({ BUTTON: "button", A: "link", INPUT: "textbox", TEXTAREA: "textbox", H1: "heading", H2: "heading", H3: "heading" } as Record<string, string>)[
              el.tagName
            ] ??
            "generic";
          const nameOf = (el: Element) => {
            const label = el.closest("label");
            return (el.getAttribute("aria-label") ?? (label && el !== label ? label.textContent : el.textContent) ?? "")
              .replace(/\s+/g, " ")
              .trim();
          };
          return [...document.querySelectorAll("button, a, input, textarea, h1, h2, h3, [data-testid]")].map((el) => ({
            role: roleOf(el),
            name: nameOf(el),
            testId: el.getAttribute("data-testid"),
            tag: el.tagName.toLowerCase(),
          }));
        })
        .catch(() => []);
      await testInfo.attach("forensics", {
        body: JSON.stringify({
          snapshot: redactText(snapshot).slice(0, 4000),
          candidates: candidates.map((candidate) => ({
            ...candidate,
            name: redactText(candidate.name).slice(0, 120),
            testId: candidate.testId === null ? null : redactText(candidate.testId),
          })),
          network: collection.network(),
          consoleErrors: collection.consoleErrors,
        }),
        contentType: "application/json",
      });
    },
    { auto: true },
  ],
});

export { expect };

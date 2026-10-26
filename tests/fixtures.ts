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

const plan: Record<string, string> = JSON.parse(process.env.CHAOS_PLAN ?? "{}");

export interface Candidate {
  role: string;
  name: string;
  testId: string | null;
  tag: string;
}

export const test = base.extend<{ forensics: void }>({
  forensics: [
    async ({ page }, use, testInfo) => {
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

      if (testInfo.status === testInfo.expectedStatus || page.isClosed()) return;
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
            name: nameOf(el).slice(0, 120),
            testId: el.getAttribute("data-testid"),
            tag: el.tagName.toLowerCase(),
          }));
        })
        .catch(() => []);
      await testInfo.attach("forensics", {
        body: JSON.stringify({ url: page.url(), snapshot, candidates }),
        contentType: "application/json",
      });
    },
    { auto: true },
  ],
});

export { expect };

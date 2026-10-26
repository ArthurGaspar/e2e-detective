// Recorded by qwen2.5-coder:7b from journeys/accuse-suspect.md: the agent planned the journey, then explored
// the app step by step; every step below was checked against the live page. Review before trusting it.
import { expect, test } from "../fixtures";

test("accuse the right suspect", async ({ page }) => {
  await page.goto("./");
  await page.getByLabel("Badge number", { exact: true }).fill("221B");
  await page.getByLabel("Password", { exact: true }).fill("elementary");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await page.getByRole("link", { name: "Open case file: The Missing Brigadeiro", exact: true }).click();
  await page.getByRole("button", { name: "Accuse Paçoca the cat", exact: true }).click();
  await expect(page.getByText("Case solved: Paçoca the cat did it.", { exact: true })).toBeVisible();
});

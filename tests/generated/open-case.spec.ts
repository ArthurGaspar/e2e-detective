// Recorded by qwen2.5-coder:7b from journeys/open-case.md: the agent planned the journey, then explored
// the app step by step; every step below was checked against the live page. Review before trusting it.
import { expect, test } from "../fixtures";

test("open a case file", async ({ page }) => {
  await page.goto("./");
  await page.getByLabel("Badge number", { exact: true }).fill("221B");
  await page.getByLabel("Password", { exact: true }).fill("elementary");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await page.getByRole("link", { name: "Open case file: The Missing Brigadeiro", exact: true }).click();
  await expect(page.getByRole("heading", { name: "The Missing Brigadeiro", exact: true })).toBeVisible();
  await expect(page.getByText("Dona Neide", { exact: true })).toBeVisible();
  await expect(page.getByText("Tio Juca", { exact: true })).toBeVisible();
  await expect(page.getByText("Paçoca the cat", { exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Evidence (2)", exact: true })).toBeVisible();
});

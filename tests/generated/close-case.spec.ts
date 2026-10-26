// Recorded by qwen2.5-coder:7b from journeys/close-case.md: the agent planned the journey, then explored
// the app step by step; every step below was checked against the live page. Review before trusting it.
import { expect, test } from "../fixtures";

test("close a solved case", async ({ page }) => {
  await page.goto("./");
  await page.getByLabel("Badge number", { exact: true }).fill("221B");
  await page.getByLabel("Password", { exact: true }).fill("elementary");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Case Board" })).toBeVisible();
  await page.getByRole("link", { name: "Open case file: The Midnight Samba", exact: true }).click();
  await expect(page.getByRole("button", { name: "Accuse Smart speaker", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Accuse Smart speaker", exact: true }).click();
  await expect(page.getByRole("button", { name: "Close case", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Close case", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Closed cases (2)", exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: "Open case file: The Midnight Samba", exact: true })).toBeVisible();
});

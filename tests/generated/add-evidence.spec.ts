// Recorded by qwen2.5-coder:7b from journeys/add-evidence.md: the agent planned the journey, then explored
// the app step by step; every step below was checked against the live page. Review before trusting it.
import { expect, test } from "../fixtures";

test("add evidence", async ({ page }) => {
  await page.goto("./");
  await page.getByLabel("Badge number", { exact: true }).fill("221B");
  await page.getByLabel("Password", { exact: true }).fill("elementary");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await page.getByRole("link", { name: "Open case file: The Vanishing Bilhete Único", exact: true }).click();
  await page.getByLabel("New evidence", { exact: true }).fill("Ticket stub found behind the vending machine.");
  await page.getByRole("button", { name: "Add evidence", exact: true }).click();
  await expect(page.getByText("Ticket stub found behind the vending machine.", { exact: true })).toBeVisible();
  await expect(page.getByText("Evidence (2)", { exact: true })).toBeVisible();
});

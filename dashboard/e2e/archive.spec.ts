import { expect, test } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  await page.route("**/data/**", (route) => route.fulfill({ status: 404, body: "Archive unavailable" }));
});

test("the reference archive works without a live data branch", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/");
  await expect(page.getByText("Reference archive · 26 Oct 2026")).toBeVisible();
  await expect(page.locator(".cases > li")).toHaveCount(8);
  await page.getByLabel("Find a case").fill("not-a-real-journey");
  await expect(page.getByText("No cases match these filters.", { exact: false })).toBeVisible();
  await page.getByLabel("Find a case").fill("");
  await page.getByRole("button", { name: "Wrong diagnoses", exact: true }).click();
  await expect(page.locator(".cases > li")).toHaveCount(6);
  await page.locator(".case-card").first().click();
  await expect(page.getByRole("heading", { name: "Evidence", exact: true })).toBeVisible();
  await page.getByText("Page accessibility snapshot", { exact: true }).click();
  await expect(page.locator(".snapshot")).toBeVisible();
  await expect(page.locator(".shot")).toBeVisible();
  expect(await page.locator(".shot").evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth > 0)).toBe(true);
  await page.reload();
  await expect(page.getByRole("heading", { name: "Evidence", exact: true })).toBeVisible();
  expect(errors).toEqual([]);
});

test("method, run log, theme, and the local target remain usable", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("link", { name: "Method & results", exact: true }).click();
  await expect(page.getByRole("heading", { name: "What the evidence supports." })).toBeVisible();
  await expect(page.getByText("98.4%", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Theme: system", exact: true }).click();
  await page.getByRole("button", { name: "Theme: light", exact: true }).click();
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await page.getByRole("link", { name: "Run log", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Run log", exact: true })).toBeVisible();
  await expect(page.getByRole("table")).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.getByRole("link", { name: "Cases", exact: true }).click();
  await page.getByRole("link", { name: "Inspect the evidence" }).click();
  await expect(page.getByRole("heading", { name: "Case archive", exact: true })).toBeInViewport();
  await page.getByRole("link", { name: "Explore the test target" }).click();
  await expect(page.getByRole("heading", { name: "Detective sign-in" })).toBeVisible();
});

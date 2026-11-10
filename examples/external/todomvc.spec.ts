import { expect, test } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  await page.goto("https://demo.playwright.dev/todomvc/");
  await page.getByPlaceholder("What needs to be done?").fill("Review the trace report");
  await page.getByPlaceholder("What needs to be done?").press("Enter");
});

test("wrong count expectation", async ({ page }) => {
  // One task was created. This intentionally incorrect assertion must fail.
  await expect(page.locator(".todo-count")).toHaveText("2 items left");
});

test("missing archive control", async ({ page }) => {
  // TodoMVC has no such button. The suggestion must remain a review task.
  await page.getByRole("button", { name: "Archive tasks", exact: true }).click({ timeout: 1500 });
});

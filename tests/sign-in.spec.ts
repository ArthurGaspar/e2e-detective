// Hand-written reference test. The generator shows it to the LLM as the style to follow.
import { expect, test } from "./fixtures";

test("detective signs in and sees the case board", async ({ page }) => {
  await page.goto("./");
  await page.getByLabel("Badge number").fill("221B");
  await page.getByLabel("Password").fill("elementary");
  await page.getByRole("button", { name: "Sign in" }).click();

  await expect(page.getByRole("heading", { name: "Case board" })).toBeVisible();
  await expect(page.getByText("Welcome back, Det. Holmes Silva.")).toBeVisible();
  await expect(page.getByTestId("open-cases").getByTestId("case-card")).toHaveCount(3);
});

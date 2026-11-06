import { mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { chromium, expect } from "@playwright/test";

const output = new URL("../../docs/dashboard.png", import.meta.url);
const browser = await chromium.launch();
try {
  const page = await browser.newPage({
    viewport: { width: 1440, height: 1200 },
    deviceScaleFactor: 1,
    colorScheme: "dark",
  });
  await page.addInitScript(() => localStorage.setItem("case-files-theme", "dark"));
  await page.route("**/data/**", (route) => route.fulfill({ status: 404, body: "Reference capture" }));
  await page.goto(process.env.DASHBOARD_URL ?? "http://127.0.0.1:5173/");
  const file = page.locator(".case-card").filter({ has: page.locator(".register-mark.bad") }).first();
  const number = await file.locator(".no").textContent();
  await file.click();
  await expect(page.locator(".document-ruler span").last()).toHaveText(number);
  await page.locator(".evidence-photo img").evaluate((img) => img.decode());
  await page.evaluate(() => document.fonts.ready);
  await mkdir(new URL("../../docs/", import.meta.url), { recursive: true });
  await page.screenshot({ path: fileURLToPath(output), fullPage: true });
  console.log("Updated docs/dashboard.png in dark mode.");
} finally {
  await browser.close();
}

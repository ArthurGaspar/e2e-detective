import { defineConfig, devices } from "@playwright/test";

// TARGET_URL points at the deployed crime scene in CI; locally a static server is started.
const target = process.env.TARGET_URL;

export default defineConfig({
  testDir: "tests",
  outputDir: process.env.PW_OUTPUT_DIR ?? "test-results",
  timeout: 30_000,
  expect: { timeout: 5_000 },
  retries: 1,
  workers: process.env.CI ? 2 : 4,
  reporter: process.env.PW_JSON_REPORT
    ? [["list"], ["json", { outputFile: process.env.PW_JSON_REPORT }]]
    : [["list"]],
  use: {
    baseURL: target ?? "http://localhost:4400/",
    actionTimeout: 5_000,
    navigationTimeout: 10_000,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: target
    ? undefined
    : { command: "npx tsx agent/src/serve.ts", url: "http://localhost:4400/", reuseExistingServer: true },
});

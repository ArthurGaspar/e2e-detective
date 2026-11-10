import { defineConfig } from "@playwright/test";

// Independent public TodoMVC app: no crime-scene fixtures or fault injection.
export default defineConfig({
  testDir: ".",
  testMatch: "todomvc.spec.ts",
  outputDir: "../../.scratch/external-proof",
  reporter: [["list"], ["json", { outputFile: "../../.scratch/external-proof/results.json" }]],
  workers: 1,
  retries: 0,
  timeout: 30_000,
  expect: { timeout: 1500 },
  use: { browserName: "chromium", trace: { mode: "on", screenshots: false, snapshots: true, sources: false } },
});

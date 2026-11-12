import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  timeout: 30_000,
  fullyParallel: false,
  reporter: [["list"], ["json", { outputFile: "test-results/playwright.json" }]],
  use: {
    baseURL: "http://127.0.0.1:8765",
    browserName: "chromium",
    headless: true,
    ...devices["Desktop Chrome"],
  },
  webServer: {
    command: "node e2e/server-fixture.js",
    url: "http://127.0.0.1:8765/health",
    reuseExistingServer: false,
    timeout: 30_000,
  },
});

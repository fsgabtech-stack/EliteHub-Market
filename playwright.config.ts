import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  fullyParallel: false,
  globalSetup: "./scripts/prepare-e2e.mjs",
  testDir: "./e2e",
  timeout: 45_000,
  use: {
    baseURL: process.env.ELITEHUB_E2E_BASE_URL ?? "http://localhost:8001",
    trace: "retain-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  workers: 1,
});

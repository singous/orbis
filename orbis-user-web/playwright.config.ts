import { defineConfig } from "@playwright/test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

process.env.ORBIS_E2E_DIR ||= mkdtempSync(join(tmpdir(), "orbis-e2e-"));

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: false,
  workers: 1,
  timeout: 120_000,
  expect: { timeout: 12_000 },
  retries: 0,
  outputDir: "test-results/browser",
  reporter: "list",
  use: {
    actionTimeout: 12_000,
    baseURL: "http://127.0.0.1:9310",
    channel: process.env.PLAYWRIGHT_CHANNEL,
    viewport: { width: 1440, height: 1000 },
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
  },
  webServer: [
    { command: "../.venv/bin/python tests/e2e/run_api.py", url: "http://127.0.0.1:9311/healthz", reuseExistingServer: false, env: { ORBIS_E2E_DIR: process.env.ORBIS_E2E_DIR }, timeout: 30_000 },
    { command: "npm run dev -- --port 9310", url: "http://127.0.0.1:9310", reuseExistingServer: false, env: { ORBIS_DEV_API_TARGET: "http://127.0.0.1:9311" }, timeout: 30_000 },
  ],
});

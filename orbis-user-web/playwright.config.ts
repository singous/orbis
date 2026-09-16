import { defineConfig } from "@playwright/test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

process.env.ORBIS_E2E_DIR ||= mkdtempSync(join(tmpdir(), "orbis-e2e-"));
const webPort = Number(process.env.ORBIS_E2E_WEB_PORT || "9310");
const apiPort = Number(process.env.ORBIS_E2E_API_PORT || "9311");
for (const port of [webPort, apiPort]) {
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("E2E ports must be integers between 1 and 65535");
}
const webOrigin = `http://127.0.0.1:${webPort}`;
const apiOrigin = `http://127.0.0.1:${apiPort}`;

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
    baseURL: webOrigin,
    channel: process.env.PLAYWRIGHT_CHANNEL,
    viewport: { width: 1440, height: 1000 },
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
  },
  webServer: [
    { command: "../.venv/bin/python tests/e2e/run_api.py", url: `${apiOrigin}/healthz`, reuseExistingServer: false, env: { ORBIS_E2E_DIR: process.env.ORBIS_E2E_DIR, ORBIS_E2E_API_PORT: String(apiPort), ORBIS_E2E_WEB_PORT: String(webPort) }, timeout: 30_000 },
    { command: `npm run dev -- --port ${webPort}`, url: webOrigin, reuseExistingServer: false, env: { ORBIS_DEV_API_TARGET: apiOrigin }, timeout: 30_000 },
  ],
});

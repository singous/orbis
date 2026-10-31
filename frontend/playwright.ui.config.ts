import { defineConfig } from "@playwright/test";

const port = Number(process.env.ORBIS_UI_WEB_PORT || "9320");
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("UI test port must be an integer between 1 and 65535");
export default defineConfig({
  testDir: "./tests/ui-browser",
  fullyParallel: false,
  workers: 1,
  timeout: 30_000,
  use: { baseURL: `http://127.0.0.1:${port}`, viewport: { width: 1280, height: 900 }, screenshot: "off", trace: "off" },
  outputDir: "test-results/ui-browser",
  webServer: { command: `npm run dev -- --port ${port}`, url: `http://127.0.0.1:${port}`, reuseExistingServer: false, env: { VITEST: "1" } },
});

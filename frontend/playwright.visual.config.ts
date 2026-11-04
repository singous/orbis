import { defineConfig } from "@playwright/test";

if (process.platform !== "linux" || process.arch !== "x64") throw new Error("Visual baselines use the pinned Linux amd64 image. Run npm run test:visual:container instead.");

export default defineConfig({
  testDir: "./tests/visual",
  fullyParallel: false,
  workers: 1,
  timeout: 30_000,
  retries: 0,
  snapshotPathTemplate: "{testDir}/snapshots/{projectName}/{testFilePath}/{arg}{ext}",
  expect: { toHaveScreenshot: { animations: "disabled", caret: "hide", scale: "css", maxDiffPixels: 0 } },
  use: {
    baseURL: "http://127.0.0.1:9321",
    browserName: "chromium",
    viewport: { width: 1280, height: 900 },
    deviceScaleFactor: 1,
    locale: "zh-CN",
    timezoneId: "Asia/Shanghai",
    reducedMotion: "reduce",
    screenshot: "off",
    trace: "retain-on-failure",
  },
  projects: [{ name: "chromium-linux-amd64" }],
  outputDir: "test-results/visual",
  webServer: [
    { command: "npm run dev -- --port 9321", url: "http://127.0.0.1:9321", reuseExistingServer: false, env: { VITEST: "1" } },
    { command: "npm exec -- storybook dev --port 9322 --host 127.0.0.1 --config-dir packages/ui/.storybook --ci --no-version-updates --exact-port --disable-telemetry", url: "http://127.0.0.1:9322/index.json", reuseExistingServer: false, timeout: 120_000 },
  ],
});

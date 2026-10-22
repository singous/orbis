import { cpus, totalmem, platform, arch } from "node:os";
import { chromium } from "@playwright/test";
import { writeFile, mkdir } from "node:fs/promises";
const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage({
    viewport: { width: 1920, height: 1080 },
    deviceScaleFactor: Number(process.env.BOARD_BENCH_DPR || 1),
  });
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(process.env.BOARD_BENCH_URL || "http://127.0.0.1:9320/tests/bench/boards/");
  await page.waitForFunction(() => !!window.boardBenchmark);
  const result = {
    browser: browser.version(),
    hardware: {platform: platform(), arch: arch(), cpu: cpus()[0]?.model, logical_cpus:cpus().length, ram_bytes:totalmem()},
    dpr: Number(process.env.BOARD_BENCH_DPR || 1),
    viewport: "1920x1080",
    mode: process.env.BOARD_BENCH_URL ? "production-headless" : "development-headless",
    samples: [],
  };
  for (const count of [1000, 5000, 10000]) {
    const load = await page.evaluate(
      (count) => window.boardBenchmark.load(count),
      count,
    );
    const pan = await page.evaluate(() => window.boardBenchmark.pan());
    const overview = await page.evaluate(() =>
      window.boardBenchmark.pan(45, true),
    );
    const drag = await page.evaluate(() => window.boardBenchmark.drag());
    result.samples.push({ count, load, pan, overview, drag });
  }
  await mkdir("../.dev/board-benchmark", { recursive: true });
  await page.screenshot({ path: "../.dev/board-benchmark/canvas.png" });
  await writeFile(
    "../.dev/board-benchmark/results-dpr" + result.dpr + ".json",
    JSON.stringify({ ...result, errors }, null, 2),
  );
  console.log(JSON.stringify({ ...result, errors }, null, 2));
  if (errors.length) process.exitCode = 1;
} finally {
  await browser.close();
}

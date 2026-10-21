import { chromium } from "@playwright/test";
import { writeFile } from "node:fs/promises";
import { cpus, platform, release } from "node:os";

const baseURL = process.env.ORBIS_BENCH_URL || "http://127.0.0.1:9340";
const output = process.env.ORBIS_BENCH_OUTPUT || "/tmp/orbis-editor-benchmark.json";
const variants = (process.env.ORBIS_BENCH_VARIANTS || "text,nested,rich,media").split(",");
const sizes = (process.env.ORBIS_BENCH_SIZES || "100,1000,5000").split(",").map(Number);
const browser = await chromium.launch({ headless: true });
const results = [];
try {
  for (const variant of variants) for (const blocks of sizes) {
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
    let mediaRequests = 0;
    await page.route("**/api/v1/workspaces/*/assets/*/content", async (route) => {
      mediaRequests += 1;
      await route.fulfill({ contentType: "image/svg+xml", body: '<svg xmlns="http://www.w3.org/2000/svg" width="600" height="200"><rect width="600" height="200" fill="#ddd"/></svg>' });
    });
    await page.goto(`${baseURL}/?blocks=${blocks}&variant=${variant}`);
    await page.locator(".ProseMirror[contenteditable=true]").waitFor({ timeout: 120_000 });
    const opened = await page.evaluate(() => performance.now());
    await page.evaluate((variant) => {
      const editor = document.querySelector(".tiptap").editor;
      let editPosition = 1;
      if (variant === "giant-container") {
        editor.state.doc.descendants((node, pos) => {
          if (node.attrs.orbisId === "bench-child-0") { editPosition = pos + 1; return false; }
          return editPosition === 1;
        });
      }
      editor.commands.setTextSelection(editPosition);
      editor.view.focus();
      window.benchmark.latency = [];
      window.benchmark.transactions = [];
      window.benchmark.plugins = {};
      for (const plugin of editor.state.plugins) {
        // PM binds state.apply while constructing its state, so only methods
        // looked up at runtime are wrapped here; do not report fake apply timings.
        for (const [owner, method] of [[plugin.props, "decorations"], [plugin.spec, "appendTransaction"]]) {
          if (!owner?.[method]) continue;
          const original = owner[method];
          const key = `${plugin.key}:${method}`;
          owner[method] = function (...args) {
            const started = performance.now();
            try { return original.apply(this, args); }
            finally { (window.benchmark.plugins[key] ||= []).push(performance.now() - started); }
          };
        }
      }
      let start;
      editor.on("beforeTransaction", () => { start = performance.now(); });
      editor.on("transaction", () => window.benchmark.transactions.push(performance.now() - start));
      editor.view.dom.addEventListener("keydown", () => {
        const began = performance.now();
        requestAnimationFrame(() => window.benchmark.latency.push(performance.now() - began));
      }, true);
      window.benchmark.metrics.fingerprintMs = [];
      window.benchmark.metrics.longTasks = [];
    }, variant);
    await page.keyboard.type("abcdefghijklmnopqrstuvwxyz0123456789", { delay: 40 });
    await page.waitForTimeout(900);
    const result = await page.evaluate(() => {
      const summary = (values) => {
        const sorted = values.toSorted((a, b) => a - b);
        return { samples: sorted.length, total: values.reduce((a, b) => a + b, 0), p50: sorted[Math.floor(sorted.length * .5)] || 0, p95: sorted[Math.floor(sorted.length * .95)] || 0, max: sorted.at(-1) || 0 };
      };
      const data = window.benchmark;
      let editedTarget = null;
      const stack = [...(data.lastBlocks?.blocks || [])];
      const targetId = data.fixture.variant === "giant-container" ? "bench-child-0" : "block-0";
      while (stack.length) {
        const block = stack.pop();
        if (block.id === targetId) { editedTarget = block; break; }
        stack.push(...block.children);
      }
      const editedText = editedTarget && (typeof editedTarget.content === "string" ? editedTarget.content : Array.isArray(editedTarget.content) ? editedTarget.content.map(part => part.text || "").join("") : "");
      return { fixture: data.fixture, editedTargetId: editedTarget?.id, enteredTextSaved: Boolean(editedText?.startsWith("abcdefghijklmnopqrstuvwxyz0123456789")), changes: data.metrics.changes, saveCount: data.metrics.saveCount, saveBytes: data.metrics.saveBytes, inputToFrame: summary(data.latency), transactions: summary(data.transactions), fingerprints: summary(data.metrics.fingerprintMs), plugins: Object.fromEntries(Object.entries(data.plugins).map(([key, samples]) => [key, summary(samples)])), longTasks: data.metrics.longTasks, heapBytes: performance.memory?.usedJSHeapSize };
    });
    if (!result.enteredTextSaved || result.changes < 36) throw new Error(`Input was not persisted into target block: ${variant}/${blocks}`);
    const initialMediaRequests = mediaRequests;
    if (variant === "media") {
      await page.locator(".orbis-media").first().scrollIntoViewIfNeeded();
      await page.locator(".orbis-media img").first().waitFor({ state: "visible" });
    }
    results.push({ ...result, openedMs: opened, mediaRequests: initialMediaRequests, mediaRequestsAfterScroll: mediaRequests });
    console.log(JSON.stringify({ variant, blocks, openedMs: opened, inputP95: result.inputToFrame.p95, fingerprintMs: result.fingerprints.total }));
    await page.close();
  }
  await writeFile(output, JSON.stringify({ environment: { platform: platform(), release: release(), cpu: cpus()[0]?.model, browser: browser.version(), viewport: "1440x1000", production: true, keyDelayMs: 40, keys: 36 }, results }, null, 2));
} finally { await browser.close(); }

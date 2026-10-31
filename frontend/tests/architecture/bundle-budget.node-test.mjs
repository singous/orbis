import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { bundleReport, budgetViolations } from "../../scripts/bundle-report.mjs";

test("initial budget follows only static imports and counts shared chunks once", () => {
  const directory = mkdtempSync(path.join(tmpdir(), "orbis-bundle-test-"));
  try {
    mkdirSync(path.join(directory, ".vite"));
    writeFileSync(path.join(directory, ".vite/manifest.json"), JSON.stringify({
      "index.html": { file: "main.js", imports: ["shared", "other"], dynamicImports: ["src/features/page.tsx"] },
      shared: { file: "shared.js" }, other: { file: "other.js", imports: ["shared"] },
      "src/features/page.tsx": { file: "page.js", imports: ["shared"] },
    }));
    for (const name of ["main", "shared", "other", "page"]) writeFileSync(path.join(directory, `${name}.js`), `${name};`);
    const report = bundleReport(directory);
    assert.equal(report.totalGzipBytes - report.initialGzipBytes, report.featureGzipBytes["src/features/page.tsx"]);
  } finally { rmSync(directory, { recursive: true }); }
});
test("gates initial growth, feature growth and unbudgeted new features", () => {
  const baseline = { initialGzipBytes: 1000, featureGzipBytes: { "src/features/page.tsx": 100 } };
  assert.deepEqual(budgetViolations({ initialGzipBytes: 1050, featureGzipBytes: { "src/features/page.tsx": 110 } }, baseline), []);
  assert.equal(budgetViolations({ initialGzipBytes: 1051, featureGzipBytes: { "src/features/page.tsx": 111, "src/features/new.tsx": 10 } }, baseline).length, 3);
});

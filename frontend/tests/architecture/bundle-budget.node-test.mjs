import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { gzipSync } from "node:zlib";
import { createHash } from "node:crypto";
import { bundleReport, budgetViolations, entryGroupPolicy } from "../../scripts/bundle-report.mjs";

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

const publicEntry = "src/features/reader/Public.tsx";
const previewEntry = "src/features/reader/Preview.tsx";
const original = { ref: "0".repeat(40), lockfileSha256: "a".repeat(64), report: { initialGzipBytes: 1000, totalGzipBytes: 1200, featureGzipBytes: { [publicEntry]: 100 } } };
const manifestText = JSON.stringify({ "index.html": { file: "main.js", isEntry: true }, [publicEntry]: { file: "old.js", imports: ["shared"], isDynamicEntry: true }, shared: { file: "shared.js" } });
const digest = createHash("sha256").update(manifestText).digest("hex");
const artifact = { manifestText, artifacts: { ref: original.ref, lockfileSha256: original.lockfileSha256, manifestSha256: digest, files: { "main.js": { gzipBytes: 1000, sha256: "a".repeat(64) }, "old.js": { gzipBytes: 100, sha256: "a".repeat(64) }, "shared.js": { gzipBytes: 100, sha256: "a".repeat(64) } } } };
// The original reader's unrelated shared dependency is independently consumed by another entry.
const originalGraph = JSON.parse(manifestText);
originalGraph["index.html"].imports = ["shared"];
artifact.manifestText = JSON.stringify(originalGraph);
artifact.artifacts.manifestSha256 = createHash("sha256").update(artifact.manifestText).digest("hex");
original.report.initialGzipBytes = 1100;
const lineage = { baselineRef: original.ref, lockfileSha256: original.lockfileSha256, baselineManifestSha256: artifact.artifacts.manifestSha256, groups: [{ baselineEntry: publicEntry, successors: [publicEntry, previewEntry], expectedSharedChunks: ["Reader"], reason: "Two existing routes split their combined module." }] };

function measured(publicBytes = 50, previewBytes = 50, sharedBytes = 10) {
  return { initialGzipBytes: 1000, featureGzipBytes: { [publicEntry]: publicBytes, [previewEntry]: previewBytes }, featureStaticGzipBytes: { [publicEntry]: 220, [previewEntry]: 200 }, entryGroups: [{ baselineEntry: publicEntry, ownedChunks: [{ key: publicEntry, file: "public.js", gzipBytes: publicBytes }, { key: previewEntry, file: "preview.js", gzipBytes: previewBytes }, { key: "reader", name: "Reader", file: "reader.js", gzipBytes: sharedBytes }] }] };
}

test("route successors and family-local shared code spend the original own budget once", () => {
  const entryGroups = entryGroupPolicy(lineage, original, artifact);
  const report = measured();
  assert.deepEqual(budgetViolations(report, original.report, { entryGroups }), []);
  assert.match(budgetViolations(measured(50, 51, 10), original.report, { entryGroups })[0], /lineage own total/);
  assert.match(budgetViolations(measured(50, 50, 11), original.report, { entryGroups })[0], /lineage own total/);
  assert.match(budgetViolations({ ...report, featureStaticGzipBytes: { [publicEntry]: 221, [previewEntry]: 200 } }, original.report, { entryGroups })[0], /static closure/);
  assert.match(budgetViolations({ ...report, featureGzipBytes: { ...report.featureGzipBytes, "src/features/new.tsx": 1 } }, original.report, { entryGroups })[0], /requires an explicit budget/);
  assert.match(budgetViolations({ ...report, featureGzipBytes: { [publicEntry]: 50 } }, original.report, { entryGroups })[0], /Missing successor/);
  assert.match(budgetViolations({ ...report, featureStaticGzipBytes: {} }, original.report, { entryGroups })[0], /Missing static closure/);
  assert.match(budgetViolations({ ...report, entryGroups: [] }, original.report, { entryGroups })[0], /Missing or inconsistent lineage/);
});

test("entry lineage derives sizes from verified original artifacts, not editable policy allowances", () => {
  const groups = entryGroupPolicy(lineage, original, artifact);
  assert.equal(groups[0].baselineStaticGzipBytes, 200);
  assert.throws(() => entryGroupPolicy({ ...lineage, baselineManifestSha256: "0".repeat(64) }, original, artifact), /frozen original/);
  assert.throws(() => entryGroupPolicy({ ...lineage, groups: [{ ...lineage.groups[0], baselineStaticGzipBytes: 99999999 }] }, original, artifact), /derive from original/);
  assert.throws(() => entryGroupPolicy({ ...lineage, groups: [lineage.groups[0], lineage.groups[0]] }, original, artifact), /Invalid entry lineage/);
  assert.throws(() => entryGroupPolicy({ ...lineage, groups: [{ ...lineage.groups[0], successors: [publicEntry, previewEntry, previewEntry] }] }, original, artifact), /more than one budget/);
  const changed = structuredClone(artifact);
  changed.artifacts.files["shared.js"].gzipBytes++;
  assert.throws(() => entryGroupPolicy(lineage, original, changed), /reproduce the frozen/);
});

test("private extraction cannot erase ownership and shared reader has both static consumer edges", t => {
  const directory = mkdtempSync(path.join(tmpdir(), "orbis-entry-lineage-"));
  t.after(() => rmSync(directory, { recursive: true }));
  mkdirSync(path.join(directory, ".vite"));
  const content = { "main.js": "main;", "react.js": "react;", "reader.js": "reader;", "private.js": "private feature-only code;", "public.js": "public;", "preview.js": "preview;" };
  for (const [file, source] of Object.entries(content)) writeFileSync(path.join(directory, file), source);
  writeFileSync(path.join(directory, ".vite/manifest.json"), JSON.stringify({
    "index.html": { file: "main.js", imports: ["react"], isEntry: true }, react: { file: "react.js" },
    reader: { name: "Reader", file: "reader.js", imports: ["react", "private"] }, private: { name: "Private", file: "private.js" },
    [publicEntry]: { file: "public.js", imports: ["reader"], isDynamicEntry: true }, [previewEntry]: { file: "preview.js", imports: ["reader"], isDynamicEntry: true },
  }));
  const report = bundleReport(directory, entryGroupPolicy(lineage, original, artifact));
  assert.equal(report.totalGzipBytes, Object.values(content).reduce((sum, source) => sum + gzipSync(source).length, 0));
  assert.equal(report.entryGroups[0].ownGzipBytes, ["public;", "preview;", "reader;", "private feature-only code;"].reduce((sum, source) => sum + gzipSync(source).length, 0));
  assert.equal(report.featureStaticGzipBytes[publicEntry], ["public;", "reader;", "private feature-only code;", "react;"].reduce((sum, source) => sum + gzipSync(source).length, 0));
  assert.deepEqual(report.entryGroups[0].sharedStaticChunks.find(chunk => chunk.key === "reader").directConsumers, [publicEntry, previewEntry]);
  assert.equal(budgetViolations(report, original.report, { entryGroups: entryGroupPolicy(lineage, original, artifact) }).some(failure => failure.includes("lineage own total")), true);
});

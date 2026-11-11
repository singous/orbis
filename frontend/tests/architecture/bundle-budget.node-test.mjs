import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { gzipSync } from "node:zlib";
import { createHash } from "node:crypto";
import { bundleReport, budgetViolations, bundleBudgetPolicy } from "../../scripts/bundle-report.mjs";

const publicEntry = "src/features/reader/Public.tsx";
const previewEntry = "src/features/reader/Preview.tsx";
const hostEntry = "src/features/documents/Editor.tsx";
const panelEntry = "src/features/collaboration/Panel.tsx";
const sha256 = value => createHash("sha256").update(value).digest("hex");
const payload = (name, count) => Array.from({ length: count }, (_, index) => `const ${name}_${index.toString(36)}=${index};`).join("\n");

function build(t, manifest, contents) {
  const directory = mkdtempSync(path.join(tmpdir(), "orbis-bundle-test-"));
  t.after(() => rmSync(directory, { recursive: true }));
  writeBuild(directory, manifest, contents);
  return directory;
}

function writeBuild(directory, manifest, contents) {
  mkdirSync(path.join(directory, ".vite"), { recursive: true });
  writeFileSync(path.join(directory, ".vite/manifest.json"), JSON.stringify(manifest));
  for (const [file, source] of Object.entries(contents)) {
    mkdirSync(path.dirname(path.join(directory, file)), { recursive: true });
    writeFileSync(path.join(directory, file), source);
  }
}

function frozen(directory, groups = [], loadContexts = []) {
  const manifestText = readFileSync(path.join(directory, ".vite/manifest.json"), "utf8");
  const manifest = JSON.parse(manifestText);
  const files = Object.fromEntries([...new Set(Object.values(manifest).map(chunk => chunk.file))].map(file => {
    const contents = readFileSync(path.join(directory, file));
    return [file, { gzipBytes: gzipSync(contents).length, sha256: sha256(contents) }];
  }));
  const measured = bundleReport(directory);
  const baseline = { ref: "0".repeat(40), lockfileSha256: "a".repeat(64), report: { initialGzipBytes: measured.initialGzipBytes, totalGzipBytes: measured.totalGzipBytes, featureGzipBytes: measured.featureGzipBytes } };
  const original = { manifestText, artifacts: { ref: baseline.ref, lockfileSha256: baseline.lockfileSha256, manifestSha256: sha256(manifestText), files } };
  const config = { baselineRef: baseline.ref, lockfileSha256: baseline.lockfileSha256, baselineManifestSha256: sha256(manifestText), groups, loadContexts };
  return { baseline, original, config };
}

function readerBuilds(t) {
  const originalDirectory = build(t, {
    "index.html": { file: "main.js", imports: ["shared"], isEntry: true }, shared: { file: "shared.js" },
    [publicEntry]: { file: "old.js", imports: ["shared"], isDynamicEntry: true },
  }, { "main.js": payload("originalMain", 500), "old.js": "old;", "shared.js": "shared;" });
  const group = { baselineEntry: publicEntry, successors: [publicEntry, previewEntry], expectedSharedChunks: ["Reader"], reason: "Two existing routes split their combined original module." };
  const original = frozen(originalDirectory, [group]);
  const currentManifest = {
    "index.html": { file: "main.js", imports: ["react"], isEntry: true }, react: { file: "react.js" },
    reader: { name: "Reader", file: "reader.js", imports: ["react", "private"] }, private: { name: "Private", file: "private.js" },
    [publicEntry]: { file: "public.js", imports: ["reader"], isDynamicEntry: true }, [previewEntry]: { file: "preview.js", imports: ["reader"], isDynamicEntry: true },
  };
  const contents = { "main.js": "main;", "react.js": "react;", "reader.js": "reader;", "private.js": "private feature-only code;", "public.js": "public;", "preview.js": "preview;" };
  const currentDirectory = build(t, currentManifest, contents);
  const policy = bundleBudgetPolicy(original.config, original.baseline, original.original);
  return { ...original, currentDirectory, currentManifest, contents, policy };
}

test("a redirected page must disappear while the replacement keeps its original loading budget", t => {
  const old = "src/features/documents/Collections.tsx";
  const shelf = "src/features/documents/Shelf.tsx";
  const directory = build(t, {
    "index.html": { file: "main.js", isEntry: true },
    [old]: { file: "old.js", isDynamicEntry: true },
    [shelf]: { file: "shelf.js", isDynamicEntry: true },
  }, { "main.js": "main;", "old.js": payload("old", 600), "shelf.js": "shelf;" });
  const { config, baseline, original } = frozen(directory);
  config.redirects = [{ originalEntry: old, replacement: shelf, reason: "The same shelf handles the old address." }];
  const policy = bundleBudgetPolicy(config, baseline, original);
  const report = bundleReport(directory);
  assert.ok(budgetViolations(report, baseline.report, { policy }).includes(`Retired feature entry is still emitted: ${old}`));
  assert.ok(budgetViolations({ ...report, featureLoadGzipBytes: { [shelf]: policy.baselineLoadGzipBytes[shelf] * 2 } }, baseline.report, { policy }).some(failure => failure.startsWith(`${shelf} entry loading boundary:`)));
});

test("entry loading boundaries include initial and shared imports once, with optional code and workers reported separately", t => {
  const page = "src/features/page.tsx";
  const optional = "src/features/optional.tsx";
  const unrelated = "src/features/another-route.tsx";
  const content = { "main.js": "main;", "shared.js": "shared;", "other.js": "other;", "page.js": "page;", "optional.js": "optional;", "unrelated.js": "unrelated;", "assets/worker.js": "worker;" };
  const directory = build(t, {
    "index.html": { file: "main.js", imports: ["shared", "other"], dynamicImports: [page, unrelated] },
    shared: { file: "shared.js" }, other: { file: "other.js", imports: ["shared"] },
    [page]: { file: "page.js", imports: ["shared"], dynamicImports: [optional] },
    [optional]: { file: "optional.js", imports: ["shared"] }, [unrelated]: { file: "unrelated.js" },
  }, content);
  const report = bundleReport(directory);
  const bytes = file => gzipSync(content[file]).length;
  assert.equal(report.initialGzipBytes, bytes("main.js") + bytes("shared.js") + bytes("other.js"));
  assert.equal(report.featureStaticGzipBytes[page], bytes("page.js") + bytes("shared.js"));
  assert.equal(report.featureLoadGzipBytes[page], report.initialGzipBytes + bytes("page.js"));
  assert.equal(report.featureDynamicUpperBoundGzipBytes[page], report.featureLoadGzipBytes[page] + bytes("optional.js"));
  assert.equal(report.totalGzipBytes, Object.entries(content).filter(([file]) => file !== "assets/worker.js").reduce((sum, [, source]) => sum + gzipSync(source).length, 0));
  assert.deepEqual(report.additionalJsAssets, [{ file: "assets/worker.js", gzipBytes: bytes("assets/worker.js") }]);
  assert.equal(report.totalEmittedJsGzipBytes, report.totalGzipBytes + bytes("assets/worker.js"));
  assert.equal(report.fileGzipBytes["shared.js"], bytes("shared.js"));
});

test("own growth is diagnostic while a smaller entry loading boundary passes", t => {
  const fixture = readerBuilds(t);
  const report = bundleReport(fixture.currentDirectory, fixture.policy);
  const own = report.entryGroups[0];
  assert.ok(own.ownGzipBytes > fixture.baseline.report.featureGzipBytes[publicEntry] * 1.1);
  assert.equal(own.ownGzipBytes, ["public.js", "preview.js", "reader.js", "private.js"].reduce((sum, file) => sum + gzipSync(fixture.contents[file]).length, 0));
  assert.equal(report.featureLoadGzipBytes[publicEntry], ["main.js", "react.js", "public.js", "reader.js", "private.js"].reduce((sum, file) => sum + gzipSync(fixture.contents[file]).length, 0));
  assert.ok(report.totalGzipBytes < fixture.baseline.report.totalGzipBytes);
  assert.deepEqual(budgetViolations(report, fixture.baseline.report, { policy: fixture.policy }), []);
  assert.deepEqual(own.sharedStaticChunks.find(chunk => chunk.key === "reader").directConsumers, [publicEntry, previewEntry]);
});

test("initial and load growth limits reject excess bytes, missing metrics and unknown or missing entries", t => {
  const fixture = readerBuilds(t);
  const report = bundleReport(fixture.currentDirectory, fixture.policy);
  const check = value => budgetViolations(value, fixture.baseline.report, { policy: fixture.policy });
  const initialLimit = Math.floor(fixture.baseline.report.initialGzipBytes * 1.05);
  const loadLimit = Math.floor(fixture.policy.baselineLoadGzipBytes[publicEntry] * 1.1);
  const boundary = { ...report, initialGzipBytes: initialLimit, featureLoadGzipBytes: { ...report.featureLoadGzipBytes, [publicEntry]: loadLimit } };
  assert.deepEqual(check(boundary), []);
  const failures = check({ ...boundary, initialGzipBytes: initialLimit + 1, featureLoadGzipBytes: { ...boundary.featureLoadGzipBytes, [publicEntry]: loadLimit + 1 } });
  assert.ok(failures.some(value => value.startsWith("Initial JS:")));
  assert.ok(failures.some(value => value.includes("entry loading boundary:")));
  assert.ok(check({ ...report, featureGzipBytes: { ...report.featureGzipBytes, "src/features/new.tsx": 1 } }).some(value => value.includes("requires an explicit budget")));
  assert.ok(check({ ...report, featureGzipBytes: { [publicEntry]: report.featureGzipBytes[publicEntry] } }).some(value => value.includes("Missing expected feature entry")));
  assert.ok(check({ ...report, featureLoadGzipBytes: {} }).some(value => value.includes("Missing entry loading boundary metric")));
  assert.ok(check({ ...report, entryGroups: [] }).some(value => value.includes("Missing or inconsistent lineage")));
});

test("private extraction remains in each entry loading boundary and cannot erase measured bytes", t => {
  const fixture = readerBuilds(t);
  const source = payload("largePrivate", 2000);
  writeFileSync(path.join(fixture.currentDirectory, "private.js"), source);
  const report = bundleReport(fixture.currentDirectory, fixture.policy);
  assert.equal(report.entryGroups[0].ownedChunks.find(chunk => chunk.key === "private").gzipBytes, gzipSync(source).length);
  assert.ok(report.featureLoadGzipBytes[publicEntry] >= gzipSync(source).length);
  assert.ok(budgetViolations(report, fixture.baseline.report, { policy: fixture.policy }).some(value => value.includes("entry loading boundary:")));
});

test("a host and its lazy panel count common dependencies once on both sides", t => {
  const manifest = {
    "index.html": { file: "main.js", imports: ["shared"], isEntry: true }, shared: { file: "shared.js" }, extra: { file: "extra.js" },
    [hostEntry]: { file: "host.js", imports: ["shared", "index.html"], dynamicImports: [panelEntry], isDynamicEntry: true },
    [panelEntry]: { file: "panel.js", imports: ["shared", "index.html", "extra"], isDynamicEntry: true },
  };
  const contents = { "main.js": "main;", "shared.js": "shared;", "extra.js": "extra;", "host.js": "host;", "panel.js": "panel;" };
  const directory = build(t, manifest, contents);
  const context = { entry: panelEntry, hostEntry, reason: "The document opens its lazy collaboration panel." };
  const original = frozen(directory, [], [context]);
  const policy = bundleBudgetPolicy(original.config, original.baseline, original.original);
  const report = bundleReport(directory, policy);
  const combined = Object.values(contents).reduce((sum, value) => sum + gzipSync(value).length, 0);
  assert.equal(policy.baselineLoadGzipBytes[panelEntry], combined);
  assert.equal(report.featureLoadGzipBytes[panelEntry], combined);
  assert.equal(policy.baselineContextLoadGzipBytes[panelEntry][hostEntry], combined);
  assert.equal(report.contextLoadGzipBytes[panelEntry][hostEntry], combined);
  assert.equal(report.featureLoadGzipBytes[panelEntry] - report.featureLoadGzipBytes[hostEntry], gzipSync(contents["extra.js"]).length + gzipSync(contents["panel.js"]).length);
  assert.deepEqual(budgetViolations(report, original.baseline.report, { policy }), []);

  const missingEdge = structuredClone(manifest);
  missingEdge[hostEntry].dynamicImports = [];
  writeBuild(directory, missingEdge, contents);
  assert.throws(() => bundleReport(directory, policy), /Missing current host-to-panel dynamic import/);
  const changedOriginal = frozen(directory, [], [context]);
  assert.throws(() => bundleBudgetPolicy(changedOriginal.config, changedOriginal.baseline, changedOriginal.original), /Invalid original load context/);
  assert.throws(() => bundleBudgetPolicy({ ...original.config, loadContexts: [context, context] }, original.baseline, original.original), /Invalid original load context/);
  assert.throws(() => bundleBudgetPolicy({ ...original.config, loadContexts: [{ ...context, hostEntry: "src/features/missing.tsx" }] }, original.baseline, original.original), /Invalid original load context/);
});

test("each real panel host is gated separately so the largest summary cannot hide a small-host regression", t => {
  const largeHost = "src/features/documents/LargeEditor.tsx";
  const boardHost = "src/features/boards/Editor.tsx";
  const legacyName = "LegacyDocumentEditorPage";
  const oldLegacyKey = "_LegacyDocumentEditorPage-old.js";
  const currentLegacyKey = "_LegacyDocumentEditorPage-new.js";
  const host = file => ({ file, imports: ["index.html"], dynamicImports: [panelEntry], isDynamicEntry: true });
  const manifest = {
    "index.html": { file: "main.js", imports: ["shared"], isEntry: true }, shared: { file: "shared.js" },
    [hostEntry]: host("host.js"), [largeHost]: host("large.js"), [boardHost]: host("board.js"),
    [oldLegacyKey]: { ...host("legacy.js"), name: legacyName },
    [panelEntry]: { file: "panel.js", imports: ["shared", "index.html"], isDynamicEntry: true },
  };
  const contents = { "main.js": payload("main", 100), "shared.js": "shared;", "host.js": "small;", "large.js": payload("large", 2000), "board.js": "board;", "legacy.js": "legacy;", "panel.js": "panel;" };
  const originalDirectory = build(t, manifest, contents);
  const contexts = [
    { entry: panelEntry, hostEntry, reason: "Small document host" },
    { entry: panelEntry, hostEntry: largeHost, reason: "Large document host" },
    { entry: panelEntry, hostEntry: boardHost, reason: "Board host" },
    { entry: panelEntry, hostChunkName: legacyName, reason: "The legacy output has a content-hashed manifest key" },
  ];
  const original = frozen(originalDirectory, [], contexts);
  const policy = bundleBudgetPolicy(original.config, original.baseline, original.original);
  const currentManifest = structuredClone(manifest);
  currentManifest[currentLegacyKey] = currentManifest[oldLegacyKey];
  delete currentManifest[oldLegacyKey];
  const currentContents = { ...contents, "large.js": payload("large", 1800), "panel.js": payload("panel", 70) };
  const currentDirectory = build(t, currentManifest, currentContents);
  const report = bundleReport(currentDirectory, policy);
  assert.equal(Object.keys(report.contextLoadGzipBytes[panelEntry]).length, 4);
  assert.match(report.featureLoadSummary[panelEntry], /Maximum of 4/);
  assert.equal(report.featureLoadGzipBytes[panelEntry], Math.max(...Object.values(report.contextLoadGzipBytes[panelEntry])));
  assert.ok(report.featureLoadGzipBytes[panelEntry] < policy.baselineLoadGzipBytes[panelEntry] * 1.1);
  assert.ok(report.totalGzipBytes < original.baseline.report.totalGzipBytes);
  const failures = budgetViolations(report, original.baseline.report, { policy });
  assert.ok(failures.some(value => value.includes(`with ${hostEntry}:`)));
  assert.ok(failures.every(value => !value.includes(`with ${largeHost}:`)));
  assert.ok(report.contextLoadGzipBytes[panelEntry][legacyName] > policy.baselineContextLoadGzipBytes[panelEntry][legacyName]);

  const missingMetric = structuredClone(report);
  delete missingMetric.contextLoadGzipBytes[panelEntry][hostEntry];
  assert.ok(budgetViolations(missingMetric, original.baseline.report, { policy }).some(value => value.includes("Missing context entry loading boundary metric")));
  assert.throws(() => bundleBudgetPolicy({ ...original.config, loadContexts: contexts.slice(1) }, original.baseline, original.original), /Unregistered original load context host/);
  const missingEdge = structuredClone(currentManifest);
  missingEdge[hostEntry].dynamicImports = [];
  writeBuild(currentDirectory, missingEdge, currentContents);
  assert.throws(() => bundleReport(currentDirectory, policy), /Missing current host-to-panel dynamic import/);
  const ambiguousHost = structuredClone(currentManifest);
  ambiguousHost[boardHost].name = legacyName;
  writeBuild(currentDirectory, ambiguousHost, currentContents);
  assert.throws(() => bundleReport(currentDirectory, policy), /Invalid current load context host/);
});

test("load budgets derive from the verified original artifacts, not editable allowances", t => {
  const fixture = readerBuilds(t);
  const { config, baseline, original } = fixture;
  const check = (nextConfig = config, nextOriginal = original) => bundleBudgetPolicy(nextConfig, baseline, nextOriginal);
  assert.equal(fixture.policy.baselineLoadGzipBytes[publicEntry], baseline.report.initialGzipBytes + baseline.report.featureGzipBytes[publicEntry]);
  assert.equal(fixture.policy.baselineLoadGzipBytes[previewEntry], fixture.policy.baselineLoadGzipBytes[publicEntry]);
  assert.throws(() => check({ ...config, baselineManifestSha256: "0".repeat(64) }), /frozen original/);
  assert.throws(() => check({ ...config, groups: [{ ...config.groups[0], baselineLoadGzipBytes: 99999999 }] }), /derive from original/);
  assert.throws(() => check({ ...config, groups: [{ ...config.groups[0], baselineStaticGzipBytes: 99999999 }] }), /derive from original/);
  assert.throws(() => check({ ...config, groups: [config.groups[0], config.groups[0]] }), /Invalid entry lineage/);
  assert.throws(() => check({ ...config, groups: [{ ...config.groups[0], successors: [publicEntry, previewEntry, previewEntry] }] }), /more than one budget/);
  const changed = structuredClone(original);
  changed.artifacts.files["shared.js"].gzipBytes++;
  assert.throws(() => check(config, changed), /reproduce the frozen/);
  const missing = structuredClone(original);
  delete missing.artifacts.files["shared.js"];
  assert.throws(() => check(config, missing), /do not match the manifest/);
  const invalid = structuredClone(original);
  invalid.artifacts.files["shared.js"].gzipBytes = -1;
  assert.throws(() => check(config, invalid), /Invalid original artifact/);
});

test("the complete reader attribution still requires its expected static consumer edges", t => {
  const fixture = readerBuilds(t);
  const missingEdge = structuredClone(fixture.currentManifest);
  missingEdge[previewEntry].imports = ["react"];
  writeBuild(fixture.currentDirectory, missingEdge, fixture.contents);
  assert.throws(() => bundleReport(fixture.currentDirectory, fixture.policy), /Missing, ambiguous or non-static owned shared output/);
});

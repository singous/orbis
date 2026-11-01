import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { gzipSync } from "node:zlib";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { bundleReport } from "./bundle-report.mjs";

const frontend = fileURLToPath(new URL("../", import.meta.url));
const original = process.argv[2];
if (!original) throw new Error("Usage: node scripts/capture-ui-baseline-artifacts.mjs <original-git-archive-root>");
const baseline = JSON.parse(readFileSync(path.join(frontend, "ui-bundle-baseline.json")));
const sha256 = value => createHash("sha256").update(value).digest("hex");
const lock = readFileSync(path.join(original, "frontend/package-lock.json"));
if (sha256(lock) !== baseline.lockfileSha256) throw new Error("Original archive lockfile differs from the frozen baseline");
const directory = path.join(original, "frontend/dist");
const report = bundleReport(directory);
for (const key of ["initialGzipBytes", "totalGzipBytes", "featureGzipBytes"]) if (JSON.stringify(report[key]) !== JSON.stringify(baseline.report[key])) throw new Error(`Original artifact differs from the frozen baseline: ${key}`);
const manifestText = readFileSync(path.join(directory, ".vite/manifest.json"));
const manifest = JSON.parse(manifestText);
const files = {};
for (const file of [...new Set(Object.values(manifest).map(chunk => chunk.file))].sort()) {
  if (!file.endsWith(".js")) continue;
  const contents = readFileSync(path.join(directory, file));
  files[file] = { gzipBytes: gzipSync(contents).length, sha256: sha256(contents) };
}
const target = path.join(frontend, "benchmarks/ui-original");
mkdirSync(target, { recursive: true });
writeFileSync(path.join(target, "manifest.json"), manifestText);
writeFileSync(path.join(target, "artifacts.json"), JSON.stringify({ ref: baseline.ref, lockfileSha256: baseline.lockfileSha256, manifestSha256: sha256(manifestText), files }, null, 2) + "\n");
console.log(`Captured original build graph and ${Object.keys(files).length} verified JS size/hash records`);

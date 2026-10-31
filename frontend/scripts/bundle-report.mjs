import { readFileSync } from "node:fs";
import { gzipSync } from "node:zlib";
import path from "node:path";

export function bundleReport(directory) {
  const manifest = JSON.parse(readFileSync(path.join(directory, ".vite/manifest.json"), "utf8"));
  const files = new Map();
  for (const chunk of Object.values(manifest)) if (chunk.file.endsWith(".js")) files.set(chunk.file, gzipSync(readFileSync(path.join(directory, chunk.file))).length);
  const initial = new Set();
  function visit(key) {
    if (initial.has(key)) return;
    const chunk = manifest[key];
    if (!chunk) throw new Error(`Missing static chunk ${key}`);
    initial.add(key);
    for (const dependency of chunk.imports ?? []) visit(dependency);
  }
  visit("index.html");
  const initialFiles = new Set([...initial].map(key => manifest[key].file));
  const features = Object.fromEntries(Object.entries(manifest).filter(([key]) => key.startsWith("src/features/")).map(([key, chunk]) => [key, files.get(chunk.file)]).sort(([a], [b]) => a.localeCompare(b)));
  return { initialGzipBytes: [...initialFiles].reduce((sum, file) => sum + (files.get(file) ?? 0), 0), totalGzipBytes: [...files.values()].reduce((sum, size) => sum + size, 0), featureGzipBytes: features };
}

export function budgetViolations(report, baseline, { initialGrowth = 0.05, featureGrowth = 0.1 } = {}) {
  const failures = [];
  if (report.initialGzipBytes > baseline.initialGzipBytes * (1 + initialGrowth)) failures.push(`Initial JS: ${report.initialGzipBytes} > ${Math.floor(baseline.initialGzipBytes * (1 + initialGrowth))} gzip bytes`);
  for (const [key, size] of Object.entries(report.featureGzipBytes)) {
    if (baseline.featureGzipBytes[key] === undefined) failures.push(`New feature chunk requires an explicit budget: ${key} (${size} gzip bytes)`);
    else if (size > baseline.featureGzipBytes[key] * (1 + featureGrowth)) failures.push(`${key}: ${size} > ${Math.floor(baseline.featureGzipBytes[key] * (1 + featureGrowth))} gzip bytes`);
  }
  return failures;
}

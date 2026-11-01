import { readFileSync } from "node:fs";
import { gzipSync } from "node:zlib";
import path from "node:path";
import { createHash } from "node:crypto";

function staticChunks(manifest, entry) {
  const keys = new Set();
  function visit(key) {
    if (keys.has(key)) return;
    const chunk = manifest[key];
    if (!chunk) throw new Error(`Missing static chunk ${key}`);
    keys.add(key);
    for (const dependency of chunk.imports ?? []) visit(dependency);
  }
  visit(entry);
  return keys;
}

function staticSize(manifest, sizes, entry) {
  return [...new Set([...staticChunks(manifest, entry)].map(key => manifest[key].file))].reduce((sum, file) => sum + (sizes.get(file) ?? 0), 0);
}

function lineageChunks(manifest, members) {
  const owned = new Set(members.flatMap(key => [...staticChunks(manifest, key)]));
  for (const [key, chunk] of Object.entries(manifest)) {
    if (members.includes(key) || (!chunk.isEntry && !chunk.isDynamicEntry)) continue;
    for (const dependency of staticChunks(manifest, key)) owned.delete(dependency);
  }
  for (const member of members) owned.add(member);
  return owned;
}

export function entryGroupPolicy(config, baseline, original) {
  const digest = createHash("sha256").update(original.manifestText).digest("hex");
  if (config.baselineRef !== baseline.ref || config.lockfileSha256 !== baseline.lockfileSha256 || config.baselineManifestSha256 !== digest || original.artifacts.manifestSha256 !== digest || original.artifacts.ref !== baseline.ref || original.artifacts.lockfileSha256 !== baseline.lockfileSha256) throw new Error("Entry lineage must refer to the frozen original build");
  const manifest = JSON.parse(original.manifestText);
  const sizes = new Map(Object.entries(original.artifacts.files).map(([file, data]) => {
    if (!Number.isInteger(data.gzipBytes) || data.gzipBytes < 0 || !/^[a-f0-9]{64}$/.test(data.sha256)) throw new Error(`Invalid original artifact record: ${file}`);
    return [file, data.gzipBytes];
  }));
  const originals = new Set(Object.values(manifest).map(chunk => chunk.file).filter(file => file.endsWith(".js")));
  if (sizes.size !== originals.size || [...originals].some(file => !sizes.has(file))) throw new Error("Original artifact records do not match the manifest files");
  const features = Object.fromEntries(Object.entries(manifest).filter(([key]) => key.startsWith("src/features/")).map(([key, chunk]) => [key, sizes.get(chunk.file)]).sort(([a], [b]) => a.localeCompare(b)));
  if (staticSize(manifest, sizes, "index.html") !== baseline.report.initialGzipBytes || [...sizes.values()].reduce((sum, size) => sum + size, 0) !== baseline.report.totalGzipBytes || JSON.stringify(features) !== JSON.stringify(baseline.report.featureGzipBytes)) throw new Error("Original artifact graph does not reproduce the frozen byte report");
  const entries = new Set();
  const budgets = new Set();
  return config.groups.map(group => {
    if (!group.reason || baseline.report.featureGzipBytes[group.baselineEntry] === undefined || budgets.has(group.baselineEntry) || group.successors.length < 2 || !group.successors.includes(group.baselineEntry) || !group.expectedSharedChunks.length || new Set(group.expectedSharedChunks).size !== group.expectedSharedChunks.length || group.expectedSharedChunks.some(name => Object.values(manifest).some(chunk => chunk.name === name))) throw new Error(`Invalid entry lineage: ${group.baselineEntry}`);
    if ("baselineStaticGzipBytes" in group) throw new Error("Static lineage budgets must derive from original artifacts");
    const originalOwnFiles = new Set([...lineageChunks(manifest, [group.baselineEntry])].map(key => manifest[key].file));
    if ([...originalOwnFiles].reduce((sum, file) => sum + (sizes.get(file) ?? 0), 0) !== baseline.report.featureGzipBytes[group.baselineEntry]) throw new Error(`Lineage ownership does not reproduce the original own budget: ${group.baselineEntry}`);
    budgets.add(group.baselineEntry);
    for (const member of group.successors) {
      if (!member.startsWith("src/features/") || entries.has(member)) throw new Error(`Entry receives more than one budget or is not a feature: ${member}`);
      entries.add(member);
    }
    return { ...group, baselineStaticGzipBytes: staticSize(manifest, sizes, group.baselineEntry) };
  });
}

export function bundleReport(directory, entryGroups = []) {
  const manifest = JSON.parse(readFileSync(path.join(directory, ".vite/manifest.json"), "utf8"));
  const files = new Map();
  for (const chunk of Object.values(manifest)) if (chunk.file.endsWith(".js")) files.set(chunk.file, gzipSync(readFileSync(path.join(directory, chunk.file))).length);
  const sizeOf = keys => [...new Set([...keys].map(key => manifest[key].file))].reduce((sum, file) => sum + (files.get(file) ?? 0), 0);
  const features = Object.fromEntries(Object.entries(manifest).filter(([key]) => key.startsWith("src/features/")).map(([key, chunk]) => [key, files.get(chunk.file)]).sort(([a], [b]) => a.localeCompare(b)));
  const closures = new Map(Object.keys(features).map(key => [key, staticChunks(manifest, key)]));
  return {
    initialGzipBytes: sizeOf(staticChunks(manifest, "index.html")),
    totalGzipBytes: [...files.values()].reduce((sum, size) => sum + size, 0),
    featureGzipBytes: features,
    featureStaticGzipBytes: Object.fromEntries([...closures].map(([key, closure]) => [key, sizeOf(closure)])),
    entryGroups: entryGroups.map(group => {
      const owned = lineageChunks(manifest, group.successors);
      for (const name of group.expectedSharedChunks) {
        const matches = Object.entries(manifest).filter(([, chunk]) => chunk.name === name);
        if (matches.length !== 1 || !files.has(matches[0][1].file) || !owned.has(matches[0][0]) || !group.successors.every(member => closures.get(member)?.has(matches[0][0]))) throw new Error(`Missing, ambiguous or non-static owned shared output: ${name}`);
      }
      return {
        baselineEntry: group.baselineEntry,
        ownGzipBytes: sizeOf(owned),
        ownedChunks: [...owned].filter(key => files.has(manifest[key].file)).map(key => ({ key, name: manifest[key].name, file: manifest[key].file, gzipBytes: files.get(manifest[key].file) })),
        sharedStaticChunks: [...closures.get(group.baselineEntry)].filter(key => !group.successors.includes(key) && files.has(manifest[key].file) && group.successors.every(member => closures.get(member)?.has(key))).map(key => ({ key, file: manifest[key].file, gzipBytes: files.get(manifest[key].file), directConsumers: group.successors.filter(member => manifest[member].imports?.includes(key)) })),
      };
    }),
  };
}

export function budgetViolations(report, baseline, { initialGrowth = 0.05, featureGrowth = 0.1, entryGroups = [] } = {}) {
  const failures = [];
  if (report.initialGzipBytes > baseline.initialGzipBytes * (1 + initialGrowth)) failures.push(`Initial JS: ${report.initialGzipBytes} > ${Math.floor(baseline.initialGzipBytes * (1 + initialGrowth))} gzip bytes`);
  const grouped = new Set(entryGroups.flatMap(group => group.successors));
  for (const group of entryGroups) {
    const missing = group.successors.filter(key => report.featureGzipBytes[key] === undefined);
    if (missing.length) { failures.push(`Missing successor entry: ${missing.join(", ")}`); continue; }
    const owned = report.entryGroups?.find(item => item.baselineEntry === group.baselineEntry)?.ownedChunks;
    if (!owned || group.successors.some(key => !owned.some(chunk => chunk.key === key && chunk.gzipBytes === report.featureGzipBytes[key])) || owned.some(chunk => !Number.isFinite(chunk.gzipBytes)) || group.expectedSharedChunks.some(name => owned.filter(chunk => chunk.name === name).length !== 1)) { failures.push(`Missing or inconsistent lineage output metric: ${group.baselineEntry}`); continue; }
    const own = [...new Map(owned.map(chunk => [chunk.file, chunk.gzipBytes])).values()].reduce((sum, size) => sum + size, 0);
    const limit = baseline.featureGzipBytes[group.baselineEntry] * (1 + featureGrowth);
    if (own > limit) failures.push(`${group.baselineEntry} lineage own total: ${own} > ${Math.floor(limit)} gzip bytes`);
    for (const key of group.successors) {
      const size = report.featureStaticGzipBytes?.[key];
      if (!Number.isFinite(size)) failures.push(`Missing static closure metric: ${key}`);
      else if (size > group.baselineStaticGzipBytes * (1 + featureGrowth)) failures.push(`${key} static closure: ${size} > ${Math.floor(group.baselineStaticGzipBytes * (1 + featureGrowth))} gzip bytes`);
    }
  }
  for (const [key, size] of Object.entries(report.featureGzipBytes)) {
    if (grouped.has(key)) continue;
    if (baseline.featureGzipBytes[key] === undefined) failures.push(`New feature chunk requires an explicit budget: ${key} (${size} gzip bytes)`);
    else if (size > baseline.featureGzipBytes[key] * (1 + featureGrowth)) failures.push(`${key}: ${size} > ${Math.floor(baseline.featureGzipBytes[key] * (1 + featureGrowth))} gzip bytes`);
  }
  return failures;
}

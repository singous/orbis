import { existsSync, readFileSync, readdirSync } from "node:fs";
import { gzipSync } from "node:zlib";
import path from "node:path";
import { createHash } from "node:crypto";

function chunkClosure(manifest, entries, includeDynamic = false) {
  const keys = new Set();
  function visit(key) {
    if (keys.has(key)) return;
    const chunk = manifest[key];
    if (!chunk) throw new Error(`Missing chunk: ${key}`);
    keys.add(key);
    for (const dependency of chunk.imports ?? []) visit(dependency);
    // The main module registers every route; those are not a feature's optional UI.
    if (includeDynamic && key !== "index.html") for (const dependency of chunk.dynamicImports ?? []) visit(dependency);
  }
  for (const entry of entries) visit(entry);
  return keys;
}

function sizeOf(manifest, sizes, keys) {
  return [...new Set([...keys].map(key => manifest[key].file))].reduce((sum, file) => sum + (sizes.get(file) ?? 0), 0);
}

function lineageChunks(manifest, members) {
  const owned = chunkClosure(manifest, members);
  for (const [key, chunk] of Object.entries(manifest)) {
    if (members.includes(key) || (!chunk.isEntry && !chunk.isDynamicEntry)) continue;
    for (const dependency of chunkClosure(manifest, [key])) owned.delete(dependency);
  }
  for (const member of members) owned.add(member);
  return owned;
}

export function bundleBudgetPolicy(config, baseline, original) {
  const { manifest, sizes } = originalGraph(config, baseline, original);
  const entryGroups = resolvedEntryGroups(config.groups, baseline, manifest, sizes);
  const baselineEntries = new Map(Object.keys(baseline.report.featureGzipBytes).map(key => [key, key]));
  for (const group of entryGroups) for (const successor of group.successors) baselineEntries.set(successor, group.baselineEntry);
  const redirects = config.redirects ?? [];
  const retiredEntries = new Set(redirects.map(redirect => redirect.originalEntry));
  if (retiredEntries.size !== redirects.length) throw new Error("Duplicate retired feature entry");
  for (const { originalEntry, replacement, reason } of redirects) {
    if (!reason || baseline.report.featureGzipBytes[originalEntry] === undefined || !baselineEntries.has(replacement) || retiredEntries.has(replacement) || entryGroups.some(group => group.successors.includes(originalEntry))) {
      throw new Error(`Invalid feature redirect: ${originalEntry}`);
    }
    baselineEntries.delete(originalEntry);
  }
  const loadContexts = config.loadContexts ?? [];
  const baselineContextLoadGzipBytes = contextLoads(manifest, sizes, resolvedLoadContexts(loadContexts, manifest, baselineEntries));
  const baselineLoadGzipBytes = Object.fromEntries([...baselineEntries].map(([entry, originalEntry]) => {
    const contexts = baselineContextLoadGzipBytes[entry];
    return [entry, contexts ? Math.max(...Object.values(contexts)) : sizeOf(manifest, sizes, chunkClosure(manifest, ["index.html", originalEntry]))];
  }));
  return { entryGroups, loadContexts, retiredEntries, baselineLoadGzipBytes, baselineContextLoadGzipBytes };
}

function originalGraph(config, baseline, original) {
  const digest = createHash("sha256").update(original.manifestText).digest("hex");
  if (config.baselineRef !== baseline.ref || config.lockfileSha256 !== baseline.lockfileSha256 || config.baselineManifestSha256 !== digest || original.artifacts.manifestSha256 !== digest || original.artifacts.ref !== baseline.ref || original.artifacts.lockfileSha256 !== baseline.lockfileSha256) throw new Error("Load budgets must refer to the frozen original build");
  const manifest = JSON.parse(original.manifestText);
  const sizes = new Map(Object.entries(original.artifacts.files).map(([file, data]) => {
    if (!Number.isInteger(data.gzipBytes) || data.gzipBytes < 0 || !/^[a-f0-9]{64}$/.test(data.sha256)) throw new Error(`Invalid original artifact record: ${file}`);
    return [file, data.gzipBytes];
  }));
  const originals = new Set(Object.values(manifest).map(chunk => chunk.file).filter(file => file.endsWith(".js")));
  if (sizes.size !== originals.size || [...originals].some(file => !sizes.has(file))) throw new Error("Original artifact records do not match the manifest files");
  const features = Object.fromEntries(Object.entries(manifest).filter(([key]) => key.startsWith("src/features/")).map(([key, chunk]) => [key, sizes.get(chunk.file)]).sort(([a], [b]) => a.localeCompare(b)));
  if (sizeOf(manifest, sizes, chunkClosure(manifest, ["index.html"])) !== baseline.report.initialGzipBytes || [...sizes.values()].reduce((sum, size) => sum + size, 0) !== baseline.report.totalGzipBytes || JSON.stringify(features) !== JSON.stringify(baseline.report.featureGzipBytes)) throw new Error("Original artifact graph does not reproduce the frozen byte report");
  return { manifest, sizes };
}

function resolvedEntryGroups(groups, baseline, manifest, sizes) {
  const entries = new Set();
  const budgets = new Set();
  return groups.map(group => {
    if (!group.reason || baseline.report.featureGzipBytes[group.baselineEntry] === undefined || budgets.has(group.baselineEntry) || group.successors.length < 2 || !group.successors.includes(group.baselineEntry) || !group.expectedSharedChunks.length || new Set(group.expectedSharedChunks).size !== group.expectedSharedChunks.length || group.expectedSharedChunks.some(name => Object.values(manifest).some(chunk => chunk.name === name))) throw new Error(`Invalid entry lineage: ${group.baselineEntry}`);
    if ("baselineStaticGzipBytes" in group || "baselineLoadGzipBytes" in group) throw new Error("Load budgets must derive from original artifacts");
    if (sizeOf(manifest, sizes, lineageChunks(manifest, [group.baselineEntry])) !== baseline.report.featureGzipBytes[group.baselineEntry]) throw new Error(`Lineage ownership does not reproduce the original diagnostic: ${group.baselineEntry}`);
    budgets.add(group.baselineEntry);
    for (const member of group.successors) {
      if (!member.startsWith("src/features/") || entries.has(member)) throw new Error(`Entry receives more than one budget or is not a feature: ${member}`);
      entries.add(member);
    }
    return group;
  });
}

function resolvedLoadContexts(contexts, manifest, baselineEntries) {
  const phase = baselineEntries ? "original" : "current";
  const pairs = new Set();
  const resolved = contexts.map(context => {
    const entry = baselineEntries ? baselineEntries.get(context.entry) : context.entry;
    const hostId = context.hostEntry || context.hostChunkName;
    if (baselineEntries && (!context.reason || !entry || Boolean(context.hostEntry) === Boolean(context.hostChunkName) || "baselineLoadGzipBytes" in context || "baselineContextLoadGzipBytes" in context)) throw new Error(`Invalid original load context: ${context.entry}`);
    const matches = context.hostChunkName ? Object.entries(manifest).filter(([, chunk]) => chunk.name === context.hostChunkName).map(([key]) => key) : [baselineEntries?.get(context.hostEntry) ?? context.hostEntry];
    if (matches.length !== 1) throw new Error(`Invalid ${phase} load context host: ${hostId}`);
    const host = matches[0];
    if (!manifest[host]?.dynamicImports?.includes(entry)) throw new Error(baselineEntries ? `Invalid original load context: ${context.entry}` : `Missing current host-to-panel dynamic import: ${host} -> ${entry}`);
    const pair = `${context.entry}\0${host}`;
    if (pairs.has(pair)) throw new Error(`Invalid ${phase} load context: ${context.entry} with ${hostId}`);
    pairs.add(pair);
    return { entry: context.entry, moduleEntry: entry, hostEntry: host, hostId };
  });
  for (const entry of new Set(resolved.map(context => context.entry))) {
    const declared = resolved.filter(context => context.entry === entry);
    const hosts = new Set(declared.map(context => context.hostEntry));
    for (const [key, chunk] of Object.entries(manifest)) if (chunk.dynamicImports?.includes(declared[0].moduleEntry) && !hosts.has(key)) throw new Error(`Unregistered ${phase} load context host: ${entry} <- ${key}`);
  }
  return resolved;
}

function contextLoads(manifest, sizes, contexts, includeDynamic = false) {
  const loads = {};
  for (const context of contexts) {
    const entries = ["index.html", context.moduleEntry, context.hostEntry];
    (loads[context.entry] ??= {})[context.hostId] = sizeOf(manifest, sizes, chunkClosure(manifest, entries, includeDynamic));
  }
  return loads;
}

export function bundleReport(directory, policy = { entryGroups: [], loadContexts: [] }) {
  const manifest = JSON.parse(readFileSync(path.join(directory, ".vite/manifest.json"), "utf8"));
  const files = new Map();
  for (const chunk of Object.values(manifest)) if (chunk.file.endsWith(".js")) files.set(chunk.file, gzipSync(readFileSync(path.join(directory, chunk.file))).length);
  const contexts = resolvedLoadContexts(policy.loadContexts, manifest);
  const contextLoadGzipBytes = contextLoads(manifest, files, contexts);
  const contextDynamicUpperBoundGzipBytes = contextLoads(manifest, files, contexts, true);
  const features = Object.fromEntries(Object.entries(manifest).filter(([key]) => key.startsWith("src/features/")).map(([key, chunk]) => [key, files.get(chunk.file)]).sort(([a], [b]) => a.localeCompare(b)));
  const closures = new Map(Object.keys(features).map(key => [key, chunkClosure(manifest, [key])]));
  const totalGzipBytes = [...files.values()].reduce((sum, size) => sum + size, 0);
  const additionalJsAssets = extraJavaScript(directory, files);
  return {
    compression: { node: process.versions.node, zlib: process.versions.zlib, level: "default" },
    initialGzipBytes: sizeOf(manifest, files, chunkClosure(manifest, ["index.html"])),
    totalGzipBytes,
    fileGzipBytes: Object.fromEntries(files),
    additionalJsAssets,
    totalEmittedJsGzipBytes: totalGzipBytes + additionalJsAssets.reduce((sum, asset) => sum + asset.gzipBytes, 0),
    featureGzipBytes: features,
    featureStaticGzipBytes: Object.fromEntries([...closures].map(([key, closure]) => [key, sizeOf(manifest, files, closure)])),
    contextLoadGzipBytes,
    featureLoadSummary: Object.fromEntries(Object.entries(contextLoadGzipBytes).map(([key, loads]) => [key, `Maximum of ${Object.keys(loads).length} declared host entry boundaries; each context is gated separately`])),
    featureLoadGzipBytes: Object.fromEntries(Object.keys(features).map(key => [key, contextLoadGzipBytes[key] ? Math.max(...Object.values(contextLoadGzipBytes[key])) : sizeOf(manifest, files, chunkClosure(manifest, ["index.html", key]))])),
    featureDynamicUpperBoundGzipBytes: Object.fromEntries(Object.keys(features).map(key => [key, contextDynamicUpperBoundGzipBytes[key] ? Math.max(...Object.values(contextDynamicUpperBoundGzipBytes[key])) : sizeOf(manifest, files, chunkClosure(manifest, ["index.html", key], true))])),
    entryGroups: policy.entryGroups.map(group => {
      const owned = lineageChunks(manifest, group.successors);
      for (const name of group.expectedSharedChunks) {
        const matches = Object.entries(manifest).filter(([, chunk]) => chunk.name === name);
        if (matches.length !== 1 || !files.has(matches[0][1].file) || !owned.has(matches[0][0]) || !group.successors.every(member => closures.get(member)?.has(matches[0][0]))) throw new Error(`Missing, ambiguous or non-static owned shared output: ${name}`);
      }
      return {
        baselineEntry: group.baselineEntry,
        ownGzipBytes: sizeOf(manifest, files, owned),
        ownedChunks: [...owned].filter(key => files.has(manifest[key].file)).map(key => ({ key, name: manifest[key].name, file: manifest[key].file, gzipBytes: files.get(manifest[key].file) })),
        sharedStaticChunks: [...closures.get(group.baselineEntry)].filter(key => !group.successors.includes(key) && files.has(manifest[key].file) && group.successors.every(member => closures.get(member)?.has(key))).map(key => ({ key, file: manifest[key].file, gzipBytes: files.get(manifest[key].file), directConsumers: group.successors.filter(member => manifest[member].imports?.includes(key)) })),
      };
    }),
  };
}

function extraJavaScript(directory, files) {
  const assets = path.join(directory, "assets");
  if (!existsSync(assets)) return [];
  return readdirSync(assets, { recursive: true, withFileTypes: true }).filter(entry => entry.isFile() && entry.name.endsWith(".js"))
    .map(entry => path.relative(directory, path.join(entry.parentPath, entry.name)).split(path.sep).join("/"))
    .filter(file => !files.has(file))
    .map(file => ({ file, gzipBytes: gzipSync(readFileSync(path.join(directory, file))).length }))
    .sort((a, b) => a.file.localeCompare(b.file));
}

export function budgetViolations(report, baseline, { policy, initialGrowth = 0.05, featureGrowth = 0.1 } = {}) {
  const failures = [];
  if (report.initialGzipBytes > baseline.initialGzipBytes * (1 + initialGrowth)) failures.push(`Initial JS: ${report.initialGzipBytes} > ${Math.floor(baseline.initialGzipBytes * (1 + initialGrowth))} gzip bytes`);
  for (const [entry, originalSize] of Object.entries(policy.baselineLoadGzipBytes)) {
    if (report.featureGzipBytes[entry] === undefined) { failures.push(`Missing expected feature entry: ${entry}`); continue; }
    const contexts = policy.baselineContextLoadGzipBytes[entry];
    if (contexts) {
      for (const [host, baselineSize] of Object.entries(contexts)) {
        const size = report.contextLoadGzipBytes?.[entry]?.[host];
        if (!Number.isFinite(size)) failures.push(`Missing context entry loading boundary metric: ${entry} with ${host}`);
        else if (size > baselineSize * (1 + featureGrowth)) failures.push(`${entry} entry loading boundary with ${host}: ${size} > ${Math.floor(baselineSize * (1 + featureGrowth))} gzip bytes`);
      }
      continue;
    }
    const size = report.featureLoadGzipBytes?.[entry];
    if (!Number.isFinite(size)) failures.push(`Missing entry loading boundary metric: ${entry}`);
    else if (size > originalSize * (1 + featureGrowth)) failures.push(`${entry} entry loading boundary: ${size} > ${Math.floor(originalSize * (1 + featureGrowth))} gzip bytes`);
  }
  for (const [entry, size] of Object.entries(report.featureGzipBytes)) {
    if (policy.retiredEntries?.has(entry)) failures.push(`Retired feature entry is still emitted: ${entry}`);
    else if (policy.baselineLoadGzipBytes[entry] === undefined) failures.push(`New feature entry requires an explicit budget: ${entry} (${size} gzip bytes)`);
  }
  return [...failures, ...lineageMetricViolations(report, policy.entryGroups)];
}

function lineageMetricViolations(report, groups) {
  const failures = [];
  for (const group of groups) {
    const owned = report.entryGroups?.find(item => item.baselineEntry === group.baselineEntry)?.ownedChunks;
    if (!owned || group.successors.some(key => !owned.some(chunk => chunk.key === key && chunk.gzipBytes === report.featureGzipBytes[key])) || owned.some(chunk => !Number.isFinite(chunk.gzipBytes)) || group.expectedSharedChunks.some(name => owned.filter(chunk => chunk.name === name).length !== 1)) failures.push(`Missing or inconsistent lineage output diagnostic: ${group.baselineEntry}`);
  }
  return failures;
}

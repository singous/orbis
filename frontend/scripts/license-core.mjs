import path from "node:path";

const allowed = new Set(["MIT", "MIT-0", "ISC", "BSD-2-Clause", "BSD-3-Clause", "Apache-2.0", "0BSD", "Unlicense", "CC0-1.0", "OFL-1.1", "Python-2.0", "BlueOak-1.0.0"]);
const review = new Set(["MPL-2.0", "EPL-2.0", "LGPL-2.1-only", "LGPL-2.1-or-later", "LGPL-3.0-only", "LGPL-3.0-or-later", "GPL-2.0-only", "GPL-2.0-or-later", "GPL-3.0-only", "GPL-3.0-or-later", "AGPL-3.0-only", "AGPL-3.0-or-later", "CC-BY-4.0", "CC-BY-SA-4.0"]);

/** Parse SPDX's expression grammar; catalog membership is a separate policy decision. */
export function licensePolicy(expression) {
  const tokens = expression.match(/[A-Za-z0-9][A-Za-z0-9.+-]*|[()]/g) ?? [];
  if (tokens.join("") !== expression.replace(/\s/g, "")) throw new Error(`Invalid SPDX expression: ${expression}`);
  const identifiers = [];
  let cursor = 0;
  function term() {
    if (tokens[cursor] === "(") {
      cursor++;
      or();
      if (tokens[cursor++] !== ")") throw new Error(`Unbalanced SPDX expression: ${expression}`);
      return;
    }
    const identifier = tokens[cursor++];
    if (!identifier || ["AND", "OR", "WITH", ")"].includes(identifier)) throw new Error(`Invalid SPDX identifier: ${expression}`);
    identifiers.push(identifier);
    if (tokens[cursor] === "WITH") {
      cursor++;
      const exception = tokens[cursor++];
      if (!exception || ["AND", "OR", "WITH", "(", ")"].includes(exception)) throw new Error(`Invalid SPDX exception: ${expression}`);
      identifiers.push(exception);
    }
  }
  function and() { term(); while (tokens[cursor] === "AND") { cursor++; term(); } }
  function or() { and(); while (tokens[cursor] === "OR") { cursor++; and(); } }
  or();
  if (cursor !== tokens.length) throw new Error(`Invalid SPDX expression: ${expression}`);
  return identifiers.some(identifier => !allowed.has(identifier) && !review.has(identifier)) ? "denied" : identifiers.some(identifier => review.has(identifier)) ? "review-required" : "permissive";
}

export function packageName(location) {
  return location.split("node_modules/").at(-1);
}

function resolvePackage(packages, from, name) {
  let directory = from;
  while (true) {
    const candidate = directory ? `${directory}/node_modules/${name}` : `node_modules/${name}`;
    if (packages[candidate]) return packages[candidate].link ? packages[candidate].resolved : candidate;
    if (!directory) return undefined;
    directory = path.posix.dirname(directory);
    if (directory === ".") directory = "";
  }
}

/** Classify declared dependency reachability, including workspace and optional platform packages. */
export function dependencyUsage(packages) {
  const usage = new Map();
  const root = packages[""];
  const buildRoots = new Set(["@tailwindcss/vite", "tailwindcss", "vite", "@vitejs/plugin-react", "esbuild"]);
  const assetRoots = new Set(["@fontsource-variable/inter", "@iconify-json/tabler"]);
  function visit(location, scope) {
    if (!location) return;
    const seen = usage.get(location) ?? new Set();
    if (seen.has(scope)) return;
    seen.add(scope);
    usage.set(location, seen);
    const entry = packages[location];
    for (const name of Object.keys({ ...entry.dependencies, ...entry.optionalDependencies, ...entry.peerDependencies })) {
      visit(resolvePackage(packages, location, name), scope);
    }
  }
  for (const name of Object.keys({ ...root.dependencies, ...root.devDependencies })) {
    const scope = assetRoots.has(name) ? "asset" : buildRoots.has(name) ? "build-only" : Object.hasOwn(root.dependencies ?? {}, name) ? "runtime" : "dev-only";
    visit(resolvePackage(packages, "", name), scope);
  }
  return usage;
}

export function parseSourcePins(text) {
  return text.split(/\r?\n/).filter(line => line.trim() && !line.startsWith("#")).map(line => {
    const [name, version, artifactIntegrity, sourceRevision, sourceURL, sourceSHA256, destination, ...extra] = line.split("\t");
    if (extra.length || !name || !version || !/^sha(?:256|384|512)-\S+$/.test(artifactIntegrity ?? "") || !/^[a-f0-9]{40}$/.test(sourceRevision ?? "") || !/^https:\/\//.test(sourceURL ?? "") || !/^[a-f0-9]{64}$/.test(sourceSHA256 ?? "") || !/^[\w.-]+\.(?:tar\.gz|tgz|zip)$/.test(destination ?? "")) throw new Error(`Invalid corresponding-source pin: ${line}`);
    return { name, version, artifactIntegrity, sourceRevision, sourceURL, sourceSHA256, destination };
  });
}

/** Bundled dependencies inherit the containing npm tarball identity. */
export function distributionArtifact(packages, location) {
  const entry = packages[location];
  if (entry.resolved && entry.integrity) return { artifact: entry.resolved, integrity: entry.integrity };
  if (!entry.inBundle) throw new Error(`Locked dependency has no artifact identity: ${location}`);
  let owner = location;
  while (owner.includes("/node_modules/")) {
    owner = owner.slice(0, owner.lastIndexOf("/node_modules/"));
    const container = packages[owner];
    if (container?.resolved && container?.integrity) return {
      artifact: container.resolved,
      integrity: container.integrity,
      artifactOwner: { name: packageName(owner), version: container.version, location: owner },
    };
  }
  throw new Error(`Bundled dependency has no containing artifact: ${location}`);
}

export function licenseReadiness(packages, reviews, sourcePins) {
  const distributionIssues = [];
  const toolingIssues = [];
  for (const item of packages) {
    const issues = packageLicenseIssues(item, reviews.packages[`${item.name}@${item.version}`], sourcePins);
    (item.distribution === "not-in-frontend-runtime" ? toolingIssues : distributionIssues).push(...issues);
  }
  return {
    inventoryComplete: distributionIssues.length === 0 && toolingIssues.length === 0,
    distributionReady: distributionIssues.length === 0,
    distributionIssues,
    toolingIssues,
  };
}

function packageLicenseIssues(item, decision, sourcePins) {
  const issues = [];
  const policy = licensePolicy(item.license);
  if (!item.texts.length) issues.push(`Missing license text: ${item.name}@${item.version}`);
  if (policy === "denied") issues.push(`License not admitted by policy: ${item.name}@${item.version} (${item.license})`);
  if (policy !== "review-required") return issues;
  if (!hasAssessment(decision)) {
    issues.push(`License assessment pending: ${item.name}@${item.version} (${item.license}; ${item.distribution})`);
    return issues;
  }
  const declared = item.license.match(/[A-Za-z0-9][A-Za-z0-9.+-]*/g);
  const validElection = decision.selectedLicense === item.license || (!declared.includes("AND") && declared.includes("OR") && declared.includes(decision.selectedLicense));
  if (!validElection) throw new Error(`Selected license is outside declared expression: ${item.name}`);
  if (decision.correspondingSourceRequired && !sourcePins.some(pin => pin.name === item.name && pin.version === item.version)) issues.push(`Assessed source material pin missing: ${item.name}@${item.version}`);
  return issues;
}

function hasAssessment(decision) {
  if (!decision?.conclusion || !decision.selectedLicense || typeof decision.correspondingSourceRequired !== "boolean") return false;
  if (decision.status === "approved") return Boolean(decision.approvedBy && decision.approvedAt);
  return decision.status === "assessed" && decision.assessmentType === "engineering" &&
    Boolean(decision.assessedBy) && Number.isSafeInteger(decision.assessedAtMs) && decision.assessedAtMs > 0;
}

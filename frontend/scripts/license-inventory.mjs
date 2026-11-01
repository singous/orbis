import { createHash } from "node:crypto";
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { dependencyUsage, distributionArtifact, licensePolicy, packageName, parseSourcePins } from "./license-core.mjs";
import { distributionSource, writeLicenseBundleIndex, verifyLicenseBundle } from "./license-bundle.mjs";

const root = process.env.ORBIS_LICENSE_ROOT ?? fileURLToPath(new URL("../../", import.meta.url));
const args = process.argv.slice(2);
const bundleIndex = args.indexOf("--bundle");
const check = args.includes("--check") || bundleIndex !== -1;
const release = args.includes("--release") || bundleIndex !== -1;
const sha256 = value => createHash("sha256").update(value).digest("hex");
const read = file => readFileSync(path.join(root, file), "utf8");
const write = (file, text) => { mkdirSync(path.dirname(path.join(root, file)), { recursive: true }); writeFileSync(path.join(root, file), text); };
const lockText = read("frontend/package-lock.json");
const lock = JSON.parse(lockText);
const previous = existsSync(path.join(root, "licenses/npm-manifest.json")) ? JSON.parse(read("licenses/npm-manifest.json")) : { packages: [] };
const supplemental = JSON.parse(read("licenses/supplemental-texts.json"));
const reviews = JSON.parse(read("licenses/reviews.json"));
const usage = dependencyUsage(lock.packages);
const packages = [];

for (const [location, entry] of Object.entries(lock.packages).sort(([a], [b]) => a.localeCompare(b))) {
  if (!location || entry.link || location.startsWith("packages/")) continue;
  const name = packageName(location);
  const artifact = distributionArtifact(lock.packages, location);
  const prior = previous.packages.find(item => item.location === location && item.version === entry.version && item.integrity === artifact.integrity && item.license === entry.license);
  const supplement = supplemental.packages[`${name}@${entry.version}`];
  if (supplement && supplement.license !== entry.license) throw new Error(`Supplemental license differs from lockfile: ${name}@${entry.version}`);
  let texts = supplement?.texts ?? prior?.texts ?? [];
  if (!check && !supplement) {
    const installed = installedLicenseTexts(location, entry);
    if (installed.length) texts = installed;
  }
  const declaredUsage = [...(usage.get(location) ?? [])].sort();
  if (!declaredUsage.length) throw new Error(`Dependency has no declared owner: ${location}`);
  packages.push({
    name, version: entry.version, location,
    license: entry.license ?? "UNKNOWN",
    policy: licensePolicy(entry.license ?? "UNKNOWN"),
    ...artifact,
    usage: declaredUsage,
    distribution: declaredUsage.includes("runtime") ? "browser-js" : declaredUsage.includes("asset") ? "static-assets" : "not-in-frontend-runtime",
    texts,
  });
}
const embedded = JSON.parse(read("licenses/embedded-notices.json"));
for (const item of embedded.components) {
  if (!packages.some(parent => `${parent.name}@${parent.version}` === item.parentPackage)) throw new Error(`Stale embedded-code notice: ${item.name}`);
  if (licensePolicy(item.license) !== "permissive" || !/^[a-f0-9]{40}$/.test(item.sourceRevision) || !item.sourceURL.startsWith("https://") || !item.modifications) throw new Error(`Embedded-code record needs source/license review: ${item.name}`);
  validateText(item.text, item.name);
}
const manifest = {
  schemaVersion: 3,
  lockfileSha256: sha256(lockText),
  classification: "Declared dependency closure: runtime dependencies except explicit Vite/Tailwind build roots; Inter and generated Tabler icons are assets. Peers and optional binaries retain every applicable owner. This is a conservative declared-dependency inventory, not a measurement of tree-shaken emitted code. Build/test sources are not part of the frontend static distribution.",
  packages,
  embeddedComponents: embedded.components,
};
const serialized = JSON.stringify(manifest, null, 2) + "\n";
if (check) {
  if (read("licenses/npm-manifest.json") !== serialized) throw new Error("License inventory is stale; run npm run licenses:generate");
} else write("licenses/npm-manifest.json", serialized);

for (const item of packages) for (const text of item.texts) validateText(text, item.name);
validateCopiedCode();
syncAssetNotices();
const sourcePins = parseSourcePins(read("licenses/sources/packages.tsv"));
for (const pin of sourcePins) {
  if (!packages.some(item => item.name === pin.name && item.version === pin.version && item.integrity === pin.artifactIntegrity)) throw new Error(`Stale source pin: ${pin.name}@${pin.version}`);
}
const generatedNotice = noticeTable(packages);
const currentNotice = read("THIRD_PARTY_NOTICES.md");
const noticeRegion = /<!-- npm-inventory:start -->[\s\S]*?<!-- npm-inventory:end -->/;
if (check) {
  if (currentNotice.match(noticeRegion)?.[0] !== generatedNotice) throw new Error("Third-party notice inventory is stale; run npm run licenses:generate");
} else write("THIRD_PARTY_NOTICES.md", noticeRegion.test(currentNotice) ? currentNotice.replace(noticeRegion, generatedNotice) : `${currentNotice.trimEnd()}\n\n${generatedNotice}\n`);

const issues = [];
for (const item of packages) {
  if (!item.texts.length) issues.push(`Missing license text: ${item.name}@${item.version}`);
  if (item.policy === "denied") issues.push(`License not admitted by policy: ${item.name}@${item.version} (${item.license})`);
  if (item.policy === "review-required") {
    const decision = reviews.packages[`${item.name}@${item.version}`];
    if (!decision || decision.status !== "approved" || !decision.approvedBy || !decision.approvedAt || !decision.conclusion || !decision.selectedLicense || typeof decision.correspondingSourceRequired !== "boolean") issues.push(`Maintainer review pending: ${item.name}@${item.version} (${item.license}; ${item.distribution})`);
    else {
      const declared = item.license.match(/[A-Za-z0-9][A-Za-z0-9.+-]*/g);
      const validElection = decision.selectedLicense === item.license || (!declared.includes("AND") && declared.includes("OR") && declared.includes(decision.selectedLicense));
      if (!validElection) throw new Error(`Selected license is outside declared expression: ${item.name}`);
      if (decision.correspondingSourceRequired && !sourcePins.some(pin => pin.name === item.name && pin.version === item.version)) issues.push(`Approved source material pin missing: ${item.name}@${item.version}`);
    }
  }
}
for (const identifier of Object.keys(reviews.packages)) {
  if (!packages.some(item => `${item.name}@${item.version}` === identifier)) throw new Error(`Stale review: ${identifier}`);
}
const gapEvidence = JSON.parse(read("licenses/material-gaps.json"));
const pendingSummary = JSON.stringify({
  schemaVersion: 1,
  lockfileSha256: manifest.lockfileSha256,
  releaseReady: issues.length === 0,
  materialGaps: packages.filter(item => !item.texts.length).map(item => ({ name: item.name, version: item.version, license: item.license, usage: item.usage, distribution: item.distribution, evidence: gapEvidence.packages[`${item.name}@${item.version}`] ?? { requestedAction: "Obtain an attributable complete upstream license/NOTICE text." } })),
  maintainerReviews: packages.filter(item => issues.some(issue => issue.startsWith(`Maintainer review pending: ${item.name}@${item.version} (`))).map(item => ({ name: item.name, version: item.version, declaredLicense: item.license, usage: item.usage, distribution: item.distribution, status: "pending", requestedDecisions: item.name === "elkjs" ? ["Elect EPL-2.0 or GPL-3.0-or-later", "Confirm applicable source availability obligations", "Confirm exact ELK source and generator/build material mapping before approving source pins"] : ["Confirm the recorded build/test-only distribution scope", "Confirm applicable combination and source availability obligations"], scopeEvidence: reviews.packages[`${item.name}@${item.version}`]?.scopeEvidence })),
}, null, 2) + "\n";
if (check) {
  if (read("licenses/pending-review-summary.json") !== pendingSummary) throw new Error("Pending license review summary is stale; run npm run licenses:generate");
} else write("licenses/pending-review-summary.json", pendingSummary);
console.log(JSON.stringify({ packages: packages.length, embeddedComponents: embedded.components.length, classified: Object.fromEntries(["browser-js", "static-assets", "not-in-frontend-runtime"].map(scope => [scope, packages.filter(item => item.distribution === scope).length])), missingTexts: packages.filter(item => !item.texts.length).map(item => `${item.name}@${item.version}`), unresolvedReviews: [...new Set(issues.filter(issue => issue.startsWith("Maintainer review")))], releaseReady: issues.length === 0 }, null, 2));
if (release && issues.length) throw new Error(`Release license gate failed:\n${[...new Set(issues)].join("\n")}`);
if (bundleIndex !== -1) {
  const destination = args[bundleIndex + 1];
  if (!destination || destination.startsWith("--")) throw new Error("Usage: licenses:bundle <destination>");
  await bundle(destination, sourcePins);
}

function installedLicenseTexts(location, entry) {
  const directory = path.join(root, "frontend", location);
  if (!existsSync(directory)) return [];
  const metadata = JSON.parse(readFileSync(path.join(directory, "package.json"), "utf8"));
  if (metadata.version !== entry.version || metadata.license !== entry.license) throw new Error(`Installed dependency differs from lockfile: ${location}`);
  return readdirSync(directory).filter(file => /^(?:licen[sc]e|copying|notice|copyright|acknowledg(?:e)?ments?)(?:[.-]|$)/i.test(file) && statSync(path.join(directory, file)).isFile()).sort().map(file => {
    const contents = readFileSync(path.join(directory, file));
    const checksum = sha256(contents);
    const destination = `licenses/texts/npm/${checksum}.txt`;
    write(destination, contents);
    return { file: destination, sha256: checksum, source: `${location}/${file}` };
  });
}

function validateText(text, owner) {
  if (!/^licenses\/texts\/[\w./-]+$/.test(text.file) || text.file.includes("..") || !/^[a-f0-9]{64}$/.test(text.sha256)) throw new Error(`Invalid license reference: ${owner}`);
  const contents = readFileSync(path.join(root, text.file));
  if (!contents.length || sha256(contents) !== text.sha256) throw new Error(`License text checksum mismatch: ${owner} ${text.file}`);
  if (text.sourceURL && (!/^https:\/\//.test(text.sourceURL) || !/^[a-f0-9]{40}$/.test(text.sourceRevision))) throw new Error(`Supplemental text needs an immutable upstream source: ${owner}`);
}

function validateCopiedCode() {
  const registry = JSON.parse(read("frontend/packages/ui/ui.registry.json"));
  if (!registry.license || !registry.copyright || !read(registry.licenseFile).trim()) throw new Error("Copied UI code is missing license/copyright/text");
  if (typeof registry.sourceRepository !== "string" || !URL.canParse(registry.sourceRepository) || !registry.sourceRepository.startsWith("https://")) throw new Error("Copied UI source repository must be a valid HTTPS URL");
  if (registry.timestampUnit !== "unix-ms" ||
    typeof registry.timestampSemantics?.addedAt !== "string" || !registry.timestampSemantics.addedAt.trim() ||
    typeof registry.timestampSemantics?.updatedAt !== "string" || !registry.timestampSemantics.updatedAt.trim() ||
    typeof registry.sourceRevisionSemantics !== "string" || !registry.sourceRevisionSemantics.trim()) throw new Error("Copied UI provenance semantics are missing or unsupported");
  for (const [name, item] of Object.entries(registry.components)) {
    if (typeof item.source !== "string" || !URL.canParse(item.source) || !item.source.startsWith("https://") ||
      !/^[a-f0-9]{40}$/.test(item.sourceRevision ?? "") || item.sourceRevisionKind !== "reproducible-content" ||
      (item.servedRevision !== null && !/^[a-f0-9]{40}$/.test(item.servedRevision ?? "")) ||
      !/^sha256:[a-f0-9]{64}$/.test(item.sourceChecksum ?? "") || !item.modifications) throw new Error(`Copied UI source record is incomplete: ${name}`);
    if (!Number.isSafeInteger(item.addedAt) || item.addedAt <= 0 || !Number.isSafeInteger(item.updatedAt) || item.updatedAt < item.addedAt) throw new Error(`Copied UI timestamps must be ordered Unix milliseconds: ${name}`);
    const snapshot = read(`licenses/copied-code/shadcn-${name}.registry.json`);
    if (`sha256:${sha256(snapshot)}` !== item.sourceChecksum) throw new Error(`Copied UI source snapshot checksum mismatch: ${name}`);
  }
}

function noticeTable(items) {
  const unique = new Map();
  for (const item of items) {
    const key = `${item.name}@${item.version}`;
    const previous = unique.get(key);
    if (!previous) unique.set(key, { ...item, usage: [...item.usage] });
    else previous.usage = [...new Set([...previous.usage, ...item.usage])].sort();
  }
  const rows = [...unique.values()].sort((a, b) => `${a.name}@${a.version}`.localeCompare(`${b.name}@${b.version}`)).map(item => `| \`${item.name}\` | ${item.version} | ${item.license} | ${item.usage.join(", ")} | ${item.texts.length ? item.texts.map((text, index) => `[${index + 1}](${text.file})`).join(" ") : "Missing upstream text"} |`);
  return `<!-- npm-inventory:start -->\n## Locked npm components\n\nGenerated from the exact frontend lockfile. Runtime and asset entries are included in the frontend distribution; build-only and dev-only entries document the tools used to produce and verify it. Full texts retain their upstream copyright notices. Multiple scopes mean a package is reachable from more than one declared owner.\n\n| Component | Version | Declared license | Use | Text / copyright |\n| --- | --- | --- | --- | --- |\n${rows.join("\n")}\n<!-- npm-inventory:end -->`;
}

function syncAssetNotices() {
  const assets = [
    ["@fontsource-variable/inter", "inter-OFL-1.1.txt", "Inter Variable font files, unchanged"],
    ["lucide-react", "lucide-ISC.txt", "Lucide UI icon paths"],
    ["@gravity-ui/icons", "gravity-ui-MIT.txt", "Gravity UI icon paths"],
    ["@iconify-json/tabler", "tabler-MIT.txt", "Tabler 3.49.0 icons generated from Iconify JSON 1.2.42"],
    ["@remixicon/react", "remixicon-Apache-2.0.txt", "Remix Icon 4.6.0 UI icon paths"],
  ].map(([name, file, use]) => {
    const item = packages.find(item => item.name === name);
    if (!item?.texts.length) throw new Error(`Asset license text is missing: ${name}`);
    const text = item.texts.map(text => read(text.file)).join("\n\n");
    const destination = `frontend/public/licenses/${file}`;
    if (check) {
      if (read(destination) !== text) throw new Error(`Public asset notice is stale: ${file}`);
    } else write(destination, text);
    return { name, version: item.version, license: item.license, use, file, sha256: sha256(text) };
  });
  const index = JSON.stringify({ schemaVersion: 1, assets }, null, 2) + "\n";
  if (check) {
    if (read("frontend/public/licenses/index.json") !== index) throw new Error("Public asset license index is stale");
  } else write("frontend/public/licenses/index.json", index);
}

async function bundle(destination, pins) {
  const source = distributionSource(process.env.ORBIS_SOURCE_REVISION);
  const target = path.resolve(root, "frontend", destination);
  const outputRoot = path.resolve(root, "frontend", "dist");
  if (!target.startsWith(`${outputRoot}${path.sep}`)) throw new Error("License bundle destination must be below frontend/dist/");
  rmSync(target, { recursive: true, force: true });
  mkdirSync(target, { recursive: true });
  cpSync(path.join(root, "frontend/public/licenses"), target, { recursive: true });
  mkdirSync(path.join(target, "frontend/packages/ui"), { recursive: true });
  cpSync(path.join(root, "frontend/public/licenses"), path.join(target, "frontend/public/licenses"), { recursive: true });
  cpSync(path.join(root, "frontend/packages/ui/ui.registry.json"), path.join(target, "frontend/packages/ui/ui.registry.json"));
  for (const file of ["LICENSE", "THIRD_PARTY_NOTICES.md"]) cpSync(path.join(root, file), path.join(target, file));
  cpSync(path.join(root, "licenses"), path.join(target, "licenses"), { recursive: true });
  for (const pin of pins) {
    const response = await fetch(pin.sourceURL);
    if (!response.ok) throw new Error(`Corresponding-source download failed: ${pin.name} HTTP ${response.status}`);
    const contents = Buffer.from(await response.arrayBuffer());
    if (sha256(contents) !== pin.sourceSHA256) throw new Error(`Corresponding-source checksum mismatch: ${pin.name}`);
    writeFileSync(path.join(target, "licenses", "sources", pin.destination), contents);
  }
  writeLicenseBundleIndex(target, source);
  verifyLicenseBundle(target);
  console.log(`License bundle written to ${path.relative(root, target)}`);
}

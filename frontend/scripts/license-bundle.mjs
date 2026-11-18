import { createHash } from "node:crypto";
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { licenseReadiness, parseSourcePins } from "./license-core.mjs";

const sha256 = value => createHash("sha256").update(value).digest("hex");
const sourceRepository = "https://github.com/singous/orbis";

export function distributionSource(revision) {
  if (!/^[a-f0-9]{40}$/.test(revision ?? "")) throw new Error("Set ORBIS_SOURCE_REVISION to the full commit SHA published with this release");
  return { revision, url: `${sourceRepository}/tree/${revision}`, archiveURL: `${sourceRepository}/archive/${revision}.tar.gz` };
}

export function writeLicenseBundleIndex(directory, source) {
  const sourcePins = parseSourcePins(readFileSync(path.join(directory, "licenses/sources/packages.tsv"), "utf8"));
  const reviews = JSON.parse(readFileSync(path.join(directory, "licenses/reviews.json"), "utf8"));
  writeFileSync(path.join(directory, "index.html"), licensePage(source, sourcePins, reviews));
  const inventory = JSON.parse(readFileSync(path.join(directory, "licenses/npm-manifest.json"), "utf8"));
  const files = bundleFiles(directory).map(file => ({ file, sha256: sha256(readFileSync(path.join(directory, file))) }));
  writeFileSync(path.join(directory, "distribution.json"), JSON.stringify({ schemaVersion: 1, source, lockfileSha256: inventory.lockfileSha256, files }, null, 2) + "\n");
}

export function verifyLicenseBundle(directory) {
  const read = file => readFileSync(path.join(directory, file));
  const metadata = JSON.parse(read("distribution.json"));
  const source = distributionSource(metadata.source.revision);
  if (JSON.stringify(source) !== JSON.stringify(metadata.source)) throw new Error("Distribution source links do not match the release revision");
  const files = new Map(metadata.files.map(item => [item.file, item.sha256]));
  for (const file of bundleFiles(directory)) {
    if (files.get(file) !== sha256(read(file))) throw new Error(`Distribution license checksum mismatch: ${file}`);
    files.delete(file);
  }
  if (files.size) throw new Error(`Distribution license files missing: ${[...files.keys()].join(", ")}`);
  for (const file of ["LICENSE", "THIRD_PARTY_NOTICES.md", "index.html", "licenses/npm-manifest.json", "licenses/reviews.json", "licenses/sources/packages.tsv", "frontend/packages/ui/ui.registry.json"]) {
    if (!read(file).toString("utf8").trim()) throw new Error(`Distribution license file is empty: ${file}`);
  }
  const inventory = JSON.parse(read("licenses/npm-manifest.json"));
  const pending = JSON.parse(read("licenses/pending-review-summary.json"));
  const sourcePins = parseSourcePins(read("licenses/sources/packages.tsv").toString("utf8"));
  const readiness = licenseReadiness(inventory.packages, JSON.parse(read("licenses/reviews.json")), sourcePins);
  const readinessFields = ["inventoryComplete", "distributionReady", "distributionIssues", "toolingIssues"];
  if (!readiness.distributionReady || readinessFields.some(field => JSON.stringify(pending[field]) !== JSON.stringify(readiness[field])) || pending.releaseReady !== readiness.distributionReady || inventory.lockfileSha256 !== metadata.lockfileSha256 || pending.lockfileSha256 !== metadata.lockfileSha256) throw new Error("Distribution license readiness or lockfile identity differs from the release inventory");
  for (const item of [...inventory.packages, ...inventory.embeddedComponents]) {
    for (const text of item.texts ?? [item.text]) if (sha256(read(text.file)) !== text.sha256) throw new Error(`Distribution notice differs from inventory: ${text.file}`);
  }
  const assets = JSON.parse(read("index.json"));
  for (const asset of assets.assets) if (sha256(read(asset.file)) !== asset.sha256) throw new Error(`Distribution asset notice differs: ${asset.file}`);
  const page = read("index.html").toString("utf8");
  for (const pin of sourcePins) {
    if (sha256(read(`licenses/sources/${pin.destination}`)) !== pin.sourceSHA256) throw new Error(`Distribution corresponding source differs: ${pin.name}`);
    if (!page.includes(`href="licenses/sources/${pin.destination}"`)) throw new Error(`Public license page omits the corresponding source link: ${pin.name}`);
  }
  if (sourcePins.some(pin => pin.name === "elkjs") && (!read("licenses/sources/elkjs-build.md").toString("utf8").trim() || !page.includes('href="licenses/sources/elkjs-build.md"'))) throw new Error("Public ELK source build instructions are missing");
  for (const url of [source.url, source.archiveURL]) if (!page.includes(`href="${url}"`)) throw new Error("Public license page omits the release source link");
  return { files: metadata.files.length, packages: inventory.packages.length, sourceRevision: source.revision };
}

function bundleFiles(directory, prefix = "") {
  return readdirSync(path.join(directory, prefix), { withFileTypes: true }).flatMap(entry => {
    const file = prefix ? `${prefix}/${entry.name}` : entry.name;
    return entry.isDirectory() ? bundleFiles(directory, file) : file === "distribution.json" ? [] : [file];
  }).sort();
}

function licensePage(source, sourcePins, reviews) {
  const elk = sourcePins.find(pin => pin.name === "elkjs");
  const sourceSection = sourcePins.length ? `<h2>第三方源码获取</h2>
<ul>${sourcePins.map(pin => `<li><a href="licenses/sources/${pin.destination}">${pin.destination}</a> · <code>${pin.sourceRevision}</code></li>`).join("\n")}</ul>
${elk ? `<p>ELK 使用其声明允许的 ${reviews.packages[`${elk.name}@${elk.version}`].selectedLicense}。以上归档提供官方版本的可修改源码与构建材料；历史发布环境及逐字节重现未被确认。<a href="licenses/sources/elkjs-build.md">查看 ELK 构建说明与证据边界</a>。</p>` : ""}` : "";
  return `<!doctype html>
<html lang="zh-CN">
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>开源许可 · Orbis</title>
<style>body{max-width:52rem;margin:4rem auto;padding:0 1.5rem;font:16px/1.7 system-ui,sans-serif}a{text-underline-offset:.2em}li{margin:.75rem 0}code{overflow-wrap:anywhere}@media(prefers-color-scheme:dark){html{color-scheme:dark}}</style>
<main>
<h1>Orbis 开源许可</h1>
<p>Orbis 采用 GNU Affero General Public License v3.0。依赖库、字体、图标和引用代码保留各自的许可证与版权声明。</p>
<ul>
<li><a href="LICENSE">Orbis 许可证全文</a></li>
<li><a href="THIRD_PARTY_NOTICES.md">第三方版权与许可声明</a></li>
<li><a href="licenses/npm-manifest.json">依赖版本、用途与完整许可文本索引</a></li>
<li><a href="index.json">字体与图标许可索引</a></li>
<li><a href="licenses/sources/packages.tsv">第三方对应源码与校验值</a></li>
<li><a href="${source.url}">此版本的完整源码与构建材料</a> · <a href="${source.archiveURL}">下载源码归档</a></li>
</ul>
${sourceSection}
<p>源码版本：<code>${source.revision}</code></p>
<p><a href="/">返回 Orbis</a></p>
</main>
</html>
`;
}

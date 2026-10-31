import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { analyzeUI, newFindings, isProduction, findingCounts, applyColorDataAllowlist } from "./ui-architecture.mjs";

const root = fileURLToPath(new URL("../", import.meta.url));
const sources = new Map();
function collect(directory) {
  for (const entry of readdirSync(path.join(root, directory), { withFileTypes: true })) {
    const file = `${directory}/${entry.name}`;
    if (entry.isDirectory()) collect(file);
    else if (/\.(?:tsx?|css)$/.test(file)) sources.set(file, readFileSync(path.join(root, file), "utf8"));
  }
}
collect("src");
collect("packages/ui/src");
const manifest = JSON.parse(readFileSync(path.join(root, "packages/ui/package.json"), "utf8"));
const colorData = JSON.parse(readFileSync(path.join(root, "ui-color-data-allowlist.json"), "utf8"));
const findings = applyColorDataAllowlist(analyzeUI(sources, manifest.exports), colorData.entries);
const baseline = JSON.parse(readFileSync(path.join(root, "ui-migration-baseline.json"), "utf8"));
if (process.argv.includes("--prune")) {
  const current = findingCounts(findings);
  baseline.findings = Object.fromEntries(Object.entries(baseline.findings).filter(([key]) => current[key]).map(([key, count]) => [key, Math.min(count, current[key])]));
  writeFileSync(path.join(root, "ui-migration-baseline.json"), JSON.stringify(baseline, null, 2) + "\n");
}
const violations = newFindings(findings, baseline.findings);
const css = [...sources].filter(([file]) => file.endsWith(".css"));
console.log(JSON.stringify({
  productionModules: [...sources.keys()].filter(file => isProduction(file) && /\.tsx?$/.test(file)).length,
  heroUIFiles: new Set(findings.filter(item => item.rule === "legacy-heroui").map(item => item.file)).size,
  directFeatureUIFiles: new Set(findings.filter(item => ["legacy-heroui", "icon-boundary", "primitive-boundary", "foreign-primitive"].includes(item.rule) && item.file.startsWith("src/features/")).map(item => item.file)).size,
  cssFiles: css.length,
  cssLines: css.reduce((sum, [, text]) => sum + text.trimEnd().split("\n").length, 0),
  rawColors: findings.filter(item => item.rule === "raw-color").length,
  newViolations: violations.length,
}, null, 2));
if (!process.argv.includes("--report") && violations.length) {
  console.error(violations.join("\n"));
  process.exitCode = 1;
}

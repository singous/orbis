import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { bundleReport, budgetViolations, bundleBudgetPolicy } from "./bundle-report.mjs";

const baseline = JSON.parse(readFileSync(new URL("../ui-bundle-baseline.json", import.meta.url), "utf8"));
const original = { manifestText: readFileSync(new URL("../benchmarks/ui-original/manifest.json", import.meta.url), "utf8"), artifacts: JSON.parse(readFileSync(new URL("../benchmarks/ui-original/artifacts.json", import.meta.url), "utf8")) };
const policy = bundleBudgetPolicy(JSON.parse(readFileSync(new URL("../ui-bundle-entry-groups.json", import.meta.url), "utf8")), baseline, original);
const report = bundleReport(fileURLToPath(new URL("../dist", import.meta.url)), policy);
console.log(JSON.stringify({ baselineRef: baseline.ref, baselineLoadGzipBytes: policy.baselineLoadGzipBytes, baselineContextLoadGzipBytes: policy.baselineContextLoadGzipBytes, loadContexts: policy.loadContexts, ...report }, null, 2));
const violations = budgetViolations(report, baseline.report, { policy });
if (violations.length) console.warn(violations.join("\n"));
const manifest = JSON.parse(readFileSync(new URL("../dist/.vite/manifest.json", import.meta.url), "utf8"));
const developmentEntries = Object.keys(manifest).filter(key => key.startsWith("src/app/catalog/") || /\.stories\.tsx?$/.test(key));
for (const key of developmentEntries) console.error(`Development-only entry leaked into production: ${key}`);
if (developmentEntries.length) process.exitCode = 1;

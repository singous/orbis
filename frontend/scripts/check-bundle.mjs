import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { bundleReport, budgetViolations, bundleBudgetPolicy } from "./bundle-report.mjs";

const baseline = JSON.parse(readFileSync(new URL("../ui-bundle-baseline.json", import.meta.url), "utf8"));
const original = { manifestText: readFileSync(new URL("../benchmarks/ui-original/manifest.json", import.meta.url), "utf8"), artifacts: JSON.parse(readFileSync(new URL("../benchmarks/ui-original/artifacts.json", import.meta.url), "utf8")) };
const policy = bundleBudgetPolicy(JSON.parse(readFileSync(new URL("../ui-bundle-entry-groups.json", import.meta.url), "utf8")), baseline, original);
const report = bundleReport(fileURLToPath(new URL("../dist", import.meta.url)), policy);
console.log(JSON.stringify({ baselineRef: baseline.ref, baselineLoadGzipBytes: policy.baselineLoadGzipBytes, baselineContextLoadGzipBytes: policy.baselineContextLoadGzipBytes, loadContexts: policy.loadContexts, ...report }, null, 2));
const violations = budgetViolations(report, baseline.report, { policy });
const manifest = JSON.parse(readFileSync(new URL("../dist/.vite/manifest.json", import.meta.url), "utf8"));
for (const key of Object.keys(manifest)) if (key.startsWith("src/app/catalog/") || /\.stories\.tsx?$/.test(key)) violations.push(`Development-only entry leaked into production: ${key}`);
if (process.argv.includes("--complete") && report.totalGzipBytes >= baseline.report.totalGzipBytes) violations.push(`Completed migration manifest JS must be smaller than the baseline: ${report.totalGzipBytes} >= ${baseline.report.totalGzipBytes}`);
if (violations.length) { console.error(violations.join("\n")); process.exitCode = 1; }

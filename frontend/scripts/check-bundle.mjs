import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { bundleReport, budgetViolations } from "./bundle-report.mjs";

const report = bundleReport(fileURLToPath(new URL("../dist", import.meta.url)));
const baseline = JSON.parse(readFileSync(new URL("../ui-bundle-baseline.json", import.meta.url), "utf8"));
console.log(JSON.stringify({ baselineRef: baseline.ref, ...report }, null, 2));
const violations = budgetViolations(report, baseline.report);
if (process.argv.includes("--complete") && report.totalGzipBytes >= baseline.report.totalGzipBytes) violations.push(`Completed migration total JS must be smaller than the baseline: ${report.totalGzipBytes} >= ${baseline.report.totalGzipBytes}`);
if (violations.length) { console.error(violations.join("\n")); process.exitCode = 1; }

import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { analyzeArchitecture } from "./frontend-architecture.mjs";

const root = fileURLToPath(new URL("../src/", import.meta.url));
const sources = new Map();
function collect(directory) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const file = path.join(directory, entry.name);
    if (entry.isDirectory()) collect(file);
    else if (/\.tsx?$/.test(entry.name)) sources.set(path.relative(root, file).split(path.sep).join("/"), readFileSync(file, "utf8"));
  }
}
collect(root);
const result = analyzeArchitecture(sources);
if (result.violations.length) {
  console.error(result.violations.join("\n"));
  process.exitCode = 1;
} else console.log(`Frontend architecture: ${result.files} production modules checked.`);

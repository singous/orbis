import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";

const root = fileURLToPath(new URL("../../", import.meta.url));
const check = process.argv.includes("--check");
const frontendOnly = process.argv.includes("--frontend-only");
const read = (path) => readFile(resolve(root, path), "utf8");
const artwork = async (name) => (await read(`frontend/public/brand/orbis-${name}.svg`)).match(/<g\b[\s\S]*<\/g>/)[0];
const mark = await artwork("mark");
const wordmark = await artwork("wordmark");
// Lockup proportions and clear space follow the supplied brand reference.
const horizontal = `${mark}<g transform="translate(430 100.7) scale(1.3)">${wordmark}</g>`;
const stacked = `<g transform="translate(60)">${mark}</g><g transform="translate(21 410)">${wordmark}</g>`;
const svg = (width, height, body, color = "#111111") => `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" color="${color}"><title>Orbis</title>\n${body}\n</svg>\n`;
const outputs = new Map();
for (const [name, width, height, body] of [["mark", 360, 360, mark], ["horizontal", 1000, 360, horizontal], ["stacked", 480, 560, stacked]]) {
  if (name !== "mark") outputs.set(`frontend/public/brand/orbis-${name}.svg`, svg(width, height, body));
  outputs.set(`frontend/public/brand/orbis-${name}-inverse.svg`, svg(width, height, body, "#ffffff"));
}
outputs.set("frontend/public/favicon.svg", svg(360, 360, `<style>@media (prefers-color-scheme:dark){svg{color:#fff}}</style>${mark}`));
outputs.set("frontend/public/brand/orbis-app-icon.svg", svg(512, 512, `<rect width="512" height="512" rx="96" fill="#111111"/><g transform="translate(76 76)">${mark}</g>`, "#ffffff"));
if (!frontendOnly) {
  outputs.set("docs/intro/assets/readme/social-preview.svg", svg(1280, 640, `<rect width="1280" height="640" fill="#fafafa"/><rect x="24" y="24" width="1232" height="592" rx="24" fill="none" stroke="#e5e5e5"/><g transform="translate(400 40)">${stacked}</g>`));
  // Inline the same artwork for standalone server-rendered pages.
  outputs.set("internal/publishing/reader/brand.svg", svg(360, 360, mark).replace('color="#111111"', 'aria-hidden="true" focusable="false"'));

  for (const theme of ["light", "dark"]) {
    const path = `docs/intro/assets/readme/hero-${theme}.svg`;
    const source = await read(path);
    const region = /  <!-- orbis-brand:start -->[\s\S]*?  <!-- orbis-brand:end -->\n/;
    if (!region.test(source)) throw new Error(`Missing brand region in ${path}`);
    const brand = `  <!-- orbis-brand:start -->\n  <g color="${theme === "dark" ? "#ffffff" : "#111111"}" transform="translate(60 55) scale(.18)">${horizontal}</g>\n  <!-- orbis-brand:end -->\n`;
    outputs.set(path, source.replace(region, brand));
  }
}

let stale = false;
for (const [path, content] of outputs) {
  if (check) {
    if (await read(path).catch(() => "") !== content) { console.error(`Brand asset is out of date: ${path}`); stale = true; }
  } else await writeFile(resolve(root, path), content);
}
if (stale) process.exitCode = 1;

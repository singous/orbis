import { chromium } from "@playwright/test";
import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";

const root = fileURLToPath(new URL("../../", import.meta.url));
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ deviceScaleFactor: 1 });
async function render(path, width, height) {
  const source = await readFile(resolve(root, path), "utf8");
  await page.setViewportSize({ width, height });
  await page.setContent(`<style>html,body{margin:0;background:transparent}svg{display:block;width:100%;height:100%}</style>${source}`);
  return page.screenshot({ omitBackground: true });
}
async function png(source, target, width, height = width) {
  await writeFile(resolve(root, target), await render(source, width, height));
}
try {
  for (const [name, width, height] of [["mark", 512, 512], ["horizontal", 1000, 360], ["stacked", 480, 560]]) {
    for (const suffix of ["", "-inverse"]) {
      const path = `frontend/public/brand/orbis-${name}${suffix}`;
      await png(`${path}.svg`, `${path}.png`, width, height);
    }
  }
  for (const size of [192, 512]) await png("frontend/public/brand/orbis-app-icon.svg", `frontend/public/brand/orbis-app-${size}.png`, size);
  await png("frontend/public/brand/orbis-app-icon.svg", "frontend/public/apple-touch-icon.png", 180);
  await png("docs/intro/assets/readme/social-preview.svg", "docs/intro/assets/readme/social-preview.png", 1280, 640);

  // ICO frames contain PNG data, preserving transparency at each native size.
  const sizes = [16, 32, 48];
  const frames = [];
  for (const size of sizes) frames.push(await render("frontend/public/brand/orbis-mark.svg", size, size));
  const header = Buffer.alloc(6 + sizes.length * 16);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(sizes.length, 4);
  let offset = header.length;
  frames.forEach((frame, index) => {
    const entry = 6 + index * 16;
    header[entry] = sizes[index];
    header[entry + 1] = sizes[index];
    header.writeUInt16LE(1, entry + 4);
    header.writeUInt16LE(32, entry + 6);
    header.writeUInt32LE(frame.length, entry + 8);
    header.writeUInt32LE(offset, entry + 12);
    offset += frame.length;
  });
  await writeFile(resolve(root, "frontend/public/favicon.ico"), Buffer.concat([header, ...frames]));
} finally {
  await browser.close();
}

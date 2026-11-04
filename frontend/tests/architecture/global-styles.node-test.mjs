import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { analyzeUI, applyGlobalStylesPolicy } from "../../scripts/ui-architecture.mjs";

const globalFile = "src/styles/globals.css";
const motionFile = "src/styles/motion.css";
const scrollbarFile = "src/styles/scrollbars.css";
const tokenFile = "src/styles/brand-tokens.css";
const accessibilityFile = "packages/ui/src/styles/accessibility.css";
function actualSources() {
  const sources = new Map([globalFile, motionFile, scrollbarFile, tokenFile, accessibilityFile].map(file => [file, readFileSync(new URL(`../../${file}`, import.meta.url), "utf8")]));
  sources.set("src/main.tsx", 'import "./styles/globals.css";');
  return sources;
}
const inspect = sources => applyGlobalStylesPolicy(analyzeUI(sources, {}), sources);

test("admits the actual global files through the one canonical application entry without legacy exceptions", () => {
  assert.deepEqual(inspect(actualSources()), []);
});

test("rejects ordinary business selectors at the root and inside the declared layout layer", () => {
  for (const selector of [".toolbar", ".workspace-resizing *", 'body[data-mode="a,b"] .toolbar']) {
    const sources = actualSources();
    sources.set(globalFile, sources.get(globalFile) + `\n${selector} { padding: 1rem; } @layer base { ${selector} { font-size: 1rem; } }`);
    assert.deepEqual(inspect(sources).filter(item => item.rule === "global-style-selector").map(item => item.detail), [selector, selector]);
  }
});

test("keeps application layout and shared accessibility policies inside their declared layers", () => {
  const sources = actualSources();
  sources.set(globalFile, sources.get(globalFile) + '\n@layer base { body { display: grid; } } @layer utilities { body { font-size: 1rem; } } @media (hover: hover) { * { box-sizing: border-box; } }');
  sources.set(accessibilityFile, sources.get(accessibilityFile) + '\n@layer utilities { @media (prefers-reduced-motion: reduce) { * { padding: 1rem; } } }');
  assert.ok(inspect(sources).some(item => item.rule === "global-style-property" && item.detail === "body: display"));
  assert.ok(inspect(sources).some(item => item.rule === "global-style-selector" && item.detail === "body"));
  assert.ok(inspect(sources).some(item => item.rule === "global-style-rule" && item.detail === "@media (hover: hover)"));
  assert.ok(inspect(sources).some(item => item.rule === "global-style-property" && item.detail === "*: padding"));
});

test("does not split functional selector commas or confuse media blocks with their child rules", () => {
  const sources = actualSources();
  sources.set(accessibilityFile, sources.get(accessibilityFile) + '\n@layer utilities { @media (forced-colors: active) { :is(button,input,textarea,a,[tabindex]):focus-visible { outline-color: Highlight; } } }');
  sources.set(scrollbarFile, sources.get(scrollbarFile) + '\n@layer base { :is(html,body):has(.site-reader:is([data-theme="light"],[data-theme="dark"])) { --ob-scrollbar-ink: CanvasText; } }');
  assert.deepEqual(inspect(sources), []);
});

test("admits only animation variables and keyframe opacity/transform in motion CSS", () => {
  const sources = actualSources();
  sources.set(motionFile, '@theme { --animate-ob-demo: demo 200ms linear; @keyframes demo { 0%, 100% { opacity: 1; transform: none; } } }');
  assert.deepEqual(inspect(sources), []);
  sources.set(motionFile, sources.get(motionFile) + '\n.toolbar { display: flex; } @theme { --toolbar-padding: 1rem; .toolbar { padding: 1rem; } @keyframes demo { to { display: none; } } }');
  const findings = inspect(sources);
  assert.equal(findings.filter(item => item.rule === "global-style-selector" && item.detail === ".toolbar").length, 2);
  assert.ok(findings.some(item => item.rule === "global-style-declaration" && item.detail === "--toolbar-padding: 1rem"));
  assert.ok(findings.some(item => item.rule === "global-style-property" && item.detail === "to: display"));
});

test("scrollbar opt-outs and reader schemes do not authorize ordinary chrome properties or selectors", () => {
  const sources = actualSources();
  sources.set(scrollbarFile, sources.get(scrollbarFile) + '\n.toolbar { scrollbar-width: thin; } @layer base { :where(html, body, body *) { padding: 1rem; } }');
  assert.ok(inspect(sources).some(item => item.rule === "global-style-selector" && item.detail === ".toolbar"));
  assert.ok(inspect(sources).some(item => item.rule === "global-style-property" && item.detail === ":where(html, body, body *): padding"));
});

test("the imported brand file can define roles but cannot carry ordinary component styling", () => {
  const sources = actualSources();
  sources.set(tokenFile, sources.get(tokenFile) + '\n.toolbar { --ob-toolbar-role: inherit; padding: 1rem; }');
  assert.ok(inspect(sources).some(item => item.rule === "global-style-property" && item.detail === ".toolbar: padding"));
});

test("bounds the six global imports and Tailwind sources without accepting unrelated files or globs", () => {
  const sources = actualSources();
  sources.set(globalFile, sources.get(globalFile) + '\n@import "./page.css"; @import "./motion.css"; @source "../../features";');
  const findings = inspect(sources);
  assert.ok(findings.some(item => item.rule === "global-style-import" && item.detail === "./page.css: expected 0, found 1"));
  assert.ok(findings.some(item => item.rule === "global-style-import" && item.detail === "./motion.css: expected 1, found 2"));
  assert.ok(findings.some(item => item.rule === "global-style-source" && item.detail === "../../features: expected 0, found 1"));
});

test("requires one main entry and rejects borrowing global files from features or other CSS", () => {
  const sources = actualSources();
  sources.set("src/main.tsx", 'import "./styles/globals.css"; import "./styles/globals.css";');
  sources.set("src/features/home/Page.tsx", 'import "../../styles/motion.css"; import "@/styles/globals.css";');
  sources.set("src/features/home/page.css", '@import "../../styles/scrollbars.css";');
  const findings = inspect(sources);
  assert.equal(findings.filter(item => item.rule === "global-style-owner").length, 3);
  assert.ok(findings.some(item => item.rule === "global-style-entry" && item.detail.endsWith("found 2")));
  assert.equal(findings.filter(item => item.file === "src/main.tsx" && item.rule === "css-import").length, 1);
  sources.set("src/main.tsx", 'import "./styles/index.css";');
  assert.ok(inspect(sources).some(item => item.rule === "global-style-entry" && item.detail.endsWith("found 0")));
});

test("quoted content and comments are not global stylesheet imports", () => {
  const sources = actualSources();
  sources.set("src/features/home/widget.css", '.widget::before { content: \'@import "../../styles/globals.css"\'; } /* @import "../../styles/motion.css"; */');
  assert.deepEqual(inspect(sources), []);
});

test("global files reject the retired token bridge rather than silently depending on it", () => {
  const sources = actualSources();
  sources.set(globalFile, sources.get(globalFile) + '\nbody { color: var(--text-primary); }');
  assert.ok(inspect(sources).some(item => item.rule === "global-style-token" && item.detail === "var(--text-primary"));
});

test("global semantic roles use native theme tokens while palette sources stay in their brand owner", () => {
  const sources = actualSources();
  sources.set(tokenFile, sources.get(tokenFile) + '\n:root { --status-success: var(--color-green-600); --destructive-soft: color-mix(in oklab, var(--destructive) 10%, transparent); } @theme inline { --color-status-success: var(--status-success); }');
  assert.deepEqual(inspect(sources), []);
  sources.set(globalFile, sources.get(globalFile) + '\nbody { color: var(--color-green-600); background: var(--unowned-role, transparent); }');
  assert.deepEqual(inspect(sources).filter(item => item.rule === "global-style-token").map(item => item.detail), ["var(--color-green-600", "var(--unowned-role"]);
  sources.set(tokenFile, sources.get(tokenFile) + '\n:root { --arbitrary-control-color: inherit; } @theme inline { --color-arbitrary-control: inherit; }');
  assert.ok(inspect(sources).some(item => item.rule === "global-style-property" && item.detail === ":root: --arbitrary-control-color"));
  assert.ok(inspect(sources).some(item => item.rule === "global-style-declaration" && item.detail === "--color-arbitrary-control: inherit"));
  sources.set(tokenFile, sources.get(tokenFile) + '\n:root { --primary: inherit; } @theme inline { --color-primary: var(--primary); }');
  assert.ok(inspect(sources).some(item => item.rule === "global-style-property" && item.detail === ":root: --primary"));
  assert.ok(inspect(sources).some(item => item.rule === "global-style-declaration" && item.detail === "--color-primary: var(--primary)"));
});

test("native package CSS has explicit source imports and cannot borrow unowned styles", () => {
  const sources = actualSources();
  for (const file of ["packages/ui/src/styles/styles.css", "packages/ui/src/styles/tokens.css", "packages/ui/src/styles/utilities.css", "packages/ui/src/color-picker/styles.css"]) sources.set(file, readFileSync(new URL(`../../${file}`, import.meta.url), "utf8"));
  assert.deepEqual(inspect(sources), []);
  const file = "packages/ui/src/styles/styles.css";
  sources.set(file, sources.get(file) + '\n@import "./unknown.css"; @import "./tokens.css";');
  assert.deepEqual(inspect(sources).filter(item => item.rule === "css-import").map(item => item.detail), ["./unknown.css", "./tokens.css"]);
  sources.set("src/features/home/page.css", '@import "./unowned-controls.css"; @import "@orbis/ui/styles.css";');
  assert.deepEqual(inspect(sources).filter(item => item.rule === "css-import" && item.file.startsWith("src/features/")).map(item => item.detail), ["./unowned-controls.css", "@orbis/ui/styles.css"]);
});

test("prevents unlayered focus fallbacks and preserves explicit utility override order", () => {
  const sources = actualSources();
  sources.set(globalFile, sources.get(globalFile) + '\n:where(button,input):focus-visible { outline: 2px solid var(--ring); }');
  assert.ok(inspect(sources).some(item => item.rule === "global-style-selector"));
  const actual = actualSources();
  actual.set(globalFile, actual.get(globalFile).replace('@import "@orbis/ui/styles.css";\n@import "tailwindcss";', '@import "tailwindcss";\n@import "@orbis/ui/styles.css";'));
  assert.ok(inspect(actual).some(item => item.rule === "global-style-import-order"));
  const story = readFileSync(new URL("../../packages/ui/.storybook/styles.css", import.meta.url), "utf8");
  assert.ok(story.indexOf('@import "../src/styles/styles.css"') < story.indexOf('@import "tailwindcss"'));
});

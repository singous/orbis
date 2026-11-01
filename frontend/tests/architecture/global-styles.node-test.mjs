import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { analyzeUI, applyGlobalStylesPolicy } from "../../scripts/ui-architecture.mjs";

const globalFile = "src/styles/globals.css";
const motionFile = "src/styles/motion.css";
const scrollbarFile = "src/styles/scrollbars.css";
const tokenFile = "src/styles/brand-tokens.css";
function actualSources() {
  const sources = new Map([globalFile, motionFile, scrollbarFile, tokenFile].map(file => [file, readFileSync(new URL(`../../${file}`, import.meta.url), "utf8")]));
  sources.set("src/main.tsx", 'import "./styles/globals.css";');
  return sources;
}
const inspect = sources => applyGlobalStylesPolicy(analyzeUI(sources, {}), sources);

test("admits the actual global files through the one canonical application entry without legacy exceptions", () => {
  assert.deepEqual(inspect(actualSources()), []);
});

test("rejects ordinary business selectors at the root and under the allowed global media wrappers", () => {
  for (const selector of [".toolbar", ".workspace-resizing *", 'body[data-mode="a,b"] .toolbar']) {
    const sources = actualSources();
    sources.set(globalFile, sources.get(globalFile) + `\n${selector} { padding: 1rem; } @media (pointer: coarse) { ${selector} { font-size: 1rem; } }`);
    assert.deepEqual(inspect(sources).filter(item => item.rule === "global-style-selector").map(item => item.detail), [selector, selector]);
  }
});

test("keeps base, reduced-motion and coarse-field rules in their declared context and property boundary", () => {
  const sources = actualSources();
  sources.set(globalFile, sources.get(globalFile) + '\nbody { display: grid; } @media (pointer: coarse) { body { font-size: 1rem; } } @media (hover: hover) { * { box-sizing: border-box; } }');
  assert.ok(inspect(sources).some(item => item.rule === "global-style-property" && item.detail === "body: display"));
  assert.ok(inspect(sources).some(item => item.rule === "global-style-selector" && item.detail === "body"));
  assert.ok(inspect(sources).some(item => item.rule === "global-style-rule" && item.detail === "@media (hover: hover)"));
});

test("does not split functional selector commas or confuse media blocks with their child rules", () => {
  const sources = actualSources();
  sources.set(globalFile, sources.get(globalFile) + '\n@media (pointer: coarse) { :is(input,textarea):not(.editor-title) { font-size: var(--ob-text-section-size); } }');
  sources.set(scrollbarFile, sources.get(scrollbarFile) + '\n:is(html,body):has(.site-reader:is([data-theme="light"],[data-theme="dark"])) { --ob-scrollbar-ink: CanvasText; }');
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
  sources.set(scrollbarFile, sources.get(scrollbarFile) + '\n.toolbar { scrollbar-width: thin; } :where(html, body, body *) { padding: 1rem; }');
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

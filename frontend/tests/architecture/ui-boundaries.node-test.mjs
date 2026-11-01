import { test } from "node:test";
import assert from "node:assert/strict";
import { analyzeUI, findingCounts, newFindings, applyColorDataAllowlist, applyDomainStylesAllowlist } from "../../scripts/ui-architecture.mjs";

const inspect = (file, text) => analyzeUI(new Map([[file, text]]), {});
test("detects primitive and internal imports through static, lazy, type and re-export paths", () => {
  const findings = inspect("src/features/home/Page.tsx", `
    import { Button } from '@base-ui/react/button';
    export { Dialog } from '@orbis/ui/src/dialog';
    const icons = import('lucide-react');
    type Props = import('@base-ui/react/dialog').Props;
    import { cn } from '../../../packages/ui/src/cn';
  `);
  assert.equal(findings.filter(item => item.rule === "primitive-boundary").length, 2);
  assert.equal(findings.filter(item => item.rule === "private-import").length, 2);
  assert.equal(findings.filter(item => item.rule === "icon-boundary").length, 1);
});
test("does not interpret comments and strings as imports", () => {
  assert.deepEqual(inspect("src/features/home/Page.tsx", `// import x from '@base-ui/react';\nconst text = "import('lucide-react')";`), []);
});
test("package cannot reach application state through relative or alias paths", () => {
  assert.equal(inspect("packages/ui/src/button/index.tsx", `import x from '../../../../src/shared/state'; import y from '@/features/home';`).filter(item => item.rule === "package-boundary").length, 2);
});
test("frozen exceptions do not authorize new imports in an existing legacy file", () => {
  const old = inspect("src/features/home/Page.tsx", `import { Button } from '@heroui/react/button';`);
  const next = inspect("src/features/home/Page.tsx", `import { Button } from '@heroui/react/button'; import { Modal } from '@heroui/react/modal';`);
  assert.equal(newFindings(next, findingCounts(old)).length, 1);
  assert.equal(newFindings([], findingCounts(old)).length, 0);
});
test("checks public subpaths, target files and stories", () => {
  const findings = analyzeUI(new Map([["packages/ui/src/button/index.tsx", "export function Button() {}"]]), { ".": "./src/index.ts", "./input": "./src/input/index.tsx" });
  for (const rule of ["root-barrel", "missing-export", "missing-target", "missing-story", "unused-component"]) assert.ok(findings.some(item => item.rule === rule));
});

test("permits primitive positioning geometry but rejects foreign theme variables", () => {
  const findings = inspect("packages/ui/src/popover/index.tsx", 'const style = "var(--available-width) var(--anchor-width) var(--accent)";');
  assert.deepEqual(findings.filter(item => item.rule === "foreign-token").map(item => item.detail), ["var(--accent)"]);
});

test("color-data exceptions are exact, attributed and occurrence-bounded", () => {
  const findings = inspect("src/shared/ui/ColorField.tsx", 'const fallback = "#000000"; const chrome = "#000000"; const other = "#ffffff";');
  const filtered = applyColorDataAllowlist(findings, [{ file: "src/shared/ui/ColorField.tsx", detail: "#000000", maxOccurrences: 1, reason: "User color fallback" }]);
  assert.deepEqual(filtered.map(item => item.detail), ["#000000", "#ffffff"]);
  assert.equal(applyColorDataAllowlist(inspect("src/features/home/Page.tsx", 'const color = "#000000";'), [{ file: "src/shared/ui/ColorField.tsx", detail: "#000000", maxOccurrences: 1, reason: "User color fallback" }]).length, 1);
});

test("CSS HeroUI imports and direct color-picker dependencies cannot bypass the boundary", () => {
  for (const source of ['@import "@heroui/styles";', '@import url("@heroui/styles");', '@import url(@heroui/styles);']) assert.equal(inspect("src/styles/index.css", source).filter(item => item.rule === "legacy-heroui").length, 1);
  assert.deepEqual(inspect("src/styles/index.css", '/* @import "@heroui/styles"; */'), []);
  assert.equal(inspect("src/features/boards/Panel.tsx", 'import { HexColorPicker } from "react-colorful";').filter(item => item.rule === "primitive-boundary").length, 1);
  assert.equal(inspect("packages/ui/src/color-picker/index.tsx", 'import { HexColorPicker } from "react-colorful";').filter(item => item.rule === "primitive-boundary").length, 0);
});

test("domain stylesheet imports need exact ownership and a documented content scope", () => {
  const entries = [{ file: "src/main.tsx", detail: "./styles/document-prose.css", maxOccurrences: 1, scope: ".document-prose", reason: "Authored document typography" }];
  const sources = new Map([["src/styles/document-prose.css", ".document-prose { color: inherit; } @media (max-width: 640px) { .document-prose p, .document-prose h2 { margin: 0; } }"]]);
  const findings = inspect("src/main.tsx", 'import "./styles/document-prose.css"; import "./styles/document-prose.css"; import "./styles/page.css";');
  assert.deepEqual(applyDomainStylesAllowlist(findings, entries, sources).map(item => item.detail), ["./styles/document-prose.css", "./styles/page.css"]);
  assert.equal(applyDomainStylesAllowlist(inspect("src/features/home/Page.tsx", 'import "./styles/document-prose.css";'), entries, sources).length, 1);
  assert.throws(() => applyDomainStylesAllowlist(findings, [{ ...entries[0], scope: undefined }], sources), /Invalid domain stylesheet/);
  sources.set("src/styles/document-prose.css", ".document-prose h2, .site-page { margin: 0; } .document-prose-other { padding: 0; }");
  assert.deepEqual(applyDomainStylesAllowlist([], entries, sources).map(item => item.detail), [".site-page", ".document-prose-other"]);
});

test("reader prose and local theme exceptions cannot admit ordinary chrome rules", () => {
  const entry = { file: "src/Reader.tsx", detail: "./reader.css", maxOccurrences: 1, scope: ".reader", reason: "Reader content", contentScope: ".document-prose" };
  const sources = new Map([["src/reader.css", ":where(.reader) .document-prose h3 { margin: 0; } .reader .toolbar { padding: 1rem; }"]]);
  assert.deepEqual(applyDomainStylesAllowlist([], [entry], sources).map(item => item.detail), [".reader .toolbar"]);
  sources.set("src/reader.css", ".reader { --ob-reader-background: var(--ob-surface); padding: 1rem; } @media (max-width: 800px) { .reader { --ob-reader-height: 62px; } }");
  assert.deepEqual(applyDomainStylesAllowlist([], [{ ...entry, contentScope: undefined, variablesOnly: true }], sources).map(item => item.detail), ["padding"]);
});

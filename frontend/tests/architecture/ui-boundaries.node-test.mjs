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

test("permits native theme roles, positioning geometry and locally owned values but rejects unrelated theme variables", () => {
  const findings = inspect("packages/ui/src/popover/index.tsx", 'const style = "var(--available-width) var(--anchor-width) var(--accent) var(--primary) var(--status-success) var(--toast-height) var(--local-width) var(--unowned-accent)"; const measured = "--local-width: 1rem";');
  assert.deepEqual(findings.filter(item => item.rule === "foreign-token").map(item => item.detail), ["var(--unowned-accent)"]);
});

test("retired shared UI modules are rejected even with no remaining consumer", () => {
  for (const name of ["Button", "ActionButton", "IconButton", "TextInput", "SelectField", "Tag", "Dialog", "Tooltip"]) {
    const file = `src/shared/ui/${name}.tsx`;
    assert.deepEqual(inspect(file, `export const ${name} = () => null;`).filter(item => item.rule === "legacy-ui-definition"), [{ file, rule: "legacy-ui-definition", detail: `src/shared/ui/${name}` }]);
  }
  assert.deepEqual(inspect("src/features/content/codecs/legacy-blocks.ts", "export const legacy = true;"), []);
});

test("retired UI imports include relative, alias, lazy, type and re-export forms", () => {
  const findings = inspect("src/features/home/Page.tsx", `
    import { Button } from '@/shared/ui/Button';
    export { Dialog } from '../../shared/ui/Dialog.tsx';
    const load = import('@/shared/ui/Tooltip/index');
    type Props = import('../../shared/ui/TextInput').Props;
    const select = require('@/shared/ui/SelectField');
    // import '@/shared/ui/Tag';
    const example = "import('@/shared/ui/IconButton')";
  `);
  assert.equal(findings.filter(item => item.rule === "legacy-ui-import").length, 5);
  assert.deepEqual(inspect("src/features/home/Page.tsx", 'import { DraftActions } from "@/shared/ui/DraftActions";'), []);
});

test("retired native props follow named aliases and namespace imports rather than prop spelling in business code", () => {
  const findings = inspect("src/features/home/Page.tsx", `
    import { Button as SaveButton } from '@orbis/ui/button';
    import * as Choice from '@orbis/ui/select';
    import { Badge } from '@orbis/ui/badge';
    const example = <><SaveButton loading variant="primary" size="md" asChild /><Choice.Select label="范围" options={[]} /><Badge tone="success" /></>;
    const business = <ReadStatus appearance="reader" loading={query.isPending} />;
    function Local(SaveButton: any) { return <SaveButton loading />; }
  `);
  assert.deepEqual(findings.filter(item => item.rule === "retired-native-prop").map(item => item.detail), ["Button.loading", "Button.variant=primary", "Button.size=md", "Button.asChild", "Select.label", "Select.options", "Badge.tone"]);
});

test("native render, events and upstream prop types remain part of the public API", () => {
  const findings = inspect("src/features/home/Page.tsx", `
    import { Button } from '@orbis/ui/button';
    import { DialogTrigger } from '@orbis/ui/dialog';
    import { Spinner } from '@orbis/ui/spinner';
    import type { ComponentProps } from 'react';
    type Props = ComponentProps<typeof Button>;
    const example = <><DialogTrigger render={<Button onClick={() => {}} />} /><Button disabled focusableWhenDisabled aria-busy /><Spinner color="currentColor" /></>;
  `);
  assert.equal(findings.filter(item => item.rule === "retired-native-prop").length, 0);
  assert.equal(inspect("packages/ui/src/button/index.tsx", 'import { Button as Primitive } from "@base-ui/react/button"; import { X } from "lucide-react"; type Props = Primitive.Props;').filter(item => ["primitive-boundary", "icon-boundary"].includes(item.rule)).length, 0);
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
  sources.set("src/reader.css", '.reader[data-theme="dark"] .document-prose .callout { background: var(--ob-surface); } .reader[data-theme="dark"] .toolbar { padding: 1rem; }');
  assert.deepEqual(applyDomainStylesAllowlist([], [entry], sources).map(item => item.detail), ['.reader[data-theme="dark"] .toolbar']);
  sources.set("src/reader.css", ".reader { --ob-reader-background: var(--ob-surface); padding: 1rem; } @media (max-width: 800px) { .reader { --ob-reader-height: 62px; } }");
  assert.deepEqual(applyDomainStylesAllowlist([], [{ ...entry, contentScope: undefined, variablesOnly: true }], sources).map(item => item.detail), ["padding"]);
});

test("domain selector lists preserve functional and quoted commas without admitting another root", () => {
  const entry = { file: "src/Canvas.tsx", detail: "./canvas.css", maxOccurrences: 1, scope: ".canvas", reason: "Canvas hit geometry" };
  const sources = new Map([["src/canvas.css", '.canvas .port:is(:hover, :focus-visible, .active), .canvas [data-value="a,b"] { width: 16px; } .outside { color: inherit; }']]);
  assert.deepEqual(applyDomainStylesAllowlist([], [entry], sources).map(item => item.detail), [".outside"]);
});

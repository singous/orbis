import { test } from "node:test";
import assert from "node:assert/strict";
import { analyzeUI, findingCounts, newFindings } from "../../scripts/ui-architecture.mjs";

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

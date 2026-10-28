import assert from "node:assert/strict";
import { test } from "node:test";
import { analyzeArchitecture } from "../../scripts/frontend-architecture.mjs";

const analyze = sources => analyzeArchitecture(new Map(Object.entries(sources))).violations;
test("rejects shared and feature imports pointing toward application composition, including lazy imports", () => {
  assert.equal(analyze({ "shared/a.ts": 'import("../features/a");', "features/a.ts": 'export { App } from "../app/App";', "app/App.tsx": "export const App = 1;" }).length, 2);
});
test("reports an eager cycle through re-exports", () => {
  const errors = analyze({ "features/a.ts": 'export * from "./b";', "features/b.ts": 'import { value } from "./a";' });
  assert.match(errors[0], /a.ts -> features\/b.ts -> features\/a.ts/);
});
test("permits type-only cycles and lazy editor composition", () => {
  assert.deepEqual(analyze({ "features/a.ts": 'import type { B } from "./b"; import("./c");', "features/b.ts": 'import { type A } from "./a";', "features/c.ts": 'export { A } from "./a";' }), []);
});
test("keeps production dependencies free of tests and content contracts free of renderers", () => {
  assert.equal(analyze({ "features/content/model/a.ts": 'import "react"; import "./a.test";', "features/content/model/a.test.ts": "" }).length, 2);
});
test("ignores fake imports in comments and ignores test-only integration dependencies", () => {
  assert.deepEqual(analyze({ "shared/a.ts": '// import "../features/a";', "shared/a.test.ts": 'import "../features/a";', "features/a.ts": "" }), []);
});

test("checks import-type boundaries and does not erase side effects of empty imports", () => {
  assert.equal(analyze({ "shared/a.ts": 'type T = import("../features/a").A;', "features/a.ts": "" }).length, 1);
  assert.match(analyze({ "features/a.ts": 'import {} from "./b";', "features/b.ts": 'export {} from "./a";' })[0], /cycle/);
});

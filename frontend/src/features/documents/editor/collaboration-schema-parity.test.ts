import { getSchema } from "@tiptap/core";
import type { NodeSpec, MarkSpec } from "@tiptap/pm/model";
import { describe, expect, it } from "vitest";
import * as Y from "yjs";
import contract from "../../../../../api/editor-prosemirror-schema.json";
import { collaborativeEditorExtensions } from "./TiptapEditor";

function attributes(spec: NodeSpec | MarkSpec) {
  return Object.fromEntries(Object.entries(spec.attrs ?? {}).sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0).map(([name, rule]) => [name, rule.default]));
}
function nodeShape(spec: NodeSpec) {
  return {
    content: spec.content ?? null, group: spec.group ?? null, marks: spec.marks ?? null,
    inline: spec.inline ?? false, atom: spec.atom ?? false, code: spec.code ?? false,
    defining: spec.defining ?? false, isolating: spec.isolating ?? false,
    tableRole: spec.tableRole ?? null, linebreakReplacement: spec.linebreakReplacement ?? false,
    attrs: attributes(spec),
  };
}
function markShape(spec: MarkSpec) {
  return { excludes: spec.excludes ?? null, inclusive: spec.inclusive ?? true, code: spec.code ?? false, attrs: attributes(spec) };
}

describe("backend CRDT schema and collaborative browser editor", () => {
  it("shares every persisted node, mark, attribute default and content constraint", () => {
    const doc = new Y.Doc();
    try {
      const browser = getSchema(collaborativeEditorExtensions(doc));
      expect(Object.keys(browser.nodes).sort()).toEqual(Object.keys(contract.nodes).sort());
      expect(Object.keys(browser.marks).sort()).toEqual(Object.keys(contract.marks).sort());
      for (const [name, expected] of Object.entries(contract.nodes)) expect(nodeShape(browser.nodes[name].spec), name).toEqual(nodeShape(expected as NodeSpec));
      for (const [name, expected] of Object.entries(contract.marks)) expect(markShape(browser.marks[name].spec), name).toEqual(markShape(expected as MarkSpec));
    } finally { doc.destroy(); }
  });
});

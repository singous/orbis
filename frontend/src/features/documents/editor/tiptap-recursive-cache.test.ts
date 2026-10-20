import { Editor } from "@tiptap/core";
import { Node as ProseMirrorNode } from "@tiptap/pm/model";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { NoteBlocksV2, OrbisBlock } from "../../content/model/blocks";
import { tiptapExtensions } from "./tiptap-extensions";
import { fromTiptapDocument, toTiptapDocument } from "./tiptap-model";

const editors: Editor[] = [];
afterEach(() => { editors.splice(0).forEach((editor) => editor.destroy()); vi.restoreAllMocks(); });
const paragraph = (id: string, value = "Body"): OrbisBlock => ({ id, type: "paragraph", props: { textColor: "default" }, content: [{ type: "text", text: value, styles: {} }], children: [] });
const envelope = (blocks: OrbisBlock[]): NoteBlocksV2 => ({ schema_version: 2, editor: "blocknote", blocks });
function open(blocks: OrbisBlock[]) {
  const editor = new Editor({ extensions: tiptapExtensions, content: toTiptapDocument(envelope(blocks)) });
  editors.push(editor);
  return editor;
}
function edit(editor: Editor, target: string, text = "Edited ") {
  let position = -1;
  editor.state.doc.descendants((node, pos) => {
    if (node.attrs.orbisId === target && !node.attrs.orbisOwn) { position = pos + 1; return false; }
    return position < 0;
  });
  expect(position).toBeGreaterThan(0);
  editor.view.dispatch(editor.state.tr.insertText(text, position));
}

describe("recursive immutable ProseMirror block conversion", () => {
  it("reuses unchanged children when a paragraph in a giant container changes", () => {
    const source = { ...paragraph("parent", "Own body"), children: Array.from({ length: 500 }, (_, index) => paragraph(`child-${index}`, "a".repeat(1024))) };
    const editor = open([source]);
    expect(editor.state.doc.firstChild!.firstChild!.attrs.orbisOwn).toBe(true);
    const initial = fromTiptapDocument(editor.state.doc);
    expect(initial).toEqual(envelope([source]));
    edit(editor, "child-250");
    const originalToJSON = ProseMirrorNode.prototype.toJSON;
    const visited: string[] = [];
    vi.spyOn(ProseMirrorNode.prototype, "toJSON").mockImplementation(function (this: ProseMirrorNode) {
      visited.push(this.type.name);
      return originalToJSON.call(this);
    });
    const saved = fromTiptapDocument(editor.state.doc);
    expect(visited).not.toContain("orbisContainer");
    expect(visited.filter((type) => type === "paragraph")).toHaveLength(1);
    expect(saved.blocks[0].children[0]).toBe(initial.blocks[0].children[0]);
    expect(saved.blocks[0].children[499]).toBe(initial.blocks[0].children[499]);
    expect(saved.blocks[0].content).toEqual(source.content);
    expect(saved.blocks[0].props).toEqual(source.props);
    expect(saved.blocks[0].children[250].content).toEqual([{ type: "text", text: `Edited ${"a".repeat(1024)}` }]);
  });

  it.each(["quote", "toggleListItem", "callout", "bulletListItem", "numberedListItem", "checkListItem"])("preserves own metadata and child identities inside %s", (type) => {
    const source: OrbisBlock = { ...paragraph("parent", "Own body"), type, props: { textColor: "blue", ...(type === "callout" ? { title: "Title", tone: "info" } : {}), ...(type === "numberedListItem" ? { start: 7 } : {}), ...(type === "checkListItem" ? { checked: false } : {}) }, children: [paragraph("one"), paragraph("two")] };
    const editor = open([source]);
    const before = fromTiptapDocument(editor.state.doc);
    edit(editor, "one");
    const after = fromTiptapDocument(editor.state.doc);
    expect(after.blocks[0].children[1]).toBe(before.blocks[0].children[1]);
    expect(after.blocks[0].content).toEqual(source.content);
    expect(after.blocks[0].props).toEqual(source.props);
    expect(after.blocks[0].children[0].content).toEqual([{ type: "text", text: "Edited Body" }]);
  });

  it("does not reuse a list item as the wrong type after a list conversion", () => {
    const source: OrbisBlock = { ...paragraph("item"), type: "bulletListItem", children: [paragraph("nested")] };
    const editor = open([source]);
    const before = fromTiptapDocument(editor.state.doc);
    const item = editor.state.doc.firstChild!.firstChild!;
    const ordered = editor.schema.nodes.orderedList.create({ start: 7 }, [item]);
    const changed = editor.schema.nodes.doc.create(null, [ordered]);
    const after = fromTiptapDocument(changed);
    expect(after.blocks[0]).toMatchObject({ id: "item", type: "numberedListItem", props: { start: 7 } });
    expect(after.blocks[0].children[0]).toBe(before.blocks[0].children[0]);
  });

  it("keeps unchanged ancestor own bodies when several nesting levels change", () => {
    const source: OrbisBlock = { ...paragraph("outer"), children: [{ ...paragraph("quote", ""), type: "quote", content: "", children: [{ ...paragraph("toggle"), type: "toggleListItem", children: [paragraph("target"), paragraph("other")] }] }] };
    const editor = open([source]);
    const before = fromTiptapDocument(editor.state.doc);
    edit(editor, "target");
    const saved = fromTiptapDocument(editor.state.doc);
    expect(saved.blocks[0].children[0].content).toBe("");
    expect(saved.blocks[0].children[0].children[0].children[1]).toBe(before.blocks[0].children[0].children[0].children[1]);
    expect(saved.blocks[0].children[0].children[0].content).toEqual(source.children[0].children[0].content);
  });
});

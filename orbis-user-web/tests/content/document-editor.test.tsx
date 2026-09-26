import { Editor } from "@tiptap/core";
import { afterEach, expect, it } from "vitest";

import { newBlockId, type OrbisBlock } from "../../src/features/notes/block-model";
import { tiptapExtensions } from "../../src/features/notes/tiptap-extensions";
import { createDocumentBlock } from "../../src/features/notes/tiptap-insert";
import { fromTiptapDocument, toTiptapDocument } from "../../src/features/notes/tiptap-model";

const editors: Editor[] = [];
afterEach(() => editors.splice(0).forEach((editor) => editor.destroy()));

function open(blocks: OrbisBlock[]) {
  const editor = new Editor({ extensions: tiptapExtensions, content: toTiptapDocument({ schema_version: 2, editor: "blocknote", blocks }) });
  editors.push(editor);
  return editor;
}

function afterBlock(editor: Editor, id: string) {
  let position: number | undefined;
  editor.state.doc.descendants((node, pos) => {
    if (node.attrs.orbisId === id) { position = pos + node.nodeSize; return false; }
  });
  if (position === undefined) throw new Error(`Block ${id} was not found`);
  return position;
}

it.each(["cardGroup", "steps", "tabs", "codeGroup"] as const)("moves an incompatible pasted block outside %s without losing either child", (kind) => {
  const group = createDocumentBlock(kind);
  group.id = "group";
  const [first, second] = group.children;
  const editor = open([group]);
  const inserted: OrbisBlock = { id: newBlockId(), type: "paragraph", props: {}, content: [{ type: "text", text: "独立段落" }], children: [] };
  editor.commands.insertContentAt(afterBlock(editor, first.id), toTiptapDocument({ schema_version: 2, editor: "blocknote", blocks: [inserted] }).content![0]);
  const saved = fromTiptapDocument(editor.getJSON()).blocks;
  expect(saved.map((item) => item.type)).toEqual([kind, "paragraph", kind]);
  expect(saved[0].id).toBe("group");
  expect(saved[0].children.map((item) => item.id)).toEqual([first.id]);
  expect(saved[1]).toEqual(inserted);
  expect(saved[2].children.map((item) => item.id)).toEqual([second.id]);
  expect(saved[2].props).toEqual(saved[0].props);
  expect(saved[2].id).not.toBe(saved[0].id);
});

it("keeps a nested group's content editable and in its parent after splitting", () => {
  const nested = createDocumentBlock("steps");
  const card = createDocumentBlock("card");
  card.id = "outer";
  card.children = [nested];
  const editor = open([card]);
  const inserted: OrbisBlock = { id: "between", type: "paragraph", props: {}, content: [{ type: "text", text: "中间段落" }], children: [] };
  editor.commands.insertContentAt(afterBlock(editor, nested.children[0].id), toTiptapDocument({ schema_version: 2, editor: "blocknote", blocks: [inserted] }).content![0]);
  const children = fromTiptapDocument(editor.getJSON()).blocks[0].children;
  expect(children.map((item) => item.type)).toEqual(["steps", "paragraph", "steps"]);
  expect(children[1]).toEqual(inserted);
});

it("does not rewrite externally supplied content while the editor is read only", () => {
  const group = createDocumentBlock("cardGroup");
  const editor = open([group]);
  editor.setEditable(false);
  const inserted: OrbisBlock = { id: "external", type: "paragraph", props: {}, content: [{ type: "text", text: "外部内容" }], children: [] };
  editor.commands.insertContentAt(afterBlock(editor, group.children[0].id), toTiptapDocument({ schema_version: 2, editor: "blocknote", blocks: [inserted] }).content![0]);
  expect(fromTiptapDocument(editor.getJSON()).blocks[0].children.map((item) => item.type)).toEqual(["card", "paragraph", "card"]);
});

it("assigns a stable Orbis ID to a newly inserted paragraph before subsequent typing", () => {
  const editor = open([{ id: "existing", type: "paragraph", props: {}, content: [], children: [] }]);
  editor.commands.insertContentAt(editor.state.doc.content.size, { type: "paragraph", content: [{ type: "text", text: "新段落" }] });
  const first = fromTiptapDocument(editor.getJSON()).blocks[1];
  expect(first.id).toBeTruthy();
  editor.commands.insertContentAt(afterBlock(editor, first.id) - 1, "继续输入");
  const second = fromTiptapDocument(editor.getJSON()).blocks[1];
  expect(second.id).toBe(first.id);
  expect(JSON.stringify(second.content)).toContain("继续输入");
});

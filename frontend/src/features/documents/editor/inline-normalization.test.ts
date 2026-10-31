import { Editor } from "@tiptap/core";
import { EditorState } from "@tiptap/pm/state";
import { afterEach, expect, it, vi } from "vitest";
import type { OrbisBlock } from "../../content/blocks";
import { tiptapExtensions } from "./tiptap-extensions";
import { fromTiptapDocument, toTiptapDocument } from "./tiptap-model";
import { inlineTransactionsOnly } from "./tiptap-inline-change";

const editors: Editor[] = [];
afterEach(() => editors.splice(0).forEach(editor => editor.destroy()));
const paragraph = (id: string): OrbisBlock => ({ id, type: "paragraph", props: {}, content: [{ type: "text", text: id }], children: [] });
function open(blocks: OrbisBlock[]) { const editor = new Editor({ extensions: tiptapExtensions, content: toTiptapDocument({ schema_version: 2, editor: "blocknote", blocks }) }); editors.push(editor); return editor; }

it("does not normalize a validated whole tree for an inline edit", () => {
  const editor = open([paragraph("edited"), paragraph("untouched")]);
  const before = editor.state, transaction = before.tr.insertText("new ", 1);
  const after = EditorState.create({ doc: transaction.doc, selection: transaction.selection });
  const scan = vi.spyOn(after.doc, "forEach");
  const plugin = before.plugins.find(plugin => "key" in plugin && typeof plugin.key === "string" && plugin.key.startsWith("orbisGroupEditing"))!;
  expect(plugin.spec.appendTransaction!.call(plugin, [transaction], before, after)).toBeNull();
  expect(scan).not.toHaveBeenCalled(); scan.mockRestore();
});

it("repairs an invalid initial group even when its first transaction only changes text", () => {
  const editor = open([{ ...paragraph("group"), type: "cardGroup", content: [], children: [paragraph("invalid-child")] }]);
  editor.commands.insertContentAt(2, "new ");
  const result = fromTiptapDocument(editor.state.doc).blocks;
  expect(result[0].type).toBe("cardGroup");
  expect(result[0].children).toEqual([]);
  expect(result[1]).toMatchObject({ id: "invalid-child", type: "paragraph" });
});

it("keeps cross-block replacements, splitting and attribute changes on the structural path", () => {
  const editor = open([paragraph("first"), paragraph("second")]);
  const between = editor.state.tr.delete(2, editor.state.doc.firstChild!.nodeSize + 2);
  expect(inlineTransactionsOnly([between])).toBe(false);
  const split = editor.state.tr.split(3);
  expect(inlineTransactionsOnly([split])).toBe(false);
  const attributes = editor.state.tr.setNodeMarkup(0, undefined, { ...editor.state.doc.firstChild!.attrs, orbisProps: { custom: "changed" } });
  expect(inlineTransactionsOnly([attributes])).toBe(false);
});

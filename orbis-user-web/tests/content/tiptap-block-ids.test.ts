import { Editor } from "@tiptap/core";
import { afterEach, describe, expect, it, vi } from "vitest";
import { EditorState } from "@tiptap/pm/state";

import type { OrbisBlock } from "../../src/features/notes/block-model";
import { tiptapExtensions } from "../../src/features/notes/tiptap-extensions";
import { createDocumentBlock } from "../../src/features/notes/tiptap-insert";
import { fromTiptapDocument, toTiptapDocument } from "../../src/features/notes/tiptap-model";

const editors: Editor[] = [];
afterEach(() => editors.splice(0).forEach((editor) => editor.destroy()));
const paragraph = (id: string, text: string, children: OrbisBlock[] = []): OrbisBlock => ({ id, type: "paragraph", props: {}, content: [{ type: "text", text }], children });
function open(blocks: OrbisBlock[]) {
  const editor = new Editor({ extensions: tiptapExtensions, content: toTiptapDocument({ schema_version: 2, editor: "blocknote", blocks }) });
  editors.push(editor);
  return editor;
}
function storedIds(blocks: OrbisBlock[]): string[] { return blocks.flatMap((block) => [block.id, ...storedIds(block.children)]); }

describe("Tiptap persisted block identities", () => {
  it("edits inline text in a validated document without walking old or new block trees", () => {
    const editor = open([paragraph("original", "First"), paragraph("untouched", "Keep")]);
    const before = editor.state;
    const transaction = before.tr.insertText("typed ", 1);
    const after = EditorState.create({ doc: transaction.doc, selection: transaction.selection });
    const oldScan = vi.spyOn(before.doc, "descendants"), newScan = vi.spyOn(after.doc, "descendants");
    const plugin = before.plugins.find(plugin => plugin.key.startsWith("orbisBlockIds"))!;
    expect(plugin.spec.appendTransaction!.call(plugin, [transaction], before, after)).toBeNull();
    expect(oldScan).not.toHaveBeenCalled();
    expect(newScan).not.toHaveBeenCalled();
    oldScan.mockRestore(); newScan.mockRestore();
    editor.view.dispatch(transaction);
    expect(fromTiptapDocument(editor.state.doc).blocks.map(block => block.id)).toEqual(["original", "untouched"]);
  });

  it("still repairs initial missing IDs on an inline edit", () => {
    const content = toTiptapDocument({ schema_version: 2, editor: "blocknote", blocks: [paragraph("original", "First"), paragraph("other", "Keep")] });
    content.content![1].attrs!.orbisId = null;
    const editor = new Editor({ extensions: tiptapExtensions, content }); editors.push(editor);
    editor.commands.insertContentAt(1, "typed ");
    const ids = storedIds(fromTiptapDocument(editor.state.doc).blocks);
    expect(ids[0]).toBe("original");
    expect(ids[1]).toBeTruthy();
    expect(new Set(ids).size).toBe(2);
  });

  it("gives a split paragraph a new ID while retaining existing block identities", () => {
    const editor = open([paragraph("original", "FirstSecond"), paragraph("untouched", "Keep")]);
    editor.commands.setTextSelection(6);
    editor.commands.splitBlock();
    const saved = fromTiptapDocument(editor.getJSON()).blocks;
    expect(saved[0]).toMatchObject({ id: "original", content: [{ type: "text", text: "First" }] });
    expect(saved[1].id).not.toBe("original");
    expect(saved[2].id).toBe("untouched");
    expect(new Set(storedIds(saved)).size).toBe(3);
  });

  it.each(["before", "after"])("reassigns copied IDs inserted %s the original without changing the original", (side) => {
    const original = paragraph("original", "Keep");
    const editor = open([original]);
    const copied = toTiptapDocument({ schema_version: 2, editor: "blocknote", blocks: [original] }).content![0];
    editor.commands.insertContentAt(side === "before" ? 0 : editor.state.doc.content.size, copied);
    const saved = fromTiptapDocument(editor.getJSON()).blocks;
    const originalIndex = side === "before" ? 1 : 0;
    expect(saved[originalIndex].id).toBe("original");
    expect(saved[1 - originalIndex].id).not.toBe("original");
    expect(new Set(storedIds(saved)).size).toBe(2);
  });

  it("keeps untouched nested blocks byte-equivalent when another block changes", () => {
    const parent = paragraph("parent", "Parent", [paragraph("child", "Child")]);
    const editor = open([parent, paragraph("other", "Other")]);
    editor.commands.insertContentAt(editor.state.doc.content.size - 1, "!");
    expect(fromTiptapDocument(editor.getJSON()).blocks[0]).toEqual(parent);
  });

  it("assigns distinct persisted IDs to a duplicated block and all its children", () => {
    const parent = paragraph("parent", "Parent", [paragraph("child", "Child")]);
    const editor = open([parent]);
    editor.commands.insertContentAt(0, toTiptapDocument({ schema_version: 2, editor: "blocknote", blocks: [parent] }).content![0]);
    const saved = fromTiptapDocument(editor.getJSON()).blocks;
    expect(saved[1]).toEqual(parent);
    expect(new Set(storedIds(saved)).size).toBe(4);
  });

  it("gives a split callout body a stable ID even when the own-content flag is copied", () => {
    const callout = createDocumentBlock("callout");
    callout.content = [{ type: "text", text: "FirstSecond" }];
    const editor = open([callout]);
    editor.commands.setTextSelection(7);
    expect(editor.commands.splitBlock()).toBe(true);
    const firstSave = fromTiptapDocument(editor.getJSON()).blocks[0];
    expect(firstSave.content).toEqual([{ type: "text", text: "First" }]);
    expect(firstSave.children[0].content).toEqual([{ type: "text", text: "Second" }]);
    expect(fromTiptapDocument(editor.getJSON()).blocks[0].children[0].id).toBe(firstSave.children[0].id);
  });

  it("gives copied own-content paragraphs a stable identity outside their source container", () => {
    const editor = open([paragraph("original", "Keep")]);
    editor.commands.insertContentAt(editor.state.doc.content.size, { type: "paragraph", attrs: { orbisOwn: true }, content: [{ type: "text", text: "Copied" }] });
    const firstSave = fromTiptapDocument(editor.getJSON()).blocks;
    expect(firstSave[1].content).toEqual([{ type: "text", text: "Copied" }]);
    expect(fromTiptapDocument(editor.getJSON()).blocks[1].id).toBe(firstSave[1].id);
  });

  it("retains the caret in the first split block when a group is normalized", () => {
    const group = createDocumentBlock("steps");
    const body = group.children[0].children[0];
    body.content = [{ type: "text", text: "FirstSecond" }];
    const editor = open([group]);
    let bodyStart = 0;
    editor.state.doc.descendants((node, pos) => { if (node.attrs.orbisId === body.id) bodyStart = pos; });
    editor.commands.setTextSelection(bodyStart + 6);
    editor.commands.splitBlock();
    let firstStart = -1;
    let afterFirstStep = 0;
    editor.state.doc.descendants((node, pos) => {
      if (node.attrs.orbisId === body.id && firstStart === -1) firstStart = pos;
      if (node.attrs.orbisId === group.children[0].id) afterFirstStep = pos + node.nodeSize;
    });
    editor.chain().insertContentAt(afterFirstStep, { type: "paragraph", content: [{ type: "text", text: "Between steps" }] }).setTextSelection(firstStart + 2).run();
    expect(editor.state.selection.$from.parent.textContent).toBe("First");
    expect(editor.state.selection.$from.parentOffset).toBe(1);
    const saved = fromTiptapDocument(editor.getJSON()).blocks;
    const ids = storedIds(saved);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

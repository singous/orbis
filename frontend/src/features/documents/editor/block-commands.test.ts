import { Editor } from "@tiptap/core";
import { afterEach, describe, expect, it } from "vitest";
import type { OrbisBlock } from "../../content/blocks";
import { tiptapExtensions } from "./tiptap-extensions";
import { fromTiptapDocument, toTiptapDocument } from "./tiptap-model";
import { executeBlockCommand, locateEditorBlocks } from "./blocks/block-commands";
import { blockActionAvailability } from "./blocks/block-capabilities";
import { indexBlocks, normalizeBlockSelection } from "./blocks/block-tree";

const editors: Editor[] = [];
afterEach(() => editors.splice(0).forEach((editor) => editor.destroy()));
const p = (id: string, children: OrbisBlock[] = []): OrbisBlock => ({ id, type: "paragraph", props: {}, content: [{ type: "text", text: id }], children });
const kind = (id: string, type: string, children: OrbisBlock[] = []): OrbisBlock => ({ ...p(id, children), type, content: [] });
function open(blocks: OrbisBlock[]) {
  const editor = new Editor({ extensions: tiptapExtensions, content: toTiptapDocument({ schema_version: 2, editor: "blocknote", blocks }) });
  editors.push(editor); return editor;
}
const saved = (editor: Editor) => fromTiptapDocument(editor.state.doc).blocks;
const ids = (blocks: OrbisBlock[]) => blocks.map((block) => block.id);

describe("block command engine", () => {
  it("indexes business ancestry and normalizes selected descendants in document order", () => {
    const blocks = [p("a", [p("b")]), p("c")];
    expect(indexBlocks(blocks).get("b")).toMatchObject({ parentId: "a", index: 0, path: [0, 0] });
    expect(normalizeBlockSelection(blocks, ["c", "b", "a", "a"])).toEqual(["a", "c"]);
  });
  it("addresses nested blocks once and excludes list and table synthetic children", () => {
    const editor = open([p("a", [p("b")]), kind("li", "bulletListItem", [p("nested")]), { ...kind("table", "table"), content: { type: "tableContent", rows: [{ cells: ["Cell"] }] } }]);
    expect(locateEditorBlocks(editor.state.doc).map(({ id, parentId }) => [id, parentId])).toEqual([["a", null], ["b", "a"], ["li", null], ["nested", "li"], ["table", null]]);
  });
  it("moves a cross-parent selection in document order and retains all IDs", () => {
    const editor = open([p("a", [p("a1"), p("a2")]), p("b", [p("b1")]), p("end")]);
    expect(executeBlockCommand(editor, ["b1", "a1"], { type: "move", targetId: "end", placement: "before" }).ok).toBe(true);
    expect(ids(saved(editor))).toEqual(["a", "b", "a1", "b1", "end"]);
    expect(ids(saved(editor)[0].children)).toEqual(["a2"]);
  });
  it("preserves untouched PM siblings and gives each command one independent undo step", () => {
    const editor = open([p("a"), p("b"), p("c"), p("keep")]);
    const untouched = editor.state.doc.lastChild;
    executeBlockCommand(editor, ["b"], { type: "up" });
    expect(ids(saved(editor))).toEqual(["b", "a", "c", "keep"]);
    expect(editor.state.doc.lastChild).toBe(untouched);
    executeBlockCommand(editor, ["c"], { type: "up" });
    expect(ids(saved(editor))).toEqual(["b", "c", "a", "keep"]);
    editor.commands.undo(); expect(ids(saved(editor))).toEqual(["b", "a", "c", "keep"]);
    editor.commands.undo(); expect(ids(saved(editor))).toEqual(["a", "b", "c", "keep"]);
    editor.commands.redo(); expect(ids(saved(editor))).toEqual(["b", "a", "c", "keep"]);
  });
  it("indents a batch and promotes it after its parent without losing descendants", () => {
    const editor = open([p("a"), p("b", [p("leaf")]), p("c")]);
    expect(executeBlockCommand(editor, ["b", "c"], { type: "indent" }).ok).toBe(true);
    expect(ids(saved(editor)[0].children)).toEqual(["b", "c"]);
    expect(executeBlockCommand(editor, ["b", "c"], { type: "outdent" }).ok).toBe(true);
    expect(ids(saved(editor))).toEqual(["a", "b", "c"]);
    expect(saved(editor)[1].children[0].id).toBe("leaf");
  });
  it("duplicates a complete subtree with fresh IDs and preserves author properties", () => {
    const a = { ...p("a", [p("child")]), props: { textColor: "red" } };
    const editor = open([a]);
    const result = executeBlockCommand(editor, ["a", "child"], { type: "duplicate" });
    const blocks = saved(editor);
    expect(result.ok).toBe(true); expect(blocks[0]).toEqual(a);
    expect(blocks[1].id).not.toBe("a"); expect(blocks[1].children[0].id).not.toBe("child");
    expect(blocks[1].props).toEqual(a.props); expect(result.selectedIds).toEqual([blocks[1].id]);
  });
  it("groups and ungroups a continuous selection while retaining children identities", () => {
    const editor = open([p("a"), p("b"), p("c")]);
    const result = executeBlockCommand(editor, ["a", "b"], { type: "group" });
    expect(result.ok).toBe(true);
    expect(saved(editor)[0]).toMatchObject({ type: "group", children: [{ id: "a" }, { id: "b" }] });
    expect(executeBlockCommand(editor, result.selectedIds, { type: "ungroup" }).ok).toBe(true);
    expect(ids(saved(editor))).toEqual(["a", "b", "c"]);
  });
  it("rejects discontinuous grouping and invalid business targets atomically", () => {
    const blocks = [p("a"), p("b"), p("c"), kind("cards", "cardGroup", [kind("card", "card")])];
    const editor = open(blocks); const before = editor.state.doc;
    expect(executeBlockCommand(editor, ["a", "c"], { type: "group" }).ok).toBe(false);
    expect(executeBlockCommand(editor, ["a"], { type: "move", targetId: "cards", placement: "inside" }).ok).toBe(false);
    expect(editor.state.doc).toBe(before);
    expect(blockActionAvailability(blocks, ["card"], { type: "outdent" }).ok).toBe(true);
  });
  it("prevents orphan step/tab nodes, cycles, missing selection and readonly writes", () => {
    const blocks = [kind("steps", "steps", [kind("step", "step", [p("leaf")])]), p("a")];
    const editor = open(blocks); const before = editor.state.doc;
    expect(executeBlockCommand(editor, ["step"], { type: "outdent" }).ok).toBe(false);
    expect(executeBlockCommand(editor, ["steps"], { type: "move", targetId: "leaf", placement: "inside" }).ok).toBe(false);
    expect(executeBlockCommand(editor, ["missing"], { type: "delete" }).ok).toBe(false);
    editor.setEditable(false);
    expect(executeBlockCommand(editor, ["a"], { type: "delete" }).ok).toBe(false);
    expect(editor.state.doc).toBe(before);
  });
  it("converts text/list/quote while preserving id, props and children", () => {
    const editor = open([{ ...p("a", [p("child")]), props: { checked: true, start: 7 } }]);
    for (const target of ["heading", "numberedListItem", "checkListItem", "quote", "paragraph"]) {
      expect(executeBlockCommand(editor, ["a"], { type: "convert", target, level: 2 }).ok).toBe(true);
      expect(saved(editor)[0]).toMatchObject({ id: "a", type: target, children: [{ id: "child" }] });
    }
  });
  it("refuses lossy conversions for every selected block before changing anything", () => {
    const rich = { ...p("rich"), content: [{ type: "text" as const, text: "Bold", styles: { bold: true as const } }] };
    const editor = open([p("plain"), rich, kind("image", "image")]); const before = editor.state.doc;
    expect(executeBlockCommand(editor, ["plain", "rich"], { type: "convert", target: "codeBlock" }).ok).toBe(false);
    expect(executeBlockCommand(editor, ["image"], { type: "convert", target: "paragraph" }).ok).toBe(false);
    expect(editor.state.doc).toBe(before);
  });
  it("inserts around a selection and leaves a fresh editable block after deleting all", () => {
    const editor = open([p("a")]);
    const inserted = executeBlockCommand(editor, ["a"], { type: "insert", side: "before" });
    expect(ids(saved(editor))).toEqual([...inserted.selectedIds, "a"]);
    expect(executeBlockCommand(editor, ids(saved(editor)), { type: "delete" }).ok).toBe(true);
    expect(saved(editor)).toHaveLength(1); expect(saved(editor)[0]).toMatchObject({ type: "paragraph", content: [] });
  });
  it("duplicates a batch after the selected range in document order", () => {
    const editor = open([p("a"), p("b"), p("c")]);
    const result = executeBlockCommand(editor, ["b", "a"], { type: "duplicate" });
    expect(ids(saved(editor))).toEqual(["a", "b", ...result.selectedIds, "c"]);
    expect(saved(editor).slice(2, 4).map((block) => block.content)).toEqual([p("a").content, p("b").content]);
  });
  it("assigns stable ids to later editable paragraphs inside list items", () => {
    const editor = open([kind("list", "bulletListItem")]);
    editor.view.dispatch(editor.state.tr.insert(4, editor.schema.nodes.paragraph.create(null, editor.schema.text("Nested"))));
    const first = fromTiptapDocument(editor.state.doc).blocks[0].children;
    expect(first).toHaveLength(1);
    expect(fromTiptapDocument(editor.getJSON()).blocks[0].children[0].id).toBe(first[0].id);
    expect(locateEditorBlocks(editor.state.doc).map(({ id }) => id)).toContain(first[0].id);
  });
  it("preserves an untouched nested sibling PM node when another child converts", () => {
    const editor = open([p("parent", [p("a"), p("keep")]), p("last")]);
    const unchanged = locateEditorBlocks(editor.state.doc).find(({ id }) => id === "keep")!.node;
    executeBlockCommand(editor, ["a"], { type: "convert", target: "heading" });
    expect(locateEditorBlocks(editor.state.doc).find(({ id }) => id === "keep")!.node).toBe(unchanged);
  });
  it("pastes with fresh ids and accepts cut ids only when they are absent", () => {
    const editor = open([p("a")]);
    const fresh = executeBlockCommand(editor, ["a"], { type: "paste", blocks: [p("a", [p("child")])] });
    expect(fresh.ok).toBe(true); expect(fresh.selectedIds[0]).not.toBe("a");
    expect(executeBlockCommand(editor, ["a"], { type: "paste", blocks: [p("a")], preserveIds: true }).ok).toBe(false);
    expect(executeBlockCommand(editor, ["a"], { type: "paste", blocks: [p("cut")], preserveIds: true }).selectedIds).toEqual(["cut"]);
  });
  it("leaves an editable paragraph after ungrouping an empty root group", () => {
    const editor = open([kind("empty", "group")]);
    expect(executeBlockCommand(editor, ["empty"], { type: "ungroup" }).ok).toBe(true);
    expect(saved(editor)[0]).toMatchObject({ type: "paragraph", content: [] });
  });
  it("retains an empty quote when deleting its final child", () => {
    const editor = open([kind("quote", "quote", [p("child")])]);
    expect(executeBlockCommand(editor, ["child"], { type: "delete" }).ok).toBe(true);
    expect(saved(editor)).toEqual([kind("quote", "quote")]);
    editor.commands.undo(); expect(saved(editor)[0].children[0].id).toBe("child");
  });
  it("creates one sequential numbered list from a batch conversion", () => {
    const editor = open([p("a"), p("b"), p("c")]);
    expect(executeBlockCommand(editor, ["a", "b", "c"], { type: "convert", target: "numberedListItem" }).ok).toBe(true);
    expect(editor.state.doc.childCount).toBe(1);
    expect(editor.state.doc.firstChild!.childCount).toBe(3);
  });
  it("keeps the text cursor offset through a paragraph to list conversion", () => {
    const editor = open([{ ...p("a"), content: "abcdef" }]);
    editor.commands.setTextSelection(4);
    executeBlockCommand(editor, ["a"], { type: "convert", target: "bulletListItem" });
    expect(editor.state.selection.$from.parentOffset).toBe(3);
  });
  it("rejects pasted nested orphan nodes and duplicate preserved IDs atomically", () => {
    const editor = open([p("a")]); const before = editor.state.doc;
    expect(executeBlockCommand(editor, ["a"], { type: "paste", blocks: [p("outer", [kind("bad", "step")])] }).ok).toBe(false);
    expect(executeBlockCommand(editor, ["a"], { type: "paste", blocks: [p("same"), p("same")], preserveIds: true }).ok).toBe(false);
    expect(editor.state.doc).toBe(before);
  });
  it.each(["convert", "move"] as const)("preserves live table paragraphs and PM identity during an unrelated %s", (action) => {
    const editor = open([p("a"), { ...kind("table", "table"), content: { type: "tableContent", rows: [{ cells: ["one"] }] } }, p("end")]);
    let cellPosition = 0;
    editor.state.doc.descendants((node, pos) => { if (node.type.name === "tableCell") cellPosition = pos; });
    const paragraph = (text: string) => editor.schema.nodes.paragraph.create(null, editor.schema.text(text));
    const cell = editor.state.doc.nodeAt(cellPosition)!;
    editor.view.dispatch(editor.state.tr.replaceWith(cellPosition + 1, cellPosition + cell.nodeSize - 1, [paragraph("one"), paragraph("two")]));
    const table = locateEditorBlocks(editor.state.doc).find(({ id }) => id === "table")!.node;
    expect(table.firstChild!.firstChild!.childCount).toBe(2);
    const result = executeBlockCommand(editor, ["a"], action === "convert" ? { type: "convert", target: "heading" } : { type: "move", targetId: "end", placement: "after" });
    expect(result.ok).toBe(true);
    const after = locateEditorBlocks(editor.state.doc).find(({ id }) => id === "table")!.node;
    expect(after).toBe(table);
    expect(after.firstChild!.firstChild!.content.content.map((node) => node.textContent)).toEqual(["one", "two"]);
    editor.commands.undo();
    expect(locateEditorBlocks(editor.state.doc).find(({ id }) => id === "table")!.node).toBe(table);
  });
  it("keeps a code block with descendants inside its code group", () => {
    const code = { ...kind("code", "codeBlock", [p("child")]), content: "const x = 1;" };
    const editor = open([code]);
    const grouped = executeBlockCommand(editor, ["code"], { type: "group", kind: "codeGroup" });
    expect(grouped.ok).toBe(true);
    expect(saved(editor)).toHaveLength(1);
    expect(saved(editor)[0]).toMatchObject({ id: grouped.selectedIds[0], type: "codeGroup", children: [code] });
    editor.commands.undo(); expect(saved(editor)).toEqual([code]);
  });
  it("keeps a code block in its group after moving a paragraph into its children", () => {
    const editor = open([kind("codes", "codeGroup", [{ ...kind("code", "codeBlock"), content: "const x = 1;" }]), p("child")]);
    expect(executeBlockCommand(editor, ["child"], { type: "move", targetId: "code", placement: "inside" }).ok).toBe(true);
    expect(saved(editor)).toHaveLength(1);
    expect(saved(editor)[0]).toMatchObject({ id: "codes", children: [{ id: "code", children: [{ id: "child" }] }] });
  });
  it("rejects duplicating live table structure the storage codec cannot preserve", () => {
    const editor = open([{ ...kind("table", "table"), content: { type: "tableContent", rows: [{ cells: ["one"] }] } }]);
    let cellPosition = 0;
    editor.state.doc.descendants((node, pos) => { if (node.type.name === "tableCell") cellPosition = pos; });
    const cell = editor.state.doc.nodeAt(cellPosition)!;
    editor.view.dispatch(editor.state.tr.replaceWith(cellPosition + 1, cellPosition + cell.nodeSize - 1, [
      editor.schema.nodes.heading.create({ level: 2 }, editor.schema.text("Heading")),
      editor.schema.nodes.paragraph.create(null, editor.schema.text("Paragraph")),
    ]));
    const before = editor.state.doc;
    const result = executeBlockCommand(editor, ["table"], { type: "duplicate" });
    expect(result.ok).toBe(false);
    expect(result.message).toContain("内部结构");
    expect(editor.state.doc).toBe(before);
  });
  it("duplicates a supported table while retaining rich live structure in an unselected sibling", () => {
    const table: OrbisBlock = { ...kind("table", "table"), content: { type: "tableContent", rows: [{ cells: ["one"] }] } };
    const editor = open([table, { ...table, id: "rich" }]);
    let secondCellPosition = 0;
    editor.state.doc.descendants((node, pos) => { if (node.type.name === "tableCell") secondCellPosition = pos; });
    const cell = editor.state.doc.nodeAt(secondCellPosition)!;
    editor.view.dispatch(editor.state.tr.replaceWith(secondCellPosition + 1, secondCellPosition + cell.nodeSize - 1,
      editor.schema.nodes.heading.create({ level: 2 }, editor.schema.text("Rich sibling"))));
    const rich = locateEditorBlocks(editor.state.doc).find(({ id }) => id === "rich")!.node;
    const result = executeBlockCommand(editor, ["table"], { type: "duplicate" });
    expect(result.ok).toBe(true);
    expect(saved(editor)[1]).toMatchObject({ id: result.selectedIds[0], type: "table", content: table.content });
    expect(locateEditorBlocks(editor.state.doc).find(({ id }) => id === "rich")!.node).toBe(rich);
  });
  it("treats boundary ordering as a no-op without transactions", () => {
    const editor = open([p("a"), p("b")]); const before = editor.state.doc;
    expect(executeBlockCommand(editor, ["a"], { type: "up" }).ok).toBe(false);
    expect(executeBlockCommand(editor, ["b"], { type: "down" }).ok).toBe(false);
    expect(editor.state.doc).toBe(before);
  });
});

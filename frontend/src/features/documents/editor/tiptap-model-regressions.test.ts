import { Editor } from "@tiptap/core";
import { afterEach, describe, expect, it } from "vitest";

import type { NoteBlocksV2, OrbisBlock, OrbisInline, OrbisTableCell, OrbisTableContent } from "../../content/model/blocks";
import { tiptapExtensions } from "./tiptap-extensions";
import { fromTiptapDocument, toTiptapDocument } from "./tiptap-model";

const editors: Editor[] = [];
afterEach(() => editors.splice(0).forEach((editor) => editor.destroy()));

const text = (value: string): OrbisInline[] => [{ type: "text", text: value }];
const block = (id: string, type: string, content: OrbisBlock["content"], props: Record<string, unknown> = {}, children: OrbisBlock[] = []): OrbisBlock => ({ id, type, props, content, children });
const envelope = (blocks: OrbisBlock[]): NoteBlocksV2 => ({ schema_version: 2, editor: "blocknote", blocks });
function open(blocks: OrbisBlock[]) {
  const editor = new Editor({ extensions: tiptapExtensions, content: toTiptapDocument(envelope(blocks)) });
  editors.push(editor);
  return editor;
}
function savedTable(editor: Editor): OrbisTableContent {
  return fromTiptapDocument(editor.getJSON()).blocks.find((value) => value.type === "table")!.content as OrbisTableContent;
}
function cellText(cell: OrbisTableCell): string {
  const content = typeof cell === "object" && !Array.isArray(cell) ? cell.content ?? [] : cell;
  const inlineText = (value: OrbisInline): string => value.type === "text" ? value.text : typeof value.content === "string" ? value.content : value.content.map(inlineText).join("");
  return typeof content === "string" ? content : content.map(inlineText).join("");
}

describe("Tiptap storage regressions", () => {
  it("displays native BlockNote code inline arrays without coercing objects", () => {
    const original = block("native-code", "codeBlock", [
      { type: "text", text: "const ready = true;\n", styles: {} },
      { type: "text", text: "console.log(ready);" },
    ], { language: "typescript" });
    const editor = open([original]);
    expect(editor.state.doc.firstChild!.textContent).toBe("const ready = true;\nconsole.log(ready);");
    expect(fromTiptapDocument(editor.getJSON())).toEqual(envelope([original]));
  });

  it("retains the original code when only its language changes", () => {
    const editor = open([block("native-code", "codeBlock", text("const ready = true;"), { language: "typescript" })]);
    editor.commands.setTextSelection(1);
    editor.commands.updateAttributes("codeBlock", { language: "javascript" });
    expect(fromTiptapDocument(editor.getJSON()).blocks[0]).toMatchObject({ id: "native-code", content: "const ready = true;", props: { language: "javascript" } });
  });

  it.each([{ withHeaderRow: true, expected: 1 }, { withHeaderRow: false, expected: 0 }])("saves a newly inserted table with headerRows=$expected", ({ withHeaderRow, expected }) => {
    const editor = open([block("paragraph", "paragraph", [])]);
    expect(editor.commands.insertTable({ rows: 2, cols: 2, withHeaderRow })).toBe(true);
    const table = savedTable(editor);
    expect(table).toMatchObject({ type: "tableContent", headerRows: expected, headerCols: 0 });
    expect(table.rows).toHaveLength(2);
    expect(table.rows.every((row) => row.cells.length === 2)).toBe(true);
  });

  it("saves live header row and column changes instead of stale table attributes", () => {
    const editor = open([block("table", "table", { type: "tableContent", headerRows: 1, headerCols: 0, rows: [
      { cells: [text("A"), text("B")] }, { cells: [text("C"), text("D")] },
    ] })]);
    editor.commands.setTextSelection(4);
    expect(editor.commands.toggleHeaderColumn()).toBe(true);
    expect(savedTable(editor)).toMatchObject({ headerRows: 1, headerCols: 1 });
    expect(editor.commands.toggleHeaderRow()).toBe(true);
    expect(savedTable(editor)).toMatchObject({ headerRows: 0, headerCols: 1 });
  });

  it("preserves merged spans and updates saved column widths from live cells", () => {
    const editor = open([block("table", "table", { type: "tableContent", headerRows: 1, headerCols: 0, columnWidths: [140, 220], rows: [
      { cells: [{ type: "tableCell", props: { colspan: 2, rowspan: 1, backgroundColor: "yellow" }, content: text("Title") }] },
      { cells: [text("A"), text("B")] },
    ] })]);
    const transaction = editor.state.tr;
    editor.state.doc.descendants((node, pos) => {
      if (node.type.name === "tableHeader") transaction.setNodeMarkup(pos, undefined, { ...node.attrs, colwidth: [180, 260] });
      if (node.type.name === "tableCell") transaction.setNodeMarkup(pos, undefined, { ...node.attrs, colwidth: [node.textContent === "A" ? 180 : 260] });
    });
    editor.view.dispatch(transaction);
    const table = savedTable(editor);
    expect(table.columnWidths).toEqual([180, 260]);
    expect(table.rows[0].cells[0]).toMatchObject({ props: { colspan: 2, rowspan: 1, backgroundColor: "yellow" } });
  });

  it("keeps header semantics while adding and deleting table rows", () => {
    const editor = open([block("table", "table", { type: "tableContent", headerRows: 1, columnWidths: [120, 180], rows: [
      { cells: [text("A"), text("B")] }, { cells: [text("C"), text("D")] },
    ] })]);
    editor.commands.setTextSelection(4);
    expect(editor.commands.addRowAfter()).toBe(true);
    expect(savedTable(editor)).toMatchObject({ headerRows: 1, columnWidths: [120, 180] });
    expect(savedTable(editor).rows).toHaveLength(3);
    expect(editor.commands.deleteRow()).toBe(true);
    expect(savedTable(editor)).toMatchObject({ headerRows: 0, columnWidths: [120, 180] });
    expect(savedTable(editor).rows).toHaveLength(2);
  });

  it("persists a paragraph split in a table cell as a newline", () => {
    const editor = open([block("table", "table", { type: "tableContent", rows: [{ cells: [text("firstsecond")] }] })]);
    editor.commands.setTextSelection(9);
    expect(editor.commands.splitBlock()).toBe(true);
    expect(cellText(savedTable(editor).rows[0].cells[0])).toBe("first\nsecond");
  });

  it("retains nested pasted cell text, paragraph boundaries, and inline marks", () => {
    const editor = open([block("paragraph", "paragraph", [])]);
    editor.commands.setContent("<table><tbody><tr><td><p>Intro</p><ul><li><p><strong>First</strong></p><ul><li><p>Nested</p></li></ul></li><li><p><a href='https://example.com'>Second</a></p></li></ul><p></p><blockquote><p>Quote</p></blockquote></td></tr></tbody></table>");
    const cell = savedTable(editor).rows[0].cells[0];
    expect(cellText(cell)).toBe("Intro\nFirst\nNested\nSecond\n\nQuote");
    expect(cell).toMatchObject({ content: expect.arrayContaining([
      { type: "text", text: "First", styles: { bold: true } },
      { type: "link", href: "https://example.com", content: [{ type: "text", text: "Second" }] },
    ]) });
  });

  it("retains live heading properties when the stored block owns children", () => {
    const editor = open([block("parent", "paragraph", text("Parent"), { textAlignment: "center" }, [block("child", "paragraph", text("Child"))])]);
    editor.commands.setTextSelection(2);
    expect(editor.commands.setHeading({ level: 3 })).toBe(true);
    const saved = fromTiptapDocument(editor.getJSON()).blocks[0];
    expect(saved).toMatchObject({ id: "parent", type: "heading", props: { level: 3, textAlignment: "center" }, children: [{ id: "child", content: text("Child") }] });
    expect(open([saved]).state.doc.firstChild!.firstChild!.attrs.level).toBe(3);
  });

  it("keeps the stored toggle title in its editable summary and preserves children", () => {
    const original = block("toggle", "toggleListItem", text("Summary"), { textColor: "default" }, [block("child", "paragraph", text("Details"))]);
    const document = toTiptapDocument(envelope([original]));
    expect(document.content![0].content![0]).toMatchObject({ type: "orbisToggleSummary", content: text("Summary") });
    const editor = open([original]);
    expect(fromTiptapDocument(editor.getJSON())).toEqual(envelope([original]));
    editor.commands.insertContentAt(2, "Edited ");
    expect(fromTiptapDocument(editor.getJSON()).blocks[0]).toMatchObject({ id: "toggle", content: text("Edited Summary"), children: original.children });
  });
});

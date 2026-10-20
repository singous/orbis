import { describe, expect, it } from "vitest";
import { editorBlock, nativeBlock, nativeBlockSchema, nativePayload, type NativeBlock } from "./api-content";
import { fromTiptapDocument, toTiptapDocument } from "../../documents/editor/tiptap-model";
const id = (last: string) => "00000000-0000-4000-8000-" + last.padStart(12, "0");
const run = (text: string) => ({ text, marks: [], href: null });
function block(type: string, props: Record<string, unknown> = {}, content = [run("正文")], children: NativeBlock[] = []): NativeBlock {
  return { id: crypto.randomUUID(), type, props, content, children };
}
describe("native content boundary", () => {
  it("preserves rich text, scoped asset links and unloaded children through shallow edits", () => {
    const value: NativeBlock = { id: id("1"), type: "paragraph", props: { text_alignment: "center", text_color: "#123456" }, content: [{ text: "原文", marks: ["bold", "italic"], href: "asset:" + id("9"), text_color: "#abcdef", background_color: "yellow" }], children: [block("paragraph")] };
    const editor = editorBlock(nativeBlockSchema.parse(value));
    const roundtrip = nativeBlock(editor);
    expect(roundtrip).toEqual(value);
    editor.content = [{ type: "text", text: "修改后", styles: { bold: true, textColor: "#abcdef" } }];
    const shallow = nativePayload(editor);
    expect(shallow).not.toHaveProperty("children");
    expect(shallow.props.text_alignment).toBe("center");
    expect(shallow.content).toEqual([{ text: "修改后", marks: ["bold"], href: null, text_color: "#abcdef" }]);
  });
  it("keeps merged grid anchors, nullable widths, headers and cell formatting", () => {
    const value: NativeBlock = { ...block("table", {}, []), table: { column_widths: [120, null], header_rows: 1, header_columns: 0, rows: [[{ content: [run("合并单元格")], row_span: 2, column_span: 1, alignment: "right", text_color: "red", background_color: null }, { content: [run("右上")], row_span: 1, column_span: 1, alignment: "left", text_color: null, background_color: "#ffffff" }], [{ content: [run("右下")], row_span: 1, column_span: 1, alignment: "center", text_color: null, background_color: null }]] } };
    expect(nativeBlock(editorBlock(value))).toEqual(value);
    const document = { schema_version: 2 as const, editor: "blocknote" as const, blocks: [editorBlock(value)] };
    expect(nativeBlock(fromTiptapDocument(toTiptapDocument(document)).blocks[0])).toEqual(value);
  });
  it("maps renderer-owned media sources while keeping drawing JSON opaque", () => {
    const scene = JSON.stringify({ version: 1, elements: [], appState: { theme: "dark", reference: "orbis-file:" + id("5") } });
    for (const value of [block("drawing", { scene, caption: "示意图", source: { type: "asset", asset_id: id("5") } }, []), block("image", { source: { type: "external", url: "https://example.test/photo.png" }, width: 320, show_preview: false, caption: "说明" }, [])]) {
      expect(nativeBlock(editorBlock(value))).toEqual(value);
    }
  });
  it("retains container types and independent table references", () => {
    const nested = block("card_group", { columns: 3 }, [], [block("card", { title: "链接", href: "/documents/" + id("1") }, [], [block("paragraph")])]);
    for (const value of [nested, block("data_table", { table_id: null, table_version: null }, []), block("data_table", { table_id: id("4"), table_version: 7 }, [])]) {
      expect(nativeBlock(editorBlock(value))).toEqual(value);
    }
  });
  it("rejects unknown semantic types and unsupported text styles", () => {
    expect(() => editorBlock(block("future_component"))).toThrow();
    expect(() => nativeBlock({ ...editorBlock(block("paragraph")), content: [{ type: "text", text: "正文", styles: { custom: true } as never }] })).toThrow();
  });
});

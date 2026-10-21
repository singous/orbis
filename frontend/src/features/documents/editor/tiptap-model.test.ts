import { describe, expect, it } from "vitest";
import { getSchema } from "@tiptap/core";
import { tiptapExtensions } from "./tiptap-extensions";
import { fromTiptapDocument, toTiptapDocument } from "./tiptap-model";
import type { NoteBlocksV2, OrbisBlock } from "../../content/model/blocks";

const block = (id: string, type: string, content: OrbisBlock["content"] = [], props: Record<string, unknown> = {}, children: OrbisBlock[] = []): OrbisBlock => ({ id, type, props, content, children });
const text = (value: string) => [{ type: "text" as const, text: value }];
const envelope = (blocks: OrbisBlock[]): NoteBlocksV2 => ({ schema_version: 2, editor: "blocknote", blocks });

describe("Orbis block and Tiptap JSON bridge", () => {
  it("round-trips the native 32-level nesting limit with bounded editor metadata", () => {
    let root = block("leaf", "paragraph", text("deep content"));
    for (let depth = 1; depth < 32; depth++) root = block(`group-${depth}`, "group", [], {}, [root]);
    const original = envelope([root]);
    const converted = toTiptapDocument(original);
    expect(JSON.stringify(converted).length).toBeLessThan(500_000);
    expect(fromTiptapDocument(converted)).toEqual(original);
    const parsed = getSchema(tiptapExtensions).nodeFromJSON(converted);
    expect(() => parsed.check()).not.toThrow();
    expect(fromTiptapDocument(parsed)).toEqual(original);
  });

  it("opens an empty document as a valid paragraph with a stable insertion identity", () => {
    const parsed = getSchema(tiptapExtensions).nodeFromJSON(toTiptapDocument(envelope([])));
    expect(() => parsed.check()).not.toThrow();
    expect(parsed.firstChild?.type.name).toBe("paragraph");
    const first = fromTiptapDocument(parsed).blocks[0];
    expect(first.id).toBeTruthy();
    expect(fromTiptapDocument(parsed).blocks[0].id).toBe(first.id);
  });

  it("preserves rich paragraphs, headings, lists, nested blocks and code languages", () => {
    const original = envelope([
      block("h", "heading", text("开始"), { level: 2 }),
      block("p", "paragraph", [
        { type: "text", text: "粗体", styles: { bold: true, textColor: "#aabbcc" } },
        { type: "link", href: "https://example.com", content: text("链接") },
      ], { textAlignment: "center" }),
      block("n1", "numberedListItem", text("第一项"), { start: 7 }, [block("nested", "bulletListItem", text("子项"))]),
      block("n2", "numberedListItem", text("第二项")),
      block("task", "checkListItem", text("完成"), { checked: true }),
      block("quote", "quote", [], {}, [block("qp", "paragraph", text("引用"))]),
      block("code", "codeBlock", "const x = 1;", { language: "typescript" }),
      block("line", "divider"),
    ]);
    expect(fromTiptapDocument(toTiptapDocument(original))).toEqual(original);
    const parsed = getSchema(tiptapExtensions).nodeFromJSON(toTiptapDocument(original));
    expect(() => parsed.check()).not.toThrow();
    expect(fromTiptapDocument(parsed.toJSON())).toEqual(original);
  });

  it("preserves table headers, spans, widths, links and media references", () => {
    const original = envelope([
      block("table", "table", { type: "tableContent", headerRows: 1, headerCols: 0, columnWidths: [140, 220], rows: [
        { cells: [{ type: "tableCell", props: { colspan: 2, rowspan: 1 }, content: text("标题") }] },
        { cells: [
          { type: "tableCell", props: { colspan: 1, rowspan: 1 }, content: [{ type: "link", href: "https://example.com", content: text("站点") }] },
          { type: "tableCell", props: { colspan: 1, rowspan: 1 }, content: text("内容") },
        ] },
      ] }),
      block("image", "image", [], { url: "orbis-file:00000000-0000-0000-0000-000000000001", caption: "示意图" }),
      block("video", "video", [], { url: "https://example.com/clip.mp4", name: "演示" }),
      block("audio", "audio", [], { url: "https://example.com/sound.mp3" }),
      block("file", "file", [], { url: "https://example.com/readme.pdf" }),
    ]);
    expect(fromTiptapDocument(toTiptapDocument(original))).toEqual(original);
    const parsed = getSchema(tiptapExtensions).nodeFromJSON(toTiptapDocument(original));
    expect(() => parsed.check()).not.toThrow();
    expect(fromTiptapDocument(parsed.toJSON())).toEqual(original);
  });

  it("preserves editable documentation components and their children", () => {
    const original = envelope([
      block("callout", "callout", text("请先阅读"), { title: "注意", tone: "warning" }, [block("inside", "paragraph", text("详细说明"))]),
      block("cards", "cardGroup", [], { columns: 2 }, [
        block("card-a", "card", [], { title: "A", href: "/s/guide/a" }, [block("a", "paragraph", text("甲"))]),
        block("card-b", "card", [], { title: "B", href: "" }, [block("b", "paragraph", text("乙"))]),
      ]),
      block("steps", "steps", [], {}, [block("step", "step", [], { title: "安装" }, [block("body", "paragraph", text("运行命令"))])]),
      block("tabs", "tabs", [], {}, [block("tab", "tab", [], { title: "Python" }, [block("tab-code", "codeBlock", "print(1)", { language: "python" })])]),
    ]);
    expect(fromTiptapDocument(toTiptapDocument(original))).toEqual(original);
    const parsed = getSchema(tiptapExtensions).nodeFromJSON(toTiptapDocument(original));
    expect(() => parsed.check()).not.toThrow();
    expect(fromTiptapDocument(parsed.toJSON())).toEqual(original);
  });
});

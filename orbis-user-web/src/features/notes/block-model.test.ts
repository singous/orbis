import { describe, expect, it } from "vitest";
import { BlockNoteEditor } from "@blocknote/core";

import type { NoteBlocks } from "../../shared/api/schemas";
import {
  canonicalJSON,
  extractPlainTextV2,
  tiptapDocToV2,
  toV2,
  v2ToMarkdown,
  type NoteBlocksV2,
  type OrbisBlock,
} from "./block-model";

const v1: NoteBlocks = {
  schema_version: 1,
  editor: "tiptap",
  doc: {
    type: "doc",
    content: [
      { type: "heading", attrs: { level: 2 }, content: [{ type: "text", text: "标题" }] },
      {
        type: "paragraph",
        content: [
          { type: "text", text: "加粗", marks: [{ type: "bold" }] },
          { type: "text", text: "和" },
          { type: "text", text: "链接", marks: [{ type: "link", attrs: { href: "https://orbis.dev" } }] },
        ],
      },
      { type: "bulletList", content: [{ type: "listItem", content: [{ type: "paragraph", content: [{ type: "text", text: "列表项" }] }] }] },
      { type: "taskList", content: [{ type: "taskItem", attrs: { checked: true }, content: [{ type: "paragraph", content: [{ type: "text", text: "待办" }] }] }] },
      { type: "codeBlock", attrs: { language: "ts" }, content: [{ type: "text", text: "const a = 1;" }] },
      { type: "blockquote", content: [{ type: "paragraph", content: [{ type: "text", text: "引用" }] }] },
      { type: "horizontalRule" },
    ],
  },
};

describe("tiptapDocToV2", () => {
  const v2 = tiptapDocToV2(v1.doc);

  it("maps block types to BlockNote types", () => {
    const types = v2.blocks.map((b) => b.type);
    expect(types).toEqual([
      "heading",
      "paragraph",
      "bulletListItem",
      "checkListItem",
      "codeBlock",
      "quote",
      "divider",
    ]);
  });

  it("carries heading level and task checked props", () => {
    expect(v2.blocks[0].props.level).toBe(2);
    expect(v2.blocks[3].props.checked).toBe(true);
  });

  it("converts inline marks and links", () => {
    const para = v2.blocks[1];
    const content = para.content as Array<Record<string, unknown>>;
    expect(content[0]).toMatchObject({ type: "text", text: "加粗", styles: { bold: true } });
    expect(content[2]).toMatchObject({ type: "link", href: "https://orbis.dev" });
  });

  it("keeps code block text and language", () => {
    const code = v2.blocks[4];
    expect(code.props.language).toBe("ts");
    expect(code.content).toBe("const a = 1;");
  });

  it("preserves legacy table structure, rich text, spans, and column widths", () => {
    const converted = tiptapDocToV2({
      type: "doc",
      content: [{
        type: "table",
        content: [
          { type: "tableRow", content: [
            { type: "tableHeader", attrs: { colspan: 2, rowspan: 1, colwidth: [140, 220] }, content: [
              { type: "paragraph", content: [{ type: "text", text: "Header", marks: [{ type: "bold" }] }] },
            ] },
          ] },
          { type: "tableRow", content: [
            { type: "tableCell", attrs: { colspan: 1, rowspan: 1 }, content: [
              { type: "paragraph", content: [{ type: "text", text: "Docs", marks: [{ type: "link", attrs: { href: "https://orbis.dev" } }] }] },
              { type: "bulletList", content: [{ type: "listItem", content: [
                { type: "paragraph", content: [{ type: "text", text: "Nested cell text" }] },
              ] }] },
            ] },
            { type: "tableCell", content: [{ type: "paragraph" }] },
          ] },
        ],
      }],
    });
    expect(converted.blocks).toHaveLength(1);
    expect(converted.blocks[0].type).toBe("table");
    expect(converted.blocks[0].content).toMatchObject({
      type: "tableContent",
      headerRows: 1,
      columnWidths: [140, 220],
      rows: [
        { cells: [{ type: "tableCell", props: { colspan: 2, rowspan: 1 }, content: [{ type: "text", text: "Header", styles: { bold: true } }] }] },
        { cells: [
          { type: "tableCell", content: [
            { type: "link", href: "https://orbis.dev", content: [{ type: "text", text: "Docs" }] },
            { type: "text", text: "\n" },
            { type: "text", text: "- " },
            { type: "text", text: "Nested cell text" },
          ] },
          { type: "tableCell", content: [] },
        ] },
      ],
    });
    expect(extractPlainTextV2(converted.blocks)).toContain("Docs\n- Nested cell text");
  });

  it("preserves a legacy header column", () => {
    const converted = tiptapDocToV2({
      type: "doc", content: [{ type: "table", content: [
        { type: "tableRow", content: [{ type: "tableHeader" }, { type: "tableCell" }] },
        { type: "tableRow", content: [{ type: "tableHeader" }, { type: "tableCell" }] },
      ] }],
    });
    expect(converted.blocks[0].content).toMatchObject({ headerRows: 0, headerCols: 1 });
  });
});

describe("toV2", () => {
  it("passes through v2 and converts v1", () => {
    const v2 = tiptapDocToV2(v1.doc);
    expect(toV2(v2)).toBe(v2);
    expect(toV2(v1).schema_version).toBe(2);
  });

  it("opens stored v2 blocks with omitted defaults at every nesting level", () => {
    const stored: NoteBlocks = {
      schema_version: 2, editor: "blocknote", blocks: [
        { id: "old", type: "paragraph", content: "Legacy paragraph" },
        { id: "parent", type: "paragraph", content: "Parent", children: [
          { id: "nested", type: "heading", content: "Nested heading" },
          { id: "empty", type: "paragraph" },
        ] },
      ],
    };
    const before = JSON.stringify(stored);
    const converted = toV2(stored);
    const editor = BlockNoteEditor.create({ initialContent: converted.blocks as never });
    expect(editor.document[0]).toMatchObject({ id: "old", type: "paragraph" });
    expect(editor.document[1].children[0]).toMatchObject({ id: "nested", type: "heading" });
    expect(extractPlainTextV2(converted.blocks)).toBe("Legacy paragraph\nParent\nNested heading");
    expect(v2ToMarkdown(converted.blocks)).toContain("# Nested heading");
    expect(extractPlainTextV2(editor.document as OrbisBlock[])).toBe("Legacy paragraph\nParent\nNested heading");
    expect(JSON.stringify(stored)).toBe(before);
    expect(toV2(converted)).toBe(converted);
  });

  it("opens legacy two-dimensional tables with the original rows and rich cells", () => {
    const rows = [
      [[{ type: "text", text: "Name", styles: { bold: true } }], [{ type: "text", text: "State" }]],
      [[{ type: "link", href: "https://orbis.dev", content: [{ type: "text", text: "Orbis" }] }], "Ready"],
    ];
    const stored: NoteBlocks = { schema_version: 2, editor: "blocknote", blocks: [{
      id: "old-table", type: "table", props: { textColor: "default" }, content: rows, children: [],
    }] };
    const before = JSON.stringify(stored);
    const converted = toV2(stored);
    const editor = BlockNoteEditor.create({ initialContent: converted.blocks as never });
    expect(editor.document[0]).toMatchObject({ id: "old-table", type: "table", content: {
      type: "tableContent", rows: [{ cells: [expect.anything(), expect.anything()] }, { cells: [expect.anything(), expect.anything()] }],
    } });
    expect(converted.blocks[0].content).toMatchObject({ type: "tableContent", rows: rows.map((cells) => ({ cells })) });
    expect(extractPlainTextV2(editor.document as OrbisBlock[])).toBe("Name\tState\nOrbis\tReady");
    expect(v2ToMarkdown(converted.blocks)).toBe("| **Name** | State |\n| --- | --- |\n| [Orbis](https://orbis.dev) | Ready |");
    expect(extractPlainTextV2(stored.blocks as OrbisBlock[])).toBe("Name\tState\nOrbis\tReady");
    expect(v2ToMarkdown(stored.blocks as OrbisBlock[])).toBe("| **Name** | State |\n| --- | --- |\n| [Orbis](https://orbis.dev) | Ready |");
    expect(JSON.stringify(stored)).toBe(before);
  });

  it.each([
    { content: [], expectedCell: "" },
    { content: "Legacy table", expectedCell: "Legacy table" },
    { content: [{ type: "text" as const, text: "Old cell" }], expectedCell: [{ type: "text", text: "Old cell" }] },
  ])("adapts legacy table content for editing: $content", ({ content, expectedCell }) => {
    const saved: NoteBlocksV2 = {
      schema_version: 2, editor: "blocknote", blocks: [{
        id: "parent", type: "paragraph", props: {}, content: [], children: [{
          id: "legacy-table", type: "table", props: { textColor: "default" }, content, children: [],
        }],
      }],
    };
    const before = JSON.stringify(saved);
    const converted = toV2(saved);
    expect(converted.blocks[0].children[0]).toMatchObject({
      id: "legacy-table", type: "table", props: { textColor: "default" },
      content: { type: "tableContent", rows: [{ cells: [expectedCell] }] },
    });
    expect(JSON.stringify(saved)).toBe(before);
    expect(toV2(converted)).toBe(converted);
  });

  it.each([
    { schema_version: 1, editor: "tiptap", doc: { type: "doc", content: [{ type: "table" }] } },
    { schema_version: 2, editor: "blocknote", blocks: [{ id: "empty-table", type: "table", props: {}, content: { type: "tableContent", rows: [] }, children: [] }] },
    { schema_version: 2, editor: "blocknote", blocks: [{ id: "empty-row", type: "table", props: {}, content: { type: "tableContent", rows: [{ cells: [] }] }, children: [] }] },
  ])("opens a stored empty table in the actual editor: $editor", (stored) => {
    const blocks = toV2(stored as NoteBlocks | NoteBlocksV2).blocks;
    const editor = BlockNoteEditor.create({ initialContent: blocks as never });
    expect(editor.document[0].type).toBe("table");
    expect(extractPlainTextV2(editor.document as OrbisBlock[])).toBe("");
  });
});

describe("extractPlainTextV2 / v2ToMarkdown", () => {
  const v2 = tiptapDocToV2(v1.doc);

  it("extracts plain text across blocks", () => {
    const text = extractPlainTextV2(v2.blocks);
    expect(text).toContain("标题");
    expect(text).toContain("加粗和链接");
    expect(text).toContain("const a = 1;");
  });

  it("renders markdown for the main block types", () => {
    const md = v2ToMarkdown(v2.blocks);
    expect(md).toContain("## 标题");
    expect(md).toContain("**加粗**");
    expect(md).toContain("[链接](https://orbis.dev)");
    expect(md).toContain("- 列表项");
    expect(md).toContain("- [x] 待办");
    expect(md).toContain("```ts");
    expect(md).toContain("> 引用");
    expect(md).toContain("---");
  });
  it("extracts and exports native BlockNote table and code content", () => {
    const blocks = [
      {
        id: "table-1",
        type: "table",
        props: { textColor: "default" },
        content: {
          type: "tableContent",
          headerRows: 1,
          rows: [
            { cells: ["块类型", "状态"] },
            { cells: ["表格", "待验收"] },
          ],
        },
        children: [],
      },
      {
        id: "code-1",
        type: "codeBlock",
        props: { language: "typescript" },
        content: [{ type: "text", text: "const ready = true;", styles: {} }],
        children: [],
      },
    ];

    expect(() => extractPlainTextV2(blocks as never)).not.toThrow();
    expect(extractPlainTextV2(blocks as never)).toContain("块类型\t状态\n表格\t待验收");
    const markdown = v2ToMarkdown(blocks as never);
    expect(markdown).toContain("| 块类型 | 状态 |");
    expect(markdown).toContain("```typescript\nconst ready = true;\n```");
  });

  it("exports native inline code content without object coercion", () => {
    expect(v2ToMarkdown([{
      id: "code", type: "codeBlock", props: { language: "typescript" },
      content: [{ type: "text", text: "const ready = true;", styles: {} }], children: [],
    }])).toBe("```typescript\nconst ready = true;\n```");
  });

  it.each([
    { content: [], expected: "" },
    { content: "Legacy table", expected: "Legacy table" },
    { content: [{ type: "text", text: "Old cell" }], expected: "Old cell" },
  ])("keeps legacy table content readable: $content", ({ content, expected }) => {
    const blocks = [{ id: "legacy-table", type: "table", props: {}, content, children: [] }];
    expect(extractPlainTextV2(blocks as never)).toBe(expected);
    expect(v2ToMarkdown(blocks as never)).toBe(expected);
  });

  it("renders rich native cells, escapes pipes, preserves line breaks, and pads short rows", () => {
    const blocks = [{ id: "table", type: "table", props: {}, children: [], content: {
      type: "tableContent", headerRows: 1,
      rows: [
        { cells: ["Name", [{ type: "text", text: "Value", styles: { bold: true } }]] },
        { cells: [{ type: "tableCell", props: {}, content: [{ type: "link", href: "https://orbis.dev", content: [
          { type: "text", text: "Docs|API\nnext", styles: { italic: true } },
        ] }] }] },
        { cells: [{ type: "tableCell", content: "Partial cell" }, "Ready"] },
      ],
    } }];
    expect(extractPlainTextV2(blocks as never)).toBe("Name\tValue\nDocs|API\nnext\nPartial cell\tReady");
    expect(v2ToMarkdown(blocks as never)).toBe(
      "| Name | **Value** |\n| --- | --- |\n| [*Docs\\|API<br>next*](https://orbis.dev) |  |\n| Partial cell | Ready |",
    );
  });

  it("accepts empty native tables without losing following blocks", () => {
    const blocks = [
      { id: "table", type: "table", props: {}, content: { type: "tableContent", rows: [] }, children: [] },
      { id: "paragraph", type: "paragraph", props: {}, content: "After the table", children: [] },
    ];
    expect(extractPlainTextV2(blocks as never)).toBe("After the table");
    expect(v2ToMarkdown(blocks as never)).toBe("After the table");
  });

  it("keeps string labels from partial native links", () => {
    const blocks = [{
      id: "table", type: "table", props: {}, children: [], content: {
        type: "tableContent", rows: [{ cells: [[{ type: "link", href: "https://orbis.dev", content: "Docs" }]] }],
      },
    }];
    expect(extractPlainTextV2(blocks as never)).toBe("Docs");
    expect(v2ToMarkdown(blocks as never)).toContain("[Docs](https://orbis.dev)");
  });
});

describe("canonicalJSON", () => {
  it("treats JSONB key reordering as equal", () => {
    const fromEditor = [
      { id: "b1", type: "paragraph", props: { level: 1, textColor: "default" }, content: [{ type: "text", text: "正文", styles: { bold: true } }], children: [] },
    ];
    // Postgres JSONB stores object keys sorted by length, then alphabetically —
    // the server round-trip reorders every object but changes nothing.
    const fromServer = JSON.parse(
      `[{"children":[],"content":[{"styles":{"bold":true},"text":"正文","type":"text"}],"props":{"level":1,"textColor":"default"},"id":"b1","type":"paragraph"}]`,
    );
    expect(JSON.stringify(fromEditor)).not.toBe(JSON.stringify(fromServer));
    expect(canonicalJSON(fromEditor)).toBe(canonicalJSON(fromServer));
  });

  it("keeps array order significant and detects real changes", () => {
    const a = [{ id: "1", type: "paragraph" }, { id: "2", type: "heading" }];
    const reordered = [{ id: "2", type: "heading" }, { id: "1", type: "paragraph" }];
    expect(canonicalJSON(a)).not.toBe(canonicalJSON(reordered));
    const edited = [{ id: "1", type: "paragraph" }, { id: "2", type: "heading", props: { level: 2 } }];
    expect(canonicalJSON(a)).not.toBe(canonicalJSON(edited));
  });
});

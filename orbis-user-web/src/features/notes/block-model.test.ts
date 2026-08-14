import { describe, expect, it } from "vitest";

import type { NoteBlocks } from "../../shared/api/schemas";
import {
  canonicalJSON,
  extractPlainTextV2,
  tiptapDocToV2,
  toV2,
  v2ToMarkdown,
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
});

describe("toV2", () => {
  it("passes through v2 and converts v1", () => {
    const v2 = tiptapDocToV2(v1.doc);
    expect(toV2(v2)).toBe(v2);
    expect(toV2(v1).schema_version).toBe(2);
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

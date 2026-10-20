import { describe, expect, it } from "vitest";
import { marked } from "marked";

import { markdownToTiptapDoc, tiptapDocToMarkdown } from "./markdown";
import { extractPlainText } from "./tiptap-document";

describe("markdown contract", () => {
  it("preserves unsupported authored syntax and hard breaks while parsing supported blocks", () => {
    const doc = markdownToTiptapDoc('# Title\n\n<div data-unknown="widget">Keep HTML</div>\n\nInline <kbd>Ctrl</kbd> ![](chart.svg "Image title") and [Guide](https://example.com "Link title").\n\nFirst  \nSecond');
    expect(doc.content?.[1]).toMatchObject({ type: "paragraph", content: [{ text: expect.stringContaining('<div data-unknown="widget">Keep HTML</div>') }] });
    const text = extractPlainText(doc);
    expect(text).toContain("<kbd>");
    expect(text).toContain('![](chart.svg "Image title")');
    expect(text).toContain('[Guide](https://example.com "Link title")');
    expect(doc.content?.at(-1)?.content).toContainEqual({ type: "hardBreak" });
    expect(tiptapDocToMarkdown(doc)).toContain("First  \nSecond");
  });

  it("keeps mixed task items, higher headings and table alignment", () => {
    const doc = markdownToTiptapDoc('###### Deep heading\n\n- Plain\n- [x] Done\n- [ ] Pending\n- Last\n\n| Left | Right |\n| :--- | ---: |\n| A | B |');
    expect(doc.content?.map(node => node.type)).toEqual(["heading", "bulletList", "taskList", "bulletList", "table"]);
    expect(doc.content?.[0].attrs?.level).toBe(6);
    expect(doc.content?.[2].content?.map(item => item.attrs?.checked)).toEqual([true, false]);
    expect(doc.content?.at(-1)?.content?.[0].content?.map(cell => cell.attrs?.orbisCellProps)).toEqual([{ textAlignment: "left" }, { textAlignment: "right" }]);
  });

  it("preserves unsupported destinations as literal Markdown while rendering supported links", () => {
    const doc = markdownToTiptapDoc("# Links\n\n[Relative](./guide.md) [Anchor](#section) [Unsafe](javascript:alert(1)) [Web](https://example.com/guide) [Mail](mailto:help@example.com)");
    const text = extractPlainText(doc);
    expect(text).toContain("[Relative](./guide.md)");
    expect(text).toContain("[Anchor](#section)");
    expect(text).toContain("[Unsafe](javascript:alert(1))");
    const links = doc.content?.[1].content?.flatMap(node => (node.marks ?? []).filter(mark => mark.type === "link").map(mark => mark.attrs?.href));
    expect(links).toEqual(["https://example.com/guide", "mailto:help@example.com"]);
  });

  it("exports legacy ordered-list starts with nested numbering and continuation paragraphs", () => {
    const paragraph = (text: string) => ({ type: "paragraph", content: [{ type: "text", text }] });
    const markdown = tiptapDocToMarkdown({ type: "doc", content: [{ type: "orderedList", attrs: { start: 7 }, content: [
      { type: "listItem", content: [paragraph("Seven"), paragraph("Continuation"),
        { type: "orderedList", attrs: { start: 3 }, content: [
          { type: "listItem", content: [paragraph("Nested three")] }, { type: "listItem", content: [paragraph("Nested four")] },
        ] },
      ] }, { type: "listItem", content: [paragraph("Eight")] },
    ] }] });
    const result = document.createElement("div");
    result.innerHTML = marked.parse(markdown, { async: false });
    expect(Array.from(result.querySelectorAll("ol"), (list) => list.start)).toEqual([7, 3]);
    expect(result.querySelector("ol")?.children).toHaveLength(2);
    expect(result).toHaveTextContent("Continuation");
    expect(markdown).toMatch(/^8\. Eight$/m);
    const imported = markdownToTiptapDoc(markdown);
    expect(imported.content![0].attrs).toEqual({ start: 7 });
    expect(imported.content![0].content![0].content).toMatchObject([
      paragraph("Seven"), paragraph("Continuation"), { type: "orderedList", attrs: { start: 3 } },
    ]);
  });

  it("parses supported Markdown blocks into Tiptap JSON", () => {
    const doc = markdownToTiptapDoc(`# Orbis Notes

Paragraph with **bold**, *italic*, ~~deleted~~, \`code\`, and [link](https://example.com).

- [x] Capture source
- [ ] Review memory

| Source | Decision |
| --- | --- |
| Meeting | Ship MVP |

> Keep original context

\`\`\`ts
const ok = true
\`\`\`

---`);

    expect(doc).toMatchObject({
      type: "doc",
      content: [
        { type: "heading", attrs: { level: 1 } },
        { type: "paragraph" },
        {
          type: "taskList",
          content: [
            { type: "taskItem", attrs: { checked: true } },
            { type: "taskItem", attrs: { checked: false } },
          ],
        },
        {
          type: "table",
          content: [
            { type: "tableRow", content: [{ type: "tableHeader" }, { type: "tableHeader" }] },
            { type: "tableRow", content: [{ type: "tableCell" }, { type: "tableCell" }] },
          ],
        },
        { type: "blockquote" },
        { type: "codeBlock", attrs: { language: "ts" } },
        { type: "horizontalRule" },
      ],
    });

    const paragraph = doc.content?.[1];
    expect(paragraph?.content).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ text: "bold", marks: [expect.objectContaining({ type: "bold" })] }),
        expect.objectContaining({ text: "italic", marks: [expect.objectContaining({ type: "italic" })] }),
        expect.objectContaining({ text: "deleted", marks: [expect.objectContaining({ type: "strike" })] }),
        expect.objectContaining({ text: "code", marks: [expect.objectContaining({ type: "code" })] }),
        expect.objectContaining({
          text: "link",
          marks: [expect.objectContaining({ type: "link", attrs: expect.objectContaining({ href: "https://example.com" }) })],
        }),
      ]),
    );
  });

  it("serializes supported Tiptap blocks to Markdown", () => {
    const markdown = tiptapDocToMarkdown({
      type: "doc",
      content: [
        {
          type: "heading",
          attrs: { level: 2 },
          content: [{ type: "text", text: "下一步" }],
        },
        {
          type: "taskList",
          content: [
            {
              type: "taskItem",
              attrs: { checked: true },
              content: [{ type: "paragraph", content: [{ type: "text", text: "完成块能力" }] }],
            },
          ],
        },
        {
          type: "table",
          content: [
            {
              type: "tableRow",
              content: [
                { type: "tableHeader", content: [{ type: "paragraph", content: [{ type: "text", text: "来源" }] }] },
                { type: "tableHeader", content: [{ type: "paragraph", content: [{ type: "text", text: "结论" }] }] },
              ],
            },
            {
              type: "tableRow",
              content: [
                { type: "tableCell", content: [{ type: "paragraph", content: [{ type: "text", text: "会议" }] }] },
                { type: "tableCell", content: [{ type: "paragraph", content: [{ type: "text", text: "发布" }] }] },
              ],
            },
          ],
        },
      ],
    });

    expect(markdown).toBe("## 下一步\n\n- [x] 完成块能力\n\n| 来源 | 结论 |\n| --- | --- |\n| 会议 | 发布 |");
  });
});

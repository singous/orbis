import { describe, expect, it } from "vitest";

import { markdownToTiptapDoc, tiptapDocToMarkdown } from "./markdown-contract";

describe("markdown contract", () => {
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

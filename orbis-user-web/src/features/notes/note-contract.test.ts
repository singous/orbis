import { describe, expect, it } from "vitest";
import type { JSONContent } from "@tiptap/react";

import { createEmptyNoteBlocks, extractPlainText, toNoteBlocks } from "./note-contract";

describe("note contract", () => {
  it("creates an empty Tiptap note envelope accepted by the backend", () => {
    const blocks = createEmptyNoteBlocks();

    expect(blocks).toEqual({
      schema_version: 1,
      editor: "tiptap",
      doc: {
        type: "doc",
        content: [{ type: "paragraph" }],
      },
    });
  });

  it("extracts plain text from rich Tiptap blocks", () => {
    const plainText = extractPlainText({
      type: "doc",
      content: [
        {
          type: "heading",
          attrs: { level: 2 },
          content: [{ type: "text", text: "Project notes" }],
        },
        {
          type: "bulletList",
          content: [
            {
              type: "listItem",
              content: [
                {
                  type: "paragraph",
                  content: [{ type: "text", text: "Capture the first workflow" }],
                },
              ],
            },
          ],
        },
        {
          type: "blockquote",
          content: [
            {
              type: "paragraph",
              content: [{ type: "text", text: "Keep the original context" }],
            },
          ],
        },
        {
          type: "codeBlock",
          content: [{ type: "text", text: "expected_version" }],
        },
      ],
    });

    expect(plainText).toBe(
      "Project notes\nCapture the first workflow\nKeep the original context\nexpected_version",
    );
  });

  it("wraps an editor document in a stable note blocks envelope", () => {
    const blocks = toNoteBlocks({
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [{ type: "text", text: "Hello Orbis" }],
        },
      ],
    });

    expect(blocks.editor).toBe("tiptap");
    expect(blocks.schema_version).toBe(1);
    const doc = blocks.doc as JSONContent;
    expect(doc.content?.[0]?.content?.[0]?.text).toBe("Hello Orbis");
  });
});

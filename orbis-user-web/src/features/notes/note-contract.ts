import type { JSONContent } from "@tiptap/react";

import type { NoteBlocks } from "../../shared/api/schemas";

export type TiptapDocument = JSONContent & {
  type: "doc";
};

export function createEmptyTiptapDoc(): TiptapDocument {
  return {
    type: "doc",
    content: [{ type: "paragraph" }],
  };
}

export function createEmptyNoteBlocks(): NoteBlocks {
  return toNoteBlocks(createEmptyTiptapDoc());
}

export function toNoteBlocks(doc: TiptapDocument): NoteBlocks {
  return {
    schema_version: 1,
    editor: "tiptap",
    doc,
  };
}

function inlineText(node: JSONContent): string {
  if (node.type === "text") {
    return node.text ?? "";
  }
  return node.content?.map(inlineText).join("") ?? "";
}

function collectLines(node: JSONContent): string[] {
  if (node.type === "paragraph" || node.type === "heading" || node.type === "codeBlock") {
    const text = inlineText(node).trim();
    return text ? [text] : [];
  }

  if (!node.content) {
    const text = inlineText(node).trim();
    return text ? [text] : [];
  }

  return node.content.flatMap(collectLines);
}

export function extractPlainText(doc: TiptapDocument | JSONContent): string {
  return collectLines(doc).join("\n");
}

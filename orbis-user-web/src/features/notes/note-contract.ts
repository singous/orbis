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

function collectTableRow(node: JSONContent): string {
  return (
    node.content
      ?.map((cell) => collectLines(cell).join(" "))
      .map((cellText) => cellText.trim())
      .join("\t") ?? ""
  );
}

function collectLines(node: JSONContent): string[] {
  if (node.type === "paragraph" || node.type === "heading" || node.type === "codeBlock") {
    const text = inlineText(node).trim();
    return text ? [text] : [];
  }

  if (node.type === "tableRow") {
    const text = collectTableRow(node).trim();
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

import { Editor } from "@tiptap/core";
import { afterEach, expect, it } from "vitest";
import type { NoteBlocks } from "../../src/shared/api/schemas";
import { normalizeEditorBlocks } from "../../src/features/documents/editor-blocks";
import { executeBlockCommand, locateEditorBlocks } from "../../src/features/notes/blocks/block-commands";
import { indexBlocks } from "../../src/features/notes/blocks/block-tree";
import { tiptapExtensions } from "../../src/features/notes/tiptap-extensions";
import { fromTiptapDocument, toTiptapDocument } from "../../src/features/notes/tiptap-model";

const legacy: NoteBlocks = { schema_version: 1, doc: { type: "doc", content: [
  { type: "paragraph", content: [{ type: "text", text: "First" }] },
  { type: "bulletList", content: [{ type: "listItem", content: [{ type: "paragraph", content: [{ type: "text", text: "Nested" }] }, { type: "paragraph", content: [{ type: "text", text: "Child" }] }] }] },
] } };
const editors: Editor[] = [];
afterEach(() => editors.splice(0).forEach((editor) => editor.destroy()));

it("gives a legacy document stable scoped block link targets on every readonly load", () => {
  const first = normalizeEditorBlocks("note-a", legacy);
  const second = normalizeEditorBlocks("note-a", structuredClone(legacy));
  expect(second).toEqual(first);
  const firstIds = [...indexBlocks(first.blocks).keys()];
  expect(new Set(firstIds).size).toBe(3);
  expect(firstIds.every((id) => /^[A-Za-z0-9_-]+$/.test(id))).toBe(true);
  expect([...indexBlocks(normalizeEditorBlocks("note-b", legacy).blocks).keys()]).not.toEqual(firstIds);
  const editor = new Editor({ extensions: tiptapExtensions, content: toTiptapDocument(second), editable: false });
  editors.push(editor);
  expect(locateEditorBlocks(editor.state.doc).map(({ id }) => id)).toEqual(firstIds);
});

it("preserves existing v2 identities and does not rewrite the document on hydration", () => {
  const value = normalizeEditorBlocks("note-a", legacy);
  const hydrated = normalizeEditorBlocks("note-a", value);
  expect(hydrated).toBe(value);
  expect(hydrated.blocks[0].id).toBe(value.blocks[0].id);
});

it("keeps assigned legacy identities after editing, moving and saving as v2", () => {
  const value = normalizeEditorBlocks("note-a", legacy);
  const originalIds = [...indexBlocks(value.blocks).keys()];
  const editor = new Editor({ extensions: tiptapExtensions, content: toTiptapDocument(value) });
  editors.push(editor);
  editor.commands.insertContentAt(2, "edited ");
  expect(executeBlockCommand(editor, [originalIds[0]], { type: "move", targetId: originalIds[1], placement: "after" }).ok).toBe(true);
  const saved = fromTiptapDocument(editor.state.doc);
  const reloaded = normalizeEditorBlocks("note-a", JSON.parse(JSON.stringify(saved)));
  expect([...indexBlocks(reloaded.blocks).keys()].sort()).toEqual([...originalIds].sort());
  expect(reloaded.blocks.at(-1)!.id).toBe(originalIds[0]);
  expect(JSON.stringify(reloaded)).toContain("edited");
});

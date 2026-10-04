import { expect, it, vi } from "vitest";
import { createEditorDraftFingerprint, type EditorDraft } from "../../src/features/documents/editor-draft";
import { EditorOutlineStore } from "../../src/features/documents/EditorLayout";
import { AutosaveCoordinator } from "../../src/features/documents/autosave";
import type { OrbisBlock } from "../../src/features/notes/block-model";

const paragraph = (id: string, text = "body"): OrbisBlock => ({ id, type: "paragraph", props: {}, content: [{ type: "text", text }], children: [] });
const draft = (blocks: OrbisBlock[]): EditorDraft => ({ title: "Title", blocks: { schema_version: 2, editor: "blocknote", blocks }, version: 1 });

it("reuses immutable block signatures while detecting edits, undo and unknown stored fields", () => {
  const read = vi.fn(() => "preserved");
  const untouched = { ...paragraph("second"), props: { get customProperty() { return read(); } } };
  const saved = draft([paragraph("first"), untouched]);
  const fingerprint = createEditorDraftFingerprint();
  const original = fingerprint(saved);
  read.mockClear();
  expect(fingerprint(draft([paragraph("first", "changed"), untouched]))).not.toBe(original);
  expect(read).not.toHaveBeenCalled();
  expect(fingerprint(draft([paragraph("first"), untouched]))).toBe(original);
  expect(fingerprint({ ...saved, title: " Title ", version: 42 })).toBe(original);
  expect(fingerprint(draft([paragraph("first"), { ...untouched, props: { customProperty: "new" } }]))).not.toBe(original);
});

it("compares JSONB key ordering equally and preserves nested content changes", () => {
  const fingerprint = createEditorDraftFingerprint();
  const first = draft([{ ...paragraph("p"), props: { alpha: 1, beta: 2 }, children: [paragraph("nested")] }]);
  const reordered = draft([{ ...first.blocks.blocks[0], props: { beta: 2, alpha: 1 } }]);
  expect(fingerprint(reordered)).toBe(fingerprint(first));
  expect(fingerprint(draft([{ ...first.blocks.blocks[0], children: [paragraph("nested", "new")] }]))).not.toBe(fingerprint(first));
});

it("does not recompute saved fingerprints on every input and skips saving an undone edit", async () => {
  const fingerprint = vi.fn(createEditorDraftFingerprint());
  const save = vi.fn(async (value: EditorDraft) => value);
  const coordinator = new AutosaveCoordinator({ delayMs: 750, fingerprint, save });
  const saved = draft([paragraph("p")]);
  coordinator.hydrate(saved);
  coordinator.change(draft([paragraph("p", "edit")]));
  expect(fingerprint).toHaveBeenCalledTimes(2);
  coordinator.change(draft([paragraph("p")]));
  await coordinator.flush();
  expect(coordinator.state).toBe("saved");
  expect(save).not.toHaveBeenCalled();
  expect(fingerprint).toHaveBeenCalledTimes(3);
  coordinator.dispose();
});

it("does not notify outline subscribers for body edits and keeps stable heading IDs", () => {
  const outline = new EditorOutlineStore();
  const heading = { ...paragraph("heading", "Chapter"), type: "heading", props: { level: 2 } };
  outline.update(draft([heading, paragraph("p")]).blocks);
  const initial = outline.snapshot();
  const changed = vi.fn();
  outline.subscribe(changed);
  outline.update(draft([heading, paragraph("p", "Body changed")]).blocks);
  expect(changed).not.toHaveBeenCalled();
  expect(outline.snapshot()).toBe(initial);
  outline.update(draft([{ ...heading, content: [{ type: "text", text: "Renamed" }] }]).blocks);
  expect(changed).toHaveBeenCalledOnce();
  expect(outline.snapshot()).toEqual([{ id: "heading", text: "Renamed", level: 2 }]);
});

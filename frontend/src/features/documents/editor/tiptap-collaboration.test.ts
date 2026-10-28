import { Editor, getSchema } from "@tiptap/core";
import { GapCursor } from "@tiptap/pm/gapcursor";
import * as Y from "yjs";
import { prosemirrorJSONToYDoc } from "y-prosemirror";
import { afterEach, expect, it } from "vitest";
import { collaborativeEditorExtensions } from "./TiptapEditor";
import { tiptapExtensions } from "./tiptap-extensions";
import { fromTiptapDocument, toTiptapDocument } from "./tiptap-model";
import type { OrbisBlock, NoteBlocksV2 } from "../../content/blocks";
import { blockSelectionKey } from "./blocks/block-selection";
import { BLOCK_CLIPBOARD_MIME, installBlockClipboard, parseBlockClipboard } from "./blocks/block-clipboard";
import { nativeBlock } from "../../content/codecs/api-content";

const paragraphId = "00000000-0000-4000-8000-000000000001";
const editors: Editor[] = [], documents: Y.Doc[] = [];
afterEach(() => { for (const editor of editors.splice(0)) editor.destroy(); for (const doc of documents.splice(0)) doc.destroy(); });
function seed() {
  const schemaDoc = new Y.Doc();
  const schema = getSchema(collaborativeEditorExtensions(schemaDoc));
  const doc = prosemirrorJSONToYDoc(schema, toTiptapDocument({ schema_version: 2, editor: "blocknote", blocks: [{ id: paragraphId, type: "paragraph", props: {}, content: [{ type: "text", text: "Base", styles: {} }], children: [] }] }, { cacheMetadata: false }), "body");
  documents.push(doc); schemaDoc.destroy(); return doc;
}
function open(doc: Y.Doc) { const editor = new Editor({ extensions: collaborativeEditorExtensions(doc) }); editors.push(editor); return editor; }

it("keeps a selected terminal board through a remote attribute update", () => {
  const doc = seed(), editor = open(doc);
  editor.commands.insertContentAt(editor.state.doc.content.size, { type: "orbisBoard", attrs: { orbisId: "board", orbisProps: { board_id: paragraphId } } });
  editor.commands.setNodeSelection(editor.state.doc.content.size - 1);
  expect(editor.state.selection).toBeInstanceOf(GapCursor);
  const remote = new Y.Doc(); documents.push(remote);
  Y.applyUpdate(remote, Y.encodeStateAsUpdate(doc));
  (remote.getXmlFragment("body").get(1) as Y.XmlElement).setAttribute("orbisProps", { board_id: paragraphId, mode: "live" } as never);
  expect(() => Y.applyUpdate(doc, Y.encodeStateAsUpdate(remote))).not.toThrow();
  expect(editor.state.doc.lastChild?.type.name).toBe("orbisBoard");
});

it("restores a valid selection when a peer removes a selected terminal board", () => {
  const doc = seed(), editor = open(doc);
  editor.commands.insertContentAt(editor.state.doc.content.size, { type: "orbisBoard", attrs: { orbisId: "board" } });
  editor.commands.setNodeSelection(editor.state.doc.content.size - 1);
  const remote = new Y.Doc(); documents.push(remote);
  Y.applyUpdate(remote, Y.encodeStateAsUpdate(doc));
  remote.getXmlFragment("body").delete(1, 1);
  expect(() => Y.applyUpdate(doc, Y.encodeStateAsUpdate(remote))).not.toThrow();
  expect(editor.state.doc.lastChild?.type.name).toBe("paragraph");
});

it("types a space after a selected board without replacing it", () => {
  const editor = open(seed());
  editor.commands.setContent({ type: "doc", content: [{ type: "orbisBoard", attrs: { orbisId: paragraphId } }] });
  editor.commands.setNodeSelection(0);
  const event = new KeyboardEvent("keydown", { key: " ", code: "Space", bubbles: true, cancelable: true });
  editor.view.dom.dispatchEvent(event);
  expect(editor.state.doc.firstChild?.type.name).toBe("orbisBoard");
  expect(editor.state.doc.lastChild?.textContent).toBe(" ");
  expect(editor.state.selection.$from.parent.type.name).toBe("paragraph");
});

it("merges concurrent same-paragraph typing and keeps undo local to each editor", () => {
  const initial = seed(), left = new Y.Doc(), right = new Y.Doc();
  documents.push(left, right);
  Y.applyUpdate(left, Y.encodeStateAsUpdate(initial)); Y.applyUpdate(right, Y.encodeStateAsUpdate(initial));
  const a = open(left), b = open(right);
  a.commands.insertContentAt(5, " left"); b.commands.insertContentAt(5, " right");
  Y.applyUpdate(left, Y.encodeStateAsUpdate(right)); Y.applyUpdate(right, Y.encodeStateAsUpdate(left));
  expect(a.getText()).toBe(b.getText());
  expect(a.getText()).toContain(" left"); expect(a.getText()).toContain(" right");
  expect(fromTiptapDocument(a.state.doc).blocks[0].id).toBe(paragraphId);
  a.commands.undo();
  Y.applyUpdate(right, Y.encodeStateAsUpdate(left));
  expect(a.getText()).toBe("Base right"); expect(b.getText()).toBe("Base right");
});

it("keeps a paste separate from typing before and after it in collaborative undo", () => {
  const doc = seed(), editor = open(doc);
  editor.commands.insertContentAt(5, " before");
  editor.view.dispatch(editor.state.tr.insertText(" paste", editor.state.doc.content.size - 1).setMeta("uiEvent", "paste"));
  editor.commands.insertContentAt(editor.state.doc.content.size - 1, " after");
  editor.commands.undo(); expect(editor.getText()).toBe("Base before paste");
  editor.commands.undo(); expect(editor.getText()).toBe("Base before");
  editor.commands.undo(); expect(editor.getText()).toBe("Base");
});

it("assigns a stable block ID on the first edit of an empty collaborative body without reseeding", async () => {
  const doc = new Y.Doc(); documents.push(doc);
  let updates = 0; doc.on("update", () => { updates++; });
  const editor = open(doc);
  await new Promise<void>(resolve => editor.on("create", () => resolve()));
  expect(updates).toBe(0);
  expect(doc.getXmlFragment("body").length).toBe(0);
  editor.commands.insertContent("First paragraph");
  const block = fromTiptapDocument(editor.state.doc).blocks[0];
  expect(block.id).toMatch(/^[0-9a-f-]{36}$/);
  expect((doc.getXmlFragment("body").get(0) as Y.XmlElement).getAttribute("orbisId")).toBe(block.id);
  const restored = new Y.Doc(); documents.push(restored); Y.applyUpdate(restored, Y.encodeStateAsUpdate(doc));
  const reopened = open(restored);
  expect(reopened.getText()).toBe("First paragraph");
  expect(restored.getXmlFragment("body").length).toBe(1);
  expect(fromTiptapDocument(reopened.state.doc).blocks[0].id).toBe(block.id);
});

it("keeps transient conversion caches out of every collaborative node and mark", () => {
  const doc = new Y.Doc(); documents.push(doc);
  const schema = getSchema(collaborativeEditorExtensions(doc));
  for (const type of [...Object.values(schema.nodes), ...Object.values(schema.marks)]) for (const name of ["orbisOriginal", "orbisSignature", "orbisCellOriginal"]) expect(type.spec.attrs ?? {}).not.toHaveProperty(name);
  expect(getSchema(tiptapExtensions).nodes.paragraph.spec.attrs).toHaveProperty("orbisOriginal");
});

it("round-trips a deeply nested large document without duplicating ancestor content in Yjs", () => {
  let block: OrbisBlock = { id: paragraphId, type: "paragraph", props: {}, content: [{ type: "text", text: "Large paragraph ".repeat(8192), styles: {} }], children: [] };
  for (let depth = 1; depth < 32; depth++) block = { id: `00000000-0000-4000-8000-${String(depth + 1).padStart(12, "0")}`, type: "group", props: {}, content: [], children: [block] };
  const value: NoteBlocksV2 = { schema_version: 2, editor: "blocknote", blocks: [block] };
  const schemaDoc = new Y.Doc(); documents.push(schemaDoc);
  const doc = prosemirrorJSONToYDoc(getSchema(collaborativeEditorExtensions(schemaDoc)), toTiptapDocument(value, { cacheMetadata: false }), "body"); documents.push(doc);
  const editor = open(doc);
  expect(fromTiptapDocument(editor.state.doc).blocks.map(nativeBlock)).toEqual(value.blocks.map(nativeBlock));
  expect(Y.encodeStateAsUpdate(doc).byteLength).toBeLessThan(JSON.stringify(value).length * 1.5);
});

const selectedBoard = (id: string) => ({ type: "orbisBoard", attrs: { orbisId: id, orbisProps: { board_id: paragraphId, page_id: paragraphId, mode: "live", revision: null, frame_id: null } } });

it.each(["copy", "cut"])("preserves %s for a keyboard-selected collaborative board", (type) => {
  const editor = open(seed());
  const position = editor.state.doc.content.size;
  editor.commands.insertContentAt(position, selectedBoard("selected-board"));
  editor.commands.setNodeSelection(position);
  expect(editor.state.selection).toBeInstanceOf(GapCursor);
  expect(blockSelectionKey.getState(editor.state)?.ids).toEqual(["selected-board"]);
  const original = editor.state.doc;
  const values = new Map<string, string>();
  const event = new Event(type, { bubbles: true, cancelable: true });
  Object.defineProperty(event, "clipboardData", { value: { getData: (key: string) => values.get(key) ?? "", setData: (key: string, value: string) => values.set(key, value) } });
  let outcome: unknown;
  const stop = installBlockClipboard(editor, result => { outcome = result; });
  try { editor.view.dom.dispatchEvent(event); } finally { stop(); }
  expect(event.defaultPrevented).toBe(true);
  expect(outcome).toMatchObject({ ok: true });
  expect(parseBlockClipboard(values.get(BLOCK_CLIPBOARD_MIME)!)?.blocks).toMatchObject([{ id: "selected-board", type: "board", props: { board_id: paragraphId, page_id: paragraphId } }]);
  if (type === "copy") expect(editor.state.doc.eq(original)).toBe(true);
  else expect(fromTiptapDocument(editor.state.doc).blocks.some(block => block.id === "selected-board")).toBe(false);
});

it.each(["Backspace", "Delete"])("keeps directional %s behavior at a genuine gap between boards", key => {
  const editor = open(seed());
  const first = editor.state.doc.content.size;
  editor.commands.insertContentAt(first, [selectedBoard("previous-board"), selectedBoard("following-board")]);
  const between = first + 1;
  // Selecting a board first also verifies that moving to an ordinary gap
  // clears the converted selection and its clipboard block IDs.
  editor.commands.setNodeSelection(between);
  editor.view.dispatch(editor.state.tr.setSelection(new GapCursor(editor.state.doc.resolve(between))));
  expect(blockSelectionKey.getState(editor.state)?.ids).toEqual([]);
  editor.view.dom.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }));
  const retained = key === "Backspace" ? "following-board" : "previous-board";
  expect(fromTiptapDocument(editor.state.doc).blocks.some(block => block.id === retained)).toBe(true);
  editor.view.dom.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }));
  const ids = fromTiptapDocument(editor.state.doc).blocks.map(block => block.id);
  expect(ids).toContain(retained);
  expect(ids).not.toContain(key === "Backspace" ? "previous-board" : "following-board");
});

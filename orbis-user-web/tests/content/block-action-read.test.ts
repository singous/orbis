import { afterEach, expect, it, vi } from "vitest";
import { Editor } from "@tiptap/core";
import { tiptapExtensions } from "../../src/features/notes/tiptap-extensions";
import { OrbisBlockSelection } from "../../src/features/notes/blocks/block-selection";
import { blockActionNeedsRead, prepareBlockAction, registerBlockActionReader, selectedBlocksNeedRead } from "../../src/features/notes/blocks/block-action-read";
import { copyBlocks, parseBlockClipboard } from "../../src/features/notes/blocks/block-clipboard";
import { executeBlockCommand } from "../../src/features/notes/blocks/block-commands";
import { fromTiptapDocument, toTiptapDocument } from "../../src/features/notes/tiptap-model";
import type { OrbisBlock } from "../../src/features/notes/block-model";
import type { BlockLoadState } from "../../src/features/documents/content-window";

const editors: Editor[] = [];
const cleanups: Array<() => void> = [];
const originalExecCommand = Object.getOwnPropertyDescriptor(document, "execCommand");
const paragraph = (id: string): OrbisBlock => ({ id, type: "paragraph", props: {}, content: [{ type: "text", text: id, styles: { bold: true } }], children: [] });
function open(type = "card") {
  const parent: OrbisBlock = { id: "parent", type, props: type === "card" ? { title: "Card" } : {}, content: [], children: [] };
  const source = [parent, paragraph("unrelated")];
  const editor = new Editor({ extensions: [...tiptapExtensions, OrbisBlockSelection], content: toTiptapDocument({ schema_version: 2, editor: "blocknote", blocks: source }) });
  document.body.append(editor.view.dom); editors.push(editor);
  const states = new Map<string, BlockLoadState>([["parent", { id: "parent", parent_id: null, child_count: 1, has_children: true, children_loaded: false, payload_loaded: true, payload_bytes: 100, offset: 0 }]]);
  function hydrate() {
    const next = editor.schema.nodeFromJSON(toTiptapDocument({ schema_version: 2, editor: "blocknote", blocks: [{ ...parent, children: [paragraph("retained-child")] }, paragraph("unrelated")] }));
    editor.view.dispatch(editor.state.tr.replaceWith(0, editor.state.doc.content.size, next.content).setMeta("orbis-content-page", true).setMeta("addToHistory", false));
    states.set("parent", { ...states.get("parent")!, offset: 1, children_loaded: true });
  }
  return { editor, states, hydrate };
}
function reader(editor: Editor, states: Map<string, BlockLoadState>, ensure: (ids: string[]) => Promise<void>) {
  const dispose = registerBlockActionReader(editor, { needsRead: ids => selectedBlocksNeedRead(editor, ids, states), ensure });
  cleanups.push(dispose);
}
afterEach(() => {
  cleanups.splice(0).forEach(dispose => dispose());
  editors.splice(0).forEach(editor => { editor.view.dom.remove(); editor.destroy(); });
  if (originalExecCommand) Object.defineProperty(document, "execCommand", originalExecCommand);
  else delete (document as Document & { execCommand?: unknown }).execCommand;
  vi.restoreAllMocks(); vi.unstubAllGlobals();
});

it("reads only selected descendants before copying with the HTTP clipboard fallback", async () => {
  const { editor, states, hydrate } = open();
  const ensure = vi.fn(async ids => { expect(ids).toEqual(["parent"]); hydrate(); }); reader(editor, states, ensure);
  vi.stubGlobal("ClipboardItem", undefined); vi.stubGlobal("navigator", { platform: "", userAgent: "", maxTouchPoints: 0 });
  const values = new Map<string, string>();
  Object.defineProperty(document, "execCommand", { configurable: true, value: vi.fn(() => {
    const event = new Event("copy", { bubbles: true, cancelable: true }); Object.defineProperty(event, "clipboardData", { value: { setData: (key: string, value: string) => values.set(key, value) } }); document.dispatchEvent(event); return true;
  }) });
  const copied = await copyBlocks(editor, ["parent"]);
  expect(copied.ok).toBe(true); expect(ensure).toHaveBeenCalledTimes(1);
  const dom = new DOMParser().parseFromString(values.get("text/html")!, "text/html");
  const payload = parseBlockClipboard(dom.querySelector("[data-orbis-block-clipboard]")!.getAttribute("data-orbis-block-clipboard")!);
  expect(payload!.blocks[0].children[0].id).toBe("retained-child");
  expect(payload!.blocks[0].children[0].content).toEqual(paragraph("retained-child").content);
  expect(payload!.blocks).toHaveLength(1);
});

it("does not cut or duplicate when a subtree read fails", async () => {
  const { editor, states } = open(); reader(editor, states, async () => { throw new Error("Read failed"); });
  const original = editor.state.doc;
  const cut = await copyBlocks(editor, ["parent"], true);
  expect(cut.ok).toBe(false); expect(editor.state.doc).toBe(original);
  expect(executeBlockCommand(editor, ["parent"], { type: "duplicate" }).ok).toBe(false);
  expect(editor.state.doc).toBe(original);
});

it.each(["duplicate", "ungroup"] as const)("%s requires complete descendants and retains them after hydration", async type => {
  const { editor, states, hydrate } = open("group"); reader(editor, states, async () => hydrate());
  expect(executeBlockCommand(editor, ["parent"], { type }).ok).toBe(false);
  await prepareBlockAction(editor, ["parent"]);
  expect(blockActionNeedsRead(editor, ["parent"])).toBe(false);
  expect(executeBlockCommand(editor, ["parent"], { type }).ok).toBe(true);
  const body = fromTiptapDocument(editor.state.doc).blocks;
  if (type === "duplicate") expect(body.filter(block => block.type === "group").map(block => block.children[0].content)).toEqual([paragraph("retained-child").content, paragraph("retained-child").content]);
  else expect(body[0].id).toBe("retained-child");
});

it("cancels a pending action when authored content changes during the read", async () => {
  const { editor, states } = open(); let resolve!: () => void;
  reader(editor, states, () => new Promise<void>(done => { resolve = done; }));
  const waiting = prepareBlockAction(editor, ["parent"]);
  editor.commands.insertContent("Changed by user"); resolve();
  await expect(waiting).rejects.toThrow("读取期间正文已变化");
});

it("does not add an async read to an already complete selected block", async () => {
  const { editor, states } = open(); const ensure = vi.fn(async () => {}); reader(editor, states, ensure);
  expect(blockActionNeedsRead(editor, ["unrelated"])).toBe(false);
  await prepareBlockAction(editor, ["unrelated"]); expect(ensure).not.toHaveBeenCalled();
});

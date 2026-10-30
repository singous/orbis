import { Editor } from "@tiptap/core";
import { afterEach, expect, it } from "vitest";
import { ySyncPluginKey } from "y-prosemirror";
import { tiptapExtensions } from "../../src/features/documents/editor/tiptap-extensions";
import { toTiptapDocument, fromTiptapDocument } from "../../src/features/documents/editor/tiptap-model";
import { executeBlockCommand } from "../../src/features/documents/editor/blocks/block-commands";
import { BOARD_REMOVAL_EVENT, confirmBoardRemoval, type BoardRemovalRequest } from "../../src/features/documents/editor/blocks/board-removal";
import { registerBoardNavigation } from "../../src/features/boards/navigation";
import type { OrbisBlock } from "../../src/features/content/blocks";

const disposers: (() => void)[] = [];
afterEach(() => { disposers.splice(0).reverse().forEach(dispose => dispose()); });
const board: OrbisBlock = { id: "board-block", type: "board", props: {}, content: [], children: [] };
function setup(grouped = false) {
  let pending = 1;
  const editor = new Editor({ extensions: tiptapExtensions, content: toTiptapDocument({ schema_version: 2, editor: "blocknote", blocks: [
    grouped ? { id: "group", type: "group", props: {}, content: [], children: [board] } : board,
    { id: "text", type: "paragraph", props: {}, content: [{ type: "text", text: "正文" }], children: [] },
  ] }) });
  const unregister = registerBoardNavigation({ blockId: board.id, getSnapshot: () => ({ pending }), subscribe: () => () => {} });
  disposers.push(() => { unregister(); editor.destroy(); });
  const requests: BoardRemovalRequest[] = [];
  editor.view.dom.addEventListener(BOARD_REMOVAL_EVENT, event => requests.push((event as CustomEvent<BoardRemovalRequest>).detail));
  return { editor, requests, saved: () => { pending = 0; } };
}

it.each([false, true])("requires confirmation before removing a pending board or its parent group (grouped=%s)", async grouped => {
  const { editor, requests } = setup(grouped);
  const original = editor.state.doc;
  expect(executeBlockCommand(editor, [grouped ? "group" : board.id], { type: "delete" }).ok).toBe(false);
  await Promise.resolve();
  expect(editor.state.doc).toBe(original);
  expect(requests).toHaveLength(1);
  expect(confirmBoardRemoval(editor, requests[0])).toBe(true);
  expect(editor.state.doc.textContent).toBe("正文");
  expect(editor.state.doc.toJSON().content.some((node: { type: string }) => node.type === "orbisBoard")).toBe(false);
});

it("also intercepts native range deletion and refuses stale confirmation after another document edit", async () => {
  const { editor, requests } = setup();
  const original = editor.state.doc;
  editor.view.dispatch(editor.state.tr.delete(0, editor.state.doc.firstChild!.nodeSize));
  await Promise.resolve();
  expect(editor.state.doc).toBe(original);
  expect(requests).toHaveLength(1);
  editor.commands.insertContentAt(editor.state.doc.content.size - 1, "新内容");
  expect(confirmBoardRemoval(editor, requests[0])).toBe(false);
  expect(editor.state.doc.textContent).toContain("新内容");
  expect(editor.state.doc.firstChild!.type.name).toBe("orbisBoard");
});

it("allows removal after saving and does not reject authoritative collaboration updates", async () => {
  const first = setup();
  first.saved();
  expect(executeBlockCommand(first.editor, [board.id], { type: "delete" }).ok).toBe(true);
  expect(first.requests).toHaveLength(0);
  const second = setup();
  second.editor.view.dispatch(second.editor.state.tr.delete(0, second.editor.state.doc.firstChild!.nodeSize).setMeta(ySyncPluginKey, { isChangeOrigin: true }));
  await Promise.resolve();
  expect(second.editor.state.doc.firstChild!.type.name).toBe("paragraph");
  expect(second.requests).toHaveLength(0);
});


it("keeps paragraphs as the default document block", () => {
  const { editor } = setup();
  expect(editor.schema.nodes.doc.contentMatch.defaultType?.name).toBe("paragraph");
});


it("also protects reparenting that recreates an embedded editor", async () => {
  const { editor, requests } = setup();
  const before = editor.state.doc;
  expect(executeBlockCommand(editor, [board.id], { type: "group" }).ok).toBe(false);
  await Promise.resolve();
  expect(editor.state.doc).toBe(before);
  expect(requests).toHaveLength(1);
  expect(confirmBoardRemoval(editor, requests[0])).toBe(true);
  expect(fromTiptapDocument(editor.state.doc).blocks[0].type).toBe("group");
});

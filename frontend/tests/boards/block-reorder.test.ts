import { Editor } from "@tiptap/core";
import { afterEach, expect, it } from "vitest";
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

it.each([false, true])("protects same-parent reordering of a board or its ancestor (grouped=%s)", async grouped => {
  const { editor, requests } = setup(grouped);
  expect(executeBlockCommand(editor, [grouped ? "group" : board.id], { type: "down" }).ok).toBe(false);
  await Promise.resolve();
  expect(requests).toHaveLength(1);
  expect(confirmBoardRemoval(editor, requests[0])).toBe(true);
  expect(fromTiptapDocument(editor.state.doc).blocks.at(-1)!.id).toBe(grouped ? "group" : board.id);
});

it("does not block insertion or deletion of ordinary siblings around a pending board", async () => {
  const { editor, requests } = setup();
  const paragraph = editor.schema.nodes.paragraph.create({ orbisId: "new-text" }, editor.schema.text("新段落"));
  editor.view.dispatch(editor.state.tr.insert(0, paragraph));
  expect(editor.state.doc.firstChild!.attrs.orbisId).toBe("new-text");
  expect(executeBlockCommand(editor, ["new-text"], { type: "delete" }).ok).toBe(true);
  await Promise.resolve();
  expect(requests).toHaveLength(0);
  expect(editor.state.doc.firstChild!.type.name).toBe("orbisBoard");
});

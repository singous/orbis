import { afterEach, describe, expect, it } from "vitest";
import { Editor, getSchema } from "@tiptap/core";
import { tiptapExtensions } from "../../src/features/notes/tiptap-extensions";
import { fromTiptapDocument, toTiptapDocument } from "../../src/features/notes/tiptap-model";
import { extractPlainTextV2, type NoteBlocksV2, type OrbisBlock } from "../../src/features/notes/block-model";
import { executeBlockCommand } from "../../src/features/notes/blocks/block-commands";
import { blockCapabilities } from "../../src/features/notes/blocks/block-capabilities";
import { parseBlockClipboard, serializeBlockClipboard } from "../../src/features/notes/blocks/block-clipboard";
import { MAX_DRAWING_BYTES, parseDrawingScene, serializeDrawingScene } from "../../src/features/drawing/drawing-scene";

const editors: Editor[] = [];
afterEach(() => editors.splice(0).forEach(editor => editor.destroy()));
const rectangle = { id: "shape", type: "rectangle", x: 12, y: 24, width: 200, height: 100, strokeColor: "#000000" };
const source = serializeDrawingScene([rectangle], "#ffffff");
const drawing = (): OrbisBlock => ({ id: "drawing-a", type: "drawing", props: { scene: source, caption: "流程图", url: "orbis-file:00000000-0000-0000-0000-000000000001" }, content: [], children: [] });
const envelope = (blocks: OrbisBlock[]): NoteBlocksV2 => ({ schema_version: 2, editor: "blocknote", blocks });
function open(blocks: OrbisBlock[]) {
  const editor = new Editor({ extensions: tiptapExtensions, content: toTiptapDocument(envelope(blocks)) });
  editors.push(editor); return editor;
}

describe("drawing document contract", () => {
  it("keeps source and managed preview through both editor conversion paths", () => {
    const document = envelope([drawing()]);
    const parsed = getSchema(tiptapExtensions).nodeFromJSON(toTiptapDocument(document));
    parsed.check();
    expect(fromTiptapDocument(parsed)).toEqual(document);
    expect(fromTiptapDocument(parsed.toJSON())).toEqual(document);
    expect(blockCapabilities("drawing").children).toEqual([]);
    expect(blockCapabilities("drawing").interaction).toBe("embedded");
  });

  it("keeps native HTML clipboard round-trips editable and regenerates block IDs", () => {
    const editor = open([drawing()]);
    const serialized = editor.view.serializeForClipboard(editor.state.doc.slice(0, editor.state.doc.content.size));
    const destination = open([]);
    destination.view.pasteHTML(serialized.dom.innerHTML, new Event("paste") as ClipboardEvent);
    const copy = fromTiptapDocument(destination.state.doc).blocks.find(block => block.type === "drawing")!;
    expect(copy.props).toEqual(drawing().props);
    expect(copy.id).not.toBe(drawing().id);
  });

  it("duplicates a drawing independently and retains document undo", () => {
    const editor = open([drawing()]);
    expect(executeBlockCommand(editor, ["drawing-a"], { type: "duplicate" }).ok).toBe(true);
    const blocks = fromTiptapDocument(editor.state.doc).blocks;
    expect(blocks).toHaveLength(2);
    expect(blocks[1].id).not.toBe(blocks[0].id);
    const second = editor.state.doc.child(1);
    editor.view.dispatch(editor.state.tr.setNodeMarkup(editor.state.doc.child(0).nodeSize, undefined, { ...second.attrs, orbisProps: { ...second.attrs.orbisProps, scene: "" } }));
    expect(fromTiptapDocument(editor.state.doc).blocks[0].props.scene).toBe(source);
    expect(fromTiptapDocument(editor.state.doc).blocks[1].props.scene).toBe("");
    expect(editor.commands.undo()).toBe(true);
  });

  it("preserves editable source through the whole-block clipboard", () => {
    const editor = open([drawing()]);
    const serialized = serializeBlockClipboard(editor, ["drawing-a"]);
    expect(parseBlockClipboard(serialized.structured)?.blocks[0].props).toEqual(drawing().props);
  });

  it("persists authored text and excludes deleted shapes and engine metadata", () => {
    const serialized = serializeDrawingScene([
      { ...rectangle, customData: { secret: "private" }, link: "https://example.com" },
      { ...rectangle, id: "deleted", isDeleted: true },
      { ...rectangle, id: "text", type: "text", text: "规划路线" },
    ], "#ffffff");
    expect(serialized).not.toContain("private");
    expect(serialized).not.toContain("deleted");
    expect(parseDrawingScene(serialized).elements).toHaveLength(2);
    expect(extractPlainTextV2([{ ...drawing(), props: { scene: serialized, caption: "计划" } }])).toBe("计划\n规划路线");
  });

  it.each([
    "broken", JSON.stringify({ version: 9, elements: [], appState: {} }),
    JSON.stringify({ version: 1, elements: [rectangle, rectangle], appState: { viewBackgroundColor: "#fff" } }),
    JSON.stringify({ version: 1, elements: [{ ...rectangle, type: "iframe" }], appState: { viewBackgroundColor: "#fff" } }),
    JSON.stringify({ version: 1, elements: [{ ...rectangle, x: "12" }], appState: { viewBackgroundColor: "#fff" } }),
    JSON.stringify({ version: 1, elements: [{ ...rectangle, type: "freedraw", points: "invalid" }], appState: { viewBackgroundColor: "#fff" } }),
    " ".repeat(MAX_DRAWING_BYTES + 1),
  ])("rejects malformed scenes before opening the drawing engine", value => {
    expect(() => parseDrawingScene(value)).toThrow();
  });
});

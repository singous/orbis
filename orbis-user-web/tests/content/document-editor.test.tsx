import { BlockNoteEditor as CoreEditor } from "@blocknote/core";
import { insertOrUpdateBlockForSlashMenu } from "@blocknote/core/extensions";
import { documentEditorSchema, documentEditorExtensions, createDocumentBlock, type DocumentEditor } from "../../src/features/notes/DocumentBlockEditor";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { BlockNoteEditor } from "../../src/features/notes/BlockNoteEditor";
import type { NoteBlocksV2 } from "../../src/features/notes/block-model";

const initial: NoteBlocksV2 = { schema_version: 2, editor: "blocknote", blocks: [{
  id: "card", type: "card", props: { title: "原卡片", href: "" }, content: [], children: [
    { id: "body", type: "paragraph", props: {}, content: [{ type: "text", text: "保留正文" }], children: [] },
  ],
}] };
const originalHitTest = Object.getOwnPropertyDescriptor(document, "elementsFromPoint");
beforeEach(() => {
  vi.stubGlobal("ClipboardEvent", Event);
  vi.stubGlobal("matchMedia", (media: string) => ({
    matches: false, media, onchange: null,
    addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {}, dispatchEvent() { return true; },
  }));
  // jsdom has no layout hit-testing; property edits do not depend on side-menu placement.
  Object.defineProperty(document, "elementsFromPoint", { configurable: true, value: () => [] });
});
afterEach(() => {
  cleanup(); vi.unstubAllGlobals();
  if (originalHitTest) Object.defineProperty(document, "elementsFromPoint", originalHitTest);
  else Reflect.deleteProperty(document, "elementsFromPoint");
});

it("edits real custom block properties and preserves them across server-shaped echoes", async () => {
  const user = userEvent.setup();
  let persisted = initial;
  function Harness() {
    const [blocks, setBlocks] = useState(initial);
    return <BlockNoteEditor blocks={blocks} onChange={({ blocks: next }) => {
      persisted = JSON.parse(JSON.stringify(next));
      persisted.blocks[0].content = [];
      setBlocks(persisted);
    }} />;
  }
  render(<Harness />);
  const input = await screen.findByRole("textbox", { name: "卡片标题" });
  await user.clear(input);
  await user.type(input, "快速开始");
  await waitFor(() => expect(persisted.blocks[0].props.title).toBe("快速开始"));
  expect(input).toHaveFocus();
  expect(persisted.blocks[0].children[0].content).toEqual(expect.arrayContaining([expect.objectContaining({ text: "保留正文" })]));
});

it("keeps custom property controls read only for a read-only editor", async () => {
  render(<BlockNoteEditor blocks={initial} readOnly onChange={() => { throw new Error("Read-only content changed"); }} />);
  expect(await screen.findByText("原卡片")).toBeVisible();
  expect(screen.queryByRole("textbox", { name: "卡片标题" })).not.toBeInTheDocument();
});

it("adds a group child without restoring stale properties of edited children", async () => {
  const user = userEvent.setup();
  const grouped: NoteBlocksV2 = { schema_version: 2, editor: "blocknote", blocks: [{
    id: "group", type: "cardGroup", props: { columns: 2 }, content: [], children: initial.blocks,
  }] };
  let persisted = grouped;
  render(<BlockNoteEditor blocks={grouped} onChange={({ blocks }) => { persisted = blocks; }} />);
  const title = await screen.findByRole("textbox", { name: "卡片标题" });
  await user.clear(title);
  await user.type(title, "编辑后的标题");
  await user.click(screen.getByRole("button", { name: "添加卡片" }));
  await waitFor(() => expect(persisted.blocks[0].children).toHaveLength(2));
  expect(persisted.blocks[0].children[0].props.title).toBe("编辑后的标题");
});

it("preserves an imported code language and disables its control in read-only mode", async () => {
  const code: NoteBlocksV2 = { schema_version: 2, editor: "blocknote", blocks: [{
    id: "imported-code", type: "codeBlock", props: { language: "rust" }, content: "fn main() {}", children: [],
  }] };
  render(<BlockNoteEditor blocks={code} readOnly onChange={() => { throw new Error("Read-only content changed"); }} />);
  const language = await screen.findByRole("combobox", { name: "代码语言" });
  expect(language).toHaveValue("rust");
  expect(language).toBeDisabled();
});

const coreEditors: { editor: DocumentEditor; element: HTMLElement }[] = [];
afterEach(() => {
  coreEditors.splice(0).forEach(({ editor, element }) => {
    editor._tiptapEditor.destroy();
    element.remove();
  });
});

function coreEditor(blocks: typeof documentEditorSchema.PartialBlock[]) {
  const editor = CoreEditor.create({ schema: documentEditorSchema, extensions: documentEditorExtensions, initialContent: blocks });
  const element = document.createElement("div");
  document.body.append(element);
  editor.mount(element);
  coreEditors.push({ editor, element });
  return editor;
}

it.each(["cardGroup", "steps", "tabs", "codeGroup"] as const)("keeps inserted blocks outside %s without losing order, properties or caret", (kind) => {
  const group = createDocumentBlock(kind);
  group.id = "group";
  const editor = coreEditor([group as typeof documentEditorSchema.PartialBlock]);
  const firstId = group.children[0].id;
  const secondId = group.children[1].id;
  const emissions: typeof editor.document[] = [];
  editor.onChange(() => { emissions.push(editor.document); });
  editor.transact(() => {
    editor.insertBlocks([{ id: "inserted", type: "callout", props: { title: "Keep title", tone: "warning" }, content: "Keep text" }], firstId, "after");
    editor.setTextCursorPosition("inserted", "end");
  });
  expect(editor.document.map((block) => block.type)).toEqual([kind, "callout", kind]);
  expect(editor.document[0].children.map((block) => block.id)).toEqual([firstId]);
  expect(editor.document[2].children.map((block) => block.id)).toEqual([secondId]);
  expect(editor.document[0].props).toEqual(editor.document[2].props);
  expect(editor.document[0].id).toBe("group");
  expect(new Set(editor.document.map((block) => block.id)).size).toBe(3);
  expect(editor.getBlock("inserted")).toMatchObject({ props: { title: "Keep title", tone: "warning" }, content: [{ text: "Keep text" }] });
  expect(editor.getTextCursorPosition().block.id).toBe("inserted");
  editor.insertInlineContent("!");
  expect(editor.getBlock("inserted")?.content).toMatchObject([{ text: "Keep text!" }]);
  expect(emissions.length).toBeGreaterThan(0);
  for (const emitted of emissions) expect(emitted[0].children.map((block) => block.id)).toEqual([firstId]);
  editor.undo();
  editor.undo();
  expect(editor.document[0].children.map((block) => block.id)).toEqual([firstId, secondId]);
  expect(editor.getBlock("inserted")).toBeUndefined();
});

it("exits a constrained group on Enter before slash insertion and keeps pasted paragraphs editable", () => {
  const editor = coreEditor([{ id: "group", type: "cardGroup", children: [{ id: "card", type: "card", children: [{ id: "empty", type: "paragraph" }] }] }]);
  editor.setTextCursorPosition("empty", "end");
  editor._tiptapEditor.commands.keyboardShortcut("Enter");
  expect(editor.document[0].children.map((block) => block.type)).toEqual(["card"]);
  expect(editor.getTextCursorPosition().block.id).toBe("empty");
  expect(editor.document[1].id).toBe("empty");
  insertOrUpdateBlockForSlashMenu(editor, { type: "callout", props: { title: "Inserted with slash" } });
  editor.pasteHTML("<p>First pasted paragraph</p><p>Second pasted paragraph</p>");
  expect(editor.document[0].children.map((block) => block.type)).toEqual(["card"]);
  expect(JSON.stringify(editor.document)).toContain("First pasted paragraph");
  expect(JSON.stringify(editor.document)).toContain("Second pasted paragraph");
});

it("preserves HTML pasted over a group child and the remaining group content", () => {
  const editor = coreEditor([{ id: "group", type: "tabs", children: [
    { id: "empty-tab", type: "tab", props: { title: "" } },
    { id: "retained-tab", type: "tab", props: { title: "Retained" }, children: [{ type: "paragraph", content: "Keep nested content" }] },
  ] }]);
  editor.setTextCursorPosition("empty-tab");
  editor.pasteHTML("<p>First pasted paragraph</p><p>Second <strong>pasted</strong> paragraph</p>");
  expect(editor.document.slice(0, 2).map((block) => block.type)).toEqual(["paragraph", "paragraph"]);
  const group = editor.getBlock("group")!;
  expect(group.children.map((block) => block.id)).toEqual(["retained-tab"]);
  expect(JSON.stringify(group)).toContain("Keep nested content");
  expect(editor.document[1].content).toEqual(expect.arrayContaining([expect.objectContaining({ text: "pasted", styles: { bold: true } })]));
  expect(editor.getTextCursorPosition().block.id).toBe(editor.document[1].id);
});

it("splits a nested group inside its card and preserves a selection within moved content", () => {
  const group = createDocumentBlock("steps");
  const editor = coreEditor([{ id: "outer-card", type: "card", children: [group as typeof documentEditorSchema.PartialBlock] }]);
  editor.transact(() => {
    editor.insertBlocks([{ id: "nested-insert", type: "paragraph", content: "Nested insertion" }], group.children[0].id, "after");
    editor.setTextCursorPosition("nested-insert", "end");
  });
  expect(editor.document.map((block) => block.id)).toEqual(["outer-card"]);
  expect(editor.document[0].children.map((block) => block.type)).toEqual(["steps", "paragraph", "steps"]);
  expect(editor.getTextCursorPosition().block.id).toBe("nested-insert");
  editor.insertInlineContent(" kept");
  expect(editor.getBlock("nested-insert")?.content).toMatchObject([{ text: "Nested insertion kept" }]);
});

it("does not normalize programmatically supplied content while read only", () => {
  const group = createDocumentBlock("cardGroup");
  const editor = coreEditor([group as typeof documentEditorSchema.PartialBlock]);
  editor.isEditable = false;
  editor.insertBlocks([{ id: "external", type: "paragraph", content: "External content" }], group.children[0].id, "after");
  expect(editor.document.map((block) => block.type)).toEqual(["cardGroup"]);
  expect(editor.document[0].children.map((block) => block.id)).toEqual([group.children[0].id, "external", group.children[1].id]);
});

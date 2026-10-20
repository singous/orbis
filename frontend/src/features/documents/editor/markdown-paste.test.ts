import { afterEach, expect, it, vi } from "vitest";
import { Editor } from "@tiptap/core";

import { tiptapExtensions } from "./tiptap-extensions";
import { OrbisBlockSelection, setBlockSelection } from "./blocks/block-selection";
import { BLOCK_CLIPBOARD_MIME, installBlockClipboard, serializeBlockClipboard } from "./blocks/block-clipboard";
import { fromTiptapDocument, toTiptapDocument } from "./tiptap-model";
import type { OrbisBlock } from "../../content/model/blocks";

const editors: Editor[] = [];
function open(blocks: OrbisBlock[] = []) {
  const editor = new Editor({ extensions: [...tiptapExtensions, OrbisBlockSelection], content: toTiptapDocument({ schema_version: 2, editor: "blocknote", blocks }) });
  document.body.appendChild(editor.view.dom);
  installBlockClipboard(editor, () => {});
  editors.push(editor);
  return editor;
}
afterEach(() => editors.splice(0).forEach(editor => { editor.view.dom.remove(); editor.destroy(); }));
function paste(editor: Editor, text: string, html = "", extra: Record<string, string> = {}) {
  const event = new Event("paste", { bubbles: true, cancelable: true });
  const values: Record<string, string> = { "text/plain": text, "text/html": html, ...extra };
  Object.defineProperty(event, "clipboardData", { value: { getData: (key: string) => values[key] ?? "", files: [] } });
  editor.view.dom.dispatchEvent(event);
  return event;
}
const textOf = (editor: Editor) => editor.state.doc.textBetween(0, editor.state.doc.content.size, "\n", "\n");
const markdown = "# Interface\n\nA **bold** decision with `code`.\n\n- First\n- Second\n\n- [x] Done\n- [ ] Pending\n\n| Key | Value |\n| --- | --- |\n| A | B |\n\n> Quote\n\n```go\nfmt.Println(\"hello\")\n```\n\n---";

it("converts Markdown source pasted into a blank document and undoes it once", () => {
  const editor = open();
  const before = editor.state.doc;
  expect(paste(editor, markdown).defaultPrevented).toBe(true);
  const blocks = fromTiptapDocument(editor.state.doc).blocks;
  expect(blocks.map(block => block.type)).toEqual(["heading", "paragraph", "bulletListItem", "bulletListItem", "checkListItem", "checkListItem", "table", "quote", "codeBlock", "divider"]);
  expect(blocks[0]).toMatchObject({ props: { level: 1 }, content: [{ text: "Interface" }] });
  expect(blocks[4]).toMatchObject({ props: { checked: true } });
  expect(blocks[6].content).toMatchObject({ type: "tableContent", rows: [{ cells: [expect.anything(), expect.anything()] }, { cells: [expect.anything(), expect.anything()] }] });
  expect(editor.getHTML()).toContain("<strong>bold</strong>");
  expect(editor.commands.undo()).toBe(true);
  expect(editor.state.doc.toJSON()).toEqual(before.toJSON());
  expect(editor.commands.redo()).toBe(true);
  expect(fromTiptapDocument(editor.state.doc).blocks.map(block => block.type)).toEqual(blocks.map(block => block.type));
});

it("replaces a text selection while retaining surrounding content", () => {
  const editor = open([{ id: "paragraph", type: "paragraph", props: {}, content: "Before selected after", children: [] }]);
  editor.commands.setTextSelection({ from: 8, to: 16 });
  paste(editor, "## Inserted\n\nNew body");
  expect(textOf(editor)).toContain("Before");
  expect(textOf(editor)).toContain("Inserted");
  expect(textOf(editor)).toContain("New body");
  expect(textOf(editor)).toContain("after");
  expect(textOf(editor)).not.toContain("selected");
  expect(editor.commands.undo()).toBe(true);
  expect(textOf(editor)).toBe("Before selected after");
});

it("keeps a paste as one undo step between surrounding typing", () => {
  const editor = open();
  editor.commands.insertContent("Before ");
  paste(editor, "**bold**");
  editor.commands.insertContent(" after");
  editor.commands.undo();
  expect(textOf(editor)).toContain("bold");
  expect(textOf(editor)).not.toContain("after");
  editor.commands.undo();
  expect(textOf(editor)).toBe("Before ");
  editor.commands.undo();
  expect(textOf(editor)).toBe("");
});

it("keeps literal Markdown inside a code block, even with an internal clipboard payload", () => {
  const source = open([{ id: "source", type: "heading", props: { level: 1 }, content: "Heading", children: [] }]);
  const serialized = serializeBlockClipboard(source, ["source"]);
  const editor = open([{ id: "code", type: "codeBlock", props: { language: "markdown" }, content: "", children: [] }]);
  paste(editor, "# Literal\n\n- Item", serialized.html, { [BLOCK_CLIPBOARD_MIME]: serialized.structured });
  const blocks = fromTiptapDocument(editor.state.doc).blocks;
  expect(blocks).toHaveLength(1);
  expect(blocks[0]).toMatchObject({ type: "codeBlock", content: "# Literal\n\n- Item" });
});

it.each([false, true])("honors Ctrl/Cmd+Shift+V as literal text (block selection: %s)", (blockMode) => {
  const editor = open([{ id: "anchor", type: "paragraph", props: {}, content: "Anchor", children: [] }]);
  if (blockMode) setBlockSelection(editor, ["anchor"]);
  else editor.commands.setTextSelection(editor.state.doc.content.size - 1);
  editor.view.dom.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "v", ctrlKey: true, shiftKey: true }));
  paste(editor, "# Literal\n\n- **Item** with `code`", "<h1>Rich HTML</h1>");
  expect(fromTiptapDocument(editor.state.doc).blocks.every(block => block.type === "paragraph")).toBe(true);
  expect(textOf(editor)).toContain("# Literal");
  expect(textOf(editor)).toContain("- **Item** with `code`");
  expect(textOf(editor)).not.toContain("Rich HTML");
});

it("keeps rendered rich HTML as rich HTML, even if its plain-text fallback resembles Markdown", () => {
  const editor = open();
  paste(editor, "# Plain fallback", "<p><strong>Rich body</strong></p>");
  expect(editor.getHTML()).toContain("<strong>Rich body</strong>");
  expect(fromTiptapDocument(editor.state.doc).blocks[0].type).toBe("paragraph");
});

it("recognizes Markdown source copied from an external code sample", () => {
  const editor = open();
  paste(editor, "## Source\n\n- Item", "<pre><code>## Source\n\n- Item</code></pre>");
  expect(fromTiptapDocument(editor.state.doc).blocks.map(block => block.type)).toEqual(["heading", "bulletListItem"]);
});

it("recognizes syntax-highlighted Markdown source copied from a code editor", () => {
  const editor = open();
  paste(editor, "## Source\n\n- Item", '<div style="white-space: pre; font-family: Consolas, monospace"><div><span style="color: blue">## Source</span></div><div><br></div><div>- Item</div></div>');
  expect(fromTiptapDocument(editor.state.doc).blocks.map(block => block.type)).toEqual(["heading", "bulletListItem"]);
});

it.each([false, true])("preserves explicitly typed external code HTML (block selection: %s)", blockMode => {
  const editor = open([{ id: "anchor", type: "paragraph", props: {}, content: "", children: [] }]);
  if (blockMode) setBlockSelection(editor, ["anchor"]);
  const source = 'const value = "**literal**";';
  paste(editor, source, `<pre><code class="language-js">${source}</code></pre>`);
  expect(fromTiptapDocument(editor.state.doc).blocks.find(block => block.type === "codeBlock")).toMatchObject({ content: source });
});

it("preserves ordinary external code HTML after a block selection", () => {
  const editor = open([{ id: "anchor", type: "paragraph", props: {}, content: "", children: [] }]);
  setBlockSelection(editor, ["anchor"]);
  paste(editor, "const value = 1;", "<pre><code>const value = 1;</code></pre>");
  expect(fromTiptapDocument(editor.state.doc).blocks.at(-1)).toMatchObject({ type: "codeBlock", content: "const value = 1;" });
});

it("retains internal structured clipboard content instead of reparsing its text", () => {
  const source = open([{ id: "source", type: "paragraph", props: {}, content: "# Authored literal", children: [] }]);
  const serialized = serializeBlockClipboard(source, ["source"]);
  const editor = open();
  paste(editor, serialized.text, serialized.html, { [BLOCK_CLIPBOARD_MIME]: serialized.structured });
  const blocks = fromTiptapDocument(editor.state.doc).blocks;
  expect(blocks.at(-1)).toMatchObject({ type: "paragraph", content: "# Authored literal" });
});

it("uses the same Markdown conversion for block-menu clipboard reading", async () => {
  const { pasteBlocks } = await import("./blocks/block-clipboard");
  const editor = open([{ id: "anchor", type: "paragraph", props: {}, content: "Anchor", children: [] }]);
  vi.stubGlobal("navigator", { platform: "", userAgent: "", maxTouchPoints: 0, clipboard: { read: async () => [{ types: ["text/plain"], getType: async () => ({ text: async () => "## After\n\n- Item" }) }] } });
  try {
    expect((await pasteBlocks(editor, ["anchor"])).ok).toBe(true);
    expect(fromTiptapDocument(editor.state.doc).blocks.map(block => block.type)).toEqual(["paragraph", "heading", "bulletListItem"]);
    editor.commands.undo();
    expect(textOf(editor)).toBe("Anchor");
  } finally { vi.unstubAllGlobals(); }
});

it("keeps unsupported raw HTML, image metadata and hard breaks without dropping source", () => {
  const editor = open();
  paste(editor, '# Supported\n\n<div data-widget="diagram">Raw HTML</div>\n\nText <kbd>Ctrl</kbd> with ![](diagram.svg "Figure title").\n\nBreak  \nnext');
  expect(textOf(editor)).toContain('<div data-widget="diagram">Raw HTML</div>');
  expect(textOf(editor)).toContain("<kbd>Ctrl</kbd>");
  expect(textOf(editor)).toContain('![](diagram.svg "Figure title")');
  expect(textOf(editor)).toContain("Break\nnext");
});

it("keeps a Markdown destination literal when block clipboard validation cannot preserve it", () => {
  const editor = open([{ id: "anchor", type: "paragraph", props: {}, content: "Anchor", children: [] }]);
  setBlockSelection(editor, ["anchor"]);
  const source = "# Heading\n\n[Signed asset](https://example.com/file?token=author-value)";
  paste(editor, source);
  expect(fromTiptapDocument(editor.state.doc).blocks.at(-1)).toMatchObject({ type: "paragraph", content: source });
});

it.each([false, true])("does not reinterpret literal unsupported syntax after Markdown parsing (block selection: %s)", blockMode => {
  const editor = open([{ id: "anchor", type: "paragraph", props: {}, content: "", children: [] }]);
  if (blockMode) setBlockSelection(editor, ["anchor"]);
  paste(editor, '# Heading\n\n<widget>**literal HTML** https://user:password@example.com</widget>\n\n![*literal image alt*](relative.svg)');
  expect(textOf(editor)).toContain('<widget>**literal HTML** https://user:password@example.com</widget>');
  expect(textOf(editor)).toContain('![*literal image alt*](relative.svg)');
  expect(editor.getHTML()).not.toContain('<a ');
});

it("pastes a 5,500-block document without losing the tail and supports one undo", () => {
  const editor = open();
  const body = Array.from({ length: 5_499 }, (_, index) => `Paragraph ${index} with **marked text**.`).join("\n\n");
  paste(editor, `# Long source\n\n${body}`);
  const blocks = fromTiptapDocument(editor.state.doc).blocks;
  expect(blocks).toHaveLength(5_500);
  expect(textOf(editor)).toContain("Paragraph 5498 with marked text.");
  expect(new Set(blocks.map(block => block.id)).size).toBe(5_500);
  editor.commands.undo();
  expect(textOf(editor)).toBe("");
}, 30_000);

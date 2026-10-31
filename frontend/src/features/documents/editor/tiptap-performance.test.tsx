import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { Editor } from "@tiptap/core";
import { afterEach, expect, it, vi } from "vitest";
import { TiptapEditor } from "./TiptapEditor";
import type { NoteBlocksV2 } from "../../content/blocks";
import * as model from "./tiptap-model";
import * as codeHighlight from "../../content/code-highlight";

const content: NoteBlocksV2 = { schema_version: 2, editor: "blocknote", blocks: [
  { id: "first", type: "paragraph", props: {}, content: [{ type: "text", text: "Select this text" }], children: [] },
  { id: "second", type: "paragraph", props: {}, content: [{ type: "text", text: "Untouched content" }], children: [] },
] };

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

async function mountedEditor(container: HTMLElement) {
  let editor: Editor | undefined;
  await waitFor(() => {
    editor = (container.querySelector(".tiptap") as (HTMLElement & { editor?: Editor }) | null)?.editor;
    expect(editor).toBeDefined();
  });
  return editor!;
}

it("does not rebuild document content for selection and toolbar state changes", async () => {
  const convert = vi.spyOn(model, "toTiptapDocument");
  const changed = vi.fn();
  const { container, rerender } = render(<TiptapEditor blocks={content} onChange={changed} />);
  const editor = await mountedEditor(container);
  convert.mockClear();
  act(() => { editor.commands.setTextSelection({ from: 1, to: 5 }); });
  await userEvent.click(screen.getByRole("button", { name: "插入内容" }));
  expect(screen.getByRole("listbox")).toBeVisible();
  rerender(<TiptapEditor blocks={content} onChange={changed} readOnly />);
  expect(editor.state.doc.textContent).toBe("Select this textUntouched content");
  expect(editor.state.selection.to - editor.state.selection.from).toBe(4);
  expect(changed).not.toHaveBeenCalled();
  expect(convert).not.toHaveBeenCalled();
});

it("reuses unchanged saved blocks across keystrokes while retaining edits and undo", async () => {
  const drafts: NoteBlocksV2[] = [];
  const { container } = render(<TiptapEditor blocks={content} onChange={({ blocks }) => drafts.push(blocks)} />);
  const editor = await mountedEditor(container);
  act(() => { editor.commands.setTextSelection(1); editor.commands.insertContent("A"); });
  const firstDraft = drafts.at(-1)!;
  act(() => { editor.commands.insertContent("B"); });
  const secondDraft = drafts.at(-1)!;
  expect(secondDraft.blocks[0].content).toEqual([{ type: "text", text: "ABSelect this text" }]);
  expect(secondDraft.blocks[1]).toEqual(content.blocks[1]);
  expect(secondDraft.blocks[1]).toBe(firstDraft.blocks[1]);
  act(() => { editor.commands.undo(); });
  expect(editor.state.doc.textContent).toBe("Select this textUntouched content");
  expect(drafts.at(-1)!.blocks[1]).toBe(firstDraft.blocks[1]);
});


it("only highlights changed code blocks and keeps colors aligned after edits", async () => {
  const highlight = vi.spyOn(codeHighlight, "highlightCode");
  const codeDocument: NoteBlocksV2 = { ...content, blocks: [content.blocks[0],
    { id: "code-a", type: "codeBlock", props: { language: "javascript" }, content: "const alpha = 1;", children: [] },
    { id: "code-b", type: "codeBlock", props: { language: "javascript" }, content: "const beta = 2;", children: [] },
  ] };
  const { container } = render(<TiptapEditor blocks={codeDocument} onChange={() => {}} />);
  const editor = await mountedEditor(container);
  const keywords = () => Array.from(container.querySelectorAll(".hljs-keyword"), (node) => node.textContent);
  expect(keywords()).toEqual(["const", "const"]);
  highlight.mockClear();
  act(() => { editor.commands.setTextSelection(1); editor.commands.insertContent("Prefix "); });
  expect(keywords()).toEqual(["const", "const"]);
  expect(highlight).not.toHaveBeenCalled();
  const codePosition = editor.state.doc.child(0).nodeSize;
  act(() => { editor.commands.setTextSelection(codePosition + 1); editor.commands.updateAttributes("codeBlock", { language: "text" }); });
  expect(highlight).toHaveBeenCalledTimes(1);
  expect(keywords()).toEqual(["const"]);
  expect(container.querySelectorAll(".orbis-code code")[1]).toHaveTextContent("const beta = 2;");
  highlight.mockClear();
  act(() => { editor.commands.undo(); });
  expect(keywords()).toEqual(["const", "const"]);
  expect(highlight.mock.calls.length).toBeLessThanOrEqual(1);
});

it("keeps toolbar selection state current without rebuilding the document", async () => {
  const marked: NoteBlocksV2 = { ...content, blocks: [{ ...content.blocks[0], content: [{ type: "text", text: "Bold text", styles: { bold: true } }] }, content.blocks[1]] };
  const { container } = render(<TiptapEditor blocks={marked} onChange={() => {}} />);
  const editor = await mountedEditor(container);
  act(() => { editor.commands.setTextSelection({ from: 1, to: 5 }); });
  expect(screen.getByRole("button", { name: "粗体" })).toHaveAttribute("aria-pressed", "true");
  act(() => { editor.commands.setTextSelection(editor.state.doc.child(0).nodeSize + 1); });
  expect(screen.getByRole("button", { name: "粗体" })).toHaveAttribute("aria-pressed", "false");
});

it("removes stale code colors when converting a code block to a paragraph", async () => {
  const codes: NoteBlocksV2 = { ...content, blocks: [
    { id: "a", type: "codeBlock", props: { language: "javascript" }, content: "const a = 1;", children: [] },
    { id: "b", type: "codeBlock", props: { language: "javascript" }, content: "const b = 2;", children: [] },
  ] };
  const { container } = render(<TiptapEditor blocks={codes} onChange={() => {}} />);
  const editor = await mountedEditor(container);
  act(() => { editor.commands.setTextSelection(1); editor.commands.setParagraph(); });
  expect(container.querySelector(".ProseMirror > p")).toHaveTextContent("const a = 1;");
  expect(container.querySelector(".ProseMirror > p .hljs-keyword")).toBeNull();
  expect(container.querySelectorAll(".hljs-keyword")).toHaveLength(1);
  act(() => { editor.commands.undo(); });
  expect(container.querySelectorAll(".hljs-keyword")).toHaveLength(2);
});

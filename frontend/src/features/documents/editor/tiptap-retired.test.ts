import { Editor } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import { afterEach, describe, expect, it, vi } from "vitest";
import { RetiredDrawing, registerRetiredBlockCleanup } from "./tiptap-retired";
import { registerBlockActionReader } from "./blocks/block-action-read";

const editors: Editor[] = [];
const cleanups: Array<() => void> = [];
afterEach(() => {
  cleanups.splice(0).forEach((cleanup) => cleanup());
  editors.splice(0).forEach((editor) => editor.destroy());
});
const paragraph = (text: string) => ({
  type: "paragraph",
  content: [{ type: "text", text }],
});
const retired = (id: string) => ({
  type: "orbisDrawing",
  attrs: {
    orbisId: id,
    orbisProps: {
      scene: "discarded scene",
      caption: "discarded caption",
      url: "https://example.test/retired.png",
    },
  },
});
function open(editable = true) {
  const editor = new Editor({
    extensions: [StarterKit, RetiredDrawing],
    editable,
    content: {
      type: "doc",
      content: [
        paragraph("Before"),
        retired("first"),
        {
          type: "blockquote",
          content: [retired("nested"), paragraph("Inside")],
        },
        retired("last"),
        paragraph("After"),
      ],
    },
  });
  editors.push(editor);
  return editor;
}
function containsRetired(editor: Editor) {
  return JSON.stringify(editor.getJSON()).includes("orbisDrawing");
}

describe("retired drawing cleanup", () => {
  it("removes all retired blocks in one non-history transaction and retains surrounding content", async () => {
    const editor = open(),
      error = vi.fn(),
      transactions: unknown[] = [];
    editor.on("transaction", ({ transaction }) => {
      if (transaction.docChanged)
        transactions.push(transaction.getMeta("addToHistory"));
    });
    cleanups.push(registerRetiredBlockCleanup(editor, error));
    await vi.waitFor(() => expect(containsRetired(editor)).toBe(false));
    expect(editor.getJSON()).toEqual({
      type: "doc",
      content: [
        paragraph("Before"),
        { type: "blockquote", content: [paragraph("Inside")] },
        paragraph("After"),
      ],
    });
    expect(transactions).toEqual([false]);
    expect(editor.commands.undo()).toBe(false);
    expect(error).not.toHaveBeenCalled();
  });
  it("never writes while read-only and cleans up when the editor becomes editable", async () => {
    const editor = open(false),
      error = vi.fn();
    cleanups.push(registerRetiredBlockCleanup(editor, error));
    await Promise.resolve();
    expect(containsRetired(editor)).toBe(true);
    expect(editor.view.dom.querySelector("img")).toBeNull();
    expect(editor.view.dom.textContent).not.toContain("discarded");
    editor.setEditable(true);
    await vi.waitFor(() => expect(containsRetired(editor)).toBe(false));
  });
  it("cancels a pending read after leaving the document session", async () => {
    const editor = open(),
      original = editor.getJSON();
    let finish!: () => void,
      pending = true;
    cleanups.push(
      registerBlockActionReader(editor, {
        needsRead: () => pending,
        ensure: () =>
          new Promise<void>((resolve) => {
            finish = () => {
              pending = false;
              resolve();
            };
          }),
      }),
    );
    const cleanup = registerRetiredBlockCleanup(editor, vi.fn());
    cleanup();
    finish();
    await Promise.resolve();
    await Promise.resolve();
    expect(editor.getJSON()).toEqual(original);
  });
  it("keeps the document intact when a required content read fails", async () => {
    const editor = open(),
      original = editor.getJSON(),
      error = vi.fn();
    cleanups.push(
      registerBlockActionReader(editor, {
        needsRead: () => true,
        ensure: async () => {
          throw Error("Read failed");
        },
      }),
    );
    cleanups.push(registerRetiredBlockCleanup(editor, error));
    await vi.waitFor(() => expect(error).toHaveBeenCalledOnce());
    expect(editor.getJSON()).toEqual(original);
  });
});

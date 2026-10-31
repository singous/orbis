import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";
import type { Editor } from "@tiptap/core";
import { TiptapEditor } from "./TiptapEditor";
import type { EditorContentHandle } from "./editor-content-handle";
import type { NoteBlocksV2, OrbisBlock } from "../../content/blocks";

const paragraph = (id: string, text = id): OrbisBlock => ({ id, type: "paragraph", props: {}, content: [{ type: "text", text }], children: [] });
afterEach(cleanup);

it("keeps a shallow tab's loader visible in its selected panel without counting it as another tab", async () => {
  const tab = (id: string): OrbisBlock => ({ ...paragraph(id), type: "tab", props: { title: id }, content: [] });
  const blocks: NoteBlocksV2 = { schema_version: 2, editor: "blocknote", blocks: [{ ...paragraph("tabs"), type: "tabs", content: [], children: [tab("Linux"), tab("macOS")] }] };
  const states = new Map(["Linux", "macOS"].map(id => [id, { id, parent_id: "tabs", child_count: 1, has_children: true, children_loaded: false, payload_loaded: true, payload_bytes: 10, cursor: null, loaded_count: 0 }]));
  const { container } = render(<TiptapEditor blocks={blocks} loadStates={states} onChange={vi.fn()} />);
  const linuxLoader = () => container.querySelector('[data-block-loader="Linux"]') as HTMLElement;
  const macLoader = () => container.querySelector('[data-block-loader="macOS"]') as HTMLElement;
  await waitFor(() => { expect(linuxLoader()).toBeVisible(); expect(macLoader()).not.toBeVisible(); });
  await userEvent.click(screen.getByRole("tab", { name: "macOS" }));
  await waitFor(() => { expect(macLoader()).toBeVisible(); expect(linuxLoader()).not.toBeVisible(); });
  expect(container.querySelector('[data-orbis-block-id="macOS"]')).toBeVisible();
});

it("hydrates child blocks outside user undo and removes the completed loader without emitting a save", async () => {
  const changed = vi.fn();
  let handle: EditorContentHandle | null = null;
  const blocks: NoteBlocksV2 = { schema_version: 2, editor: "blocknote", blocks: [{ ...paragraph("parent"), type: "group", content: [] }, paragraph("tail")] };
  const states = new Map([["parent", { id: "parent", parent_id: null, child_count: 1, has_children: true, children_loaded: false, payload_loaded: true, payload_bytes: 10, cursor: null, loaded_count: 0 }]]);
  const { container, rerender } = render(<TiptapEditor blocks={blocks} loadStates={states} onContentReady={value => { handle = value; }} onChange={changed} />);
  await waitFor(() => expect(handle).not.toBeNull());
  expect(screen.getByRole("button", { name: "载入子内容（1）" })).toBeVisible();
  act(() => { handle!.appendChildren("parent", [paragraph("child", "nested body")]); });
  expect(handle!.snapshot().blocks[0].children[0].id).toBe("child");
  expect(changed).not.toHaveBeenCalled();
  const loaded = new Map([["parent", { ...states.get("parent")!, children_loaded: true, cursor: null, loaded_count: 1 }]]);
  rerender(<TiptapEditor blocks={handle!.snapshot()} loadStates={loaded} onContentReady={value => { handle = value; }} onChange={changed} />);
  expect(screen.queryByRole("button", { name: "载入子内容（1）" })).not.toBeInTheDocument();
  const editor = (container.querySelector(".tiptap") as HTMLElement & { editor: Editor }).editor;
  act(() => { editor.commands.undo(); });
  expect(handle!.snapshot().blocks[0].children[0].id).toBe("child");
});

it("rejects editing an unloaded payload and allows it after deliberate hydration", async () => {
  const changed = vi.fn();
  let handle: EditorContentHandle | null = null;
  const blocks: NoteBlocksV2 = { schema_version: 2, editor: "blocknote", blocks: [paragraph("large", "")] };
  const states = new Map([["large", { id: "large", parent_id: null, child_count: 0, has_children: false, children_loaded: true, payload_loaded: false, payload_bytes: 300000, cursor: null, loaded_count: 0 }]]);
  const { container, rerender } = render(<TiptapEditor blocks={blocks} loadStates={states} onContentReady={value => { handle = value; }} onChange={changed} />);
  await waitFor(() => expect(handle).not.toBeNull());
  const editor = (container.querySelector(".tiptap") as HTMLElement & { editor: Editor }).editor;
  act(() => { editor.commands.setTextSelection(1); editor.commands.insertContent("must not replace stored body"); });
  expect(changed).not.toHaveBeenCalled();
  act(() => { handle!.hydratePayload(paragraph("large", "original body")); });
  const loaded = new Map([["large", { ...states.get("large")!, payload_loaded: true }]]);
  rerender(<TiptapEditor blocks={blocks} loadStates={loaded} onContentReady={value => { handle = value; }} onChange={changed} />);
  act(() => { editor.commands.setTextSelection(1); editor.commands.insertContent("edit "); });
  expect(editor.state.doc.textContent).toBe("edit original body");
  expect(changed).toHaveBeenCalledOnce();
});

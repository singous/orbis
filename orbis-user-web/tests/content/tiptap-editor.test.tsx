import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";
import { TiptapEditor } from "../../src/features/notes/TiptapEditor";
import type { NoteBlocksV2 } from "../../src/features/notes/block-model";
import * as model from "../../src/features/notes/tiptap-model";

const initial: NoteBlocksV2 = { schema_version: 2, editor: "blocknote", blocks: [
  { id: "paragraph", type: "paragraph", props: {}, content: [{ type: "text", text: "已有正文" }], children: [] },
] };

afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

it("does not emit a save when opening a document or toggling permissions", async () => {
  const changed = vi.fn();
  const { rerender } = render(<TiptapEditor blocks={initial} onChange={changed} />);
  await screen.findByText("已有正文");
  expect(changed).not.toHaveBeenCalled();
  rerender(<TiptapEditor blocks={initial} readOnly onChange={changed} />);
  rerender(<TiptapEditor blocks={initial} onChange={changed} />);
  expect(changed).not.toHaveBeenCalled();
});

it("selects insertion commands with the keyboard and dismisses the menu", async () => {
  const changed = vi.fn();
  render(<TiptapEditor blocks={initial} onChange={changed} />);
  const insert = await screen.findByRole("button", { name: "插入内容" });
  await userEvent.click(insert);
  await userEvent.keyboard("{ArrowDown}{Enter}");
  expect(changed.mock.calls.at(-1)[0].blocks.blocks[0]).toMatchObject({ type: "heading", props: { level: 1 } });
  expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
  await userEvent.click(insert);
  await userEvent.keyboard("{Escape}");
  expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
});

it("reports conversion failures and retries the retained live document", async () => {
  const changed = vi.fn();
  const failed = vi.fn();
  render(<TiptapEditor blocks={initial} onChange={changed} onError={failed} />);
  await screen.findByText("已有正文");
  vi.spyOn(model, "fromTiptapDocument").mockImplementationOnce(() => { throw new Error("Conversion failure"); });
  await userEvent.click(screen.getByRole("button", { name: "标题 1" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("正文暂未保存");
  expect(changed).not.toHaveBeenCalled();
  expect(failed).toHaveBeenCalledWith(expect.stringContaining("正文暂未保存"));
  await userEvent.click(screen.getByRole("button", { name: "重试保存正文" }));
  expect(changed.mock.calls[0][0].blocks.blocks[0]).toMatchObject({ type: "heading", content: [{ type: "text", text: "已有正文" }] });
  expect(failed).toHaveBeenLastCalledWith(null);
});

it("formats a stored paragraph through the real Tiptap React surface", async () => {
  const user = userEvent.setup();
  let latest = initial;
  const { container } = render(<TiptapEditor blocks={initial} onChange={({ blocks }) => { latest = blocks; }} />);
  await waitFor(() => expect(container.querySelector(".ProseMirror")).toBeInTheDocument());
  await user.click(screen.getByRole("button", { name: "标题 1" }));
  await waitFor(() => expect(latest.blocks[0].type).toBe("heading"));
  expect(latest.blocks[0].id).toBe("paragraph");
});

it("keeps a read only document visible without exposing edit controls", async () => {
  const { container } = render(<TiptapEditor blocks={initial} readOnly onChange={() => { throw new Error("Read only document changed"); }} />);
  expect(await screen.findByText("已有正文")).toBeVisible();
  expect(container.querySelector(".ProseMirror")).toHaveAttribute("contenteditable", "false");
  expect(screen.queryByRole("toolbar", { name: "文档格式" })).not.toBeInTheDocument();
});

it("updates documentation component properties without dropping its body", async () => {
  const user = userEvent.setup();
  const card: NoteBlocksV2 = { schema_version: 2, editor: "blocknote", blocks: [{
    id: "card", type: "card", props: { title: "原卡片", href: "" }, content: [], children: [
      { id: "body", type: "paragraph", props: {}, content: [{ type: "text", text: "保留正文" }], children: [] },
    ],
  }] };
  let latest = card;
  render(<TiptapEditor blocks={card} onChange={({ blocks }) => { latest = blocks; }} />);
  await user.click(await screen.findByRole("button", { name: "编辑卡片属性" }));
  const input = await screen.findByRole("textbox", { name: "卡片标题" });
  await user.clear(input);
  await user.type(input, "快速开始");
  await waitFor(() => expect(latest.blocks[0].props.title).toBe("快速开始"));
  expect(latest.blocks[0].children[0].content).toEqual([{ type: "text", text: "保留正文" }]);
});

it("retains an imported code language in read only mode", async () => {
  const code: NoteBlocksV2 = { schema_version: 2, editor: "blocknote", blocks: [{ id: "code", type: "codeBlock", props: { language: "rust" }, content: "fn main() {}", children: [] }] };
  render(<TiptapEditor blocks={code} readOnly onChange={() => { throw new Error("Read only document changed"); }} />);
  expect(await screen.findByRole("combobox", { name: "代码语言" })).toHaveValue("rust");
  expect(screen.getByRole("combobox", { name: "代码语言" })).toBeDisabled();
});

it("applies an externally restored revision while the editor is temporarily read only", async () => {
  const restored: NoteBlocksV2 = { schema_version: 2, editor: "blocknote", blocks: [
    { id: "old", type: "paragraph", props: {}, content: [{ type: "text", text: "已恢复正文" }], children: [] },
  ] };
  const { container, rerender } = render(<TiptapEditor blocks={initial} onChange={() => {}} />);
  expect(await screen.findByText("已有正文")).toBeVisible();
  rerender(<TiptapEditor blocks={initial} readOnly onChange={() => {}} />);
  rerender(<TiptapEditor blocks={restored} readOnly onChange={() => {}} />);
  await waitFor(() => expect(container.querySelector(".ProseMirror")).toHaveTextContent("已恢复正文"));
  rerender(<TiptapEditor blocks={restored} onChange={() => {}} />);
  expect(container.querySelector(".ProseMirror")).toHaveAttribute("contenteditable", "true");
});

it("hides component property controls during a temporary read only operation", async () => {
  const card: NoteBlocksV2 = { schema_version: 2, editor: "blocknote", blocks: [{ id: "card", type: "card", props: { title: "卡片标题", href: "" }, content: [], children: [] }] };
  const { rerender } = render(<TiptapEditor blocks={card} onChange={() => {}} />);
  await userEvent.click(await screen.findByRole("button", { name: "编辑卡片属性" }));
  expect(await screen.findByRole("textbox", { name: "卡片标题" })).toBeVisible();
  rerender(<TiptapEditor blocks={card} readOnly onChange={() => {}} />);
  await waitFor(() => expect(screen.queryByRole("textbox", { name: "卡片标题" })).not.toBeInTheDocument());
  rerender(<TiptapEditor blocks={card} onChange={() => {}} />);
  expect(await screen.findByRole("textbox", { name: "卡片标题" })).toBeVisible();
});

it('applies restore of the initially opened revision after editing and saving', async () => {
  let latest = initial;
  const changed = vi.fn(({blocks}: { blocks: NoteBlocksV2 }) => { latest = blocks; });
  const {container, rerender} = render(<TiptapEditor blocks={initial} onChange={changed} />);
  await screen.findByText("已有正文");
  await userEvent.click(screen.getByRole('button', { name: '标题 1' }));
  expect(latest.blocks[0].type).toBe('heading');
  rerender(<TiptapEditor blocks={latest} onChange={changed} />);
  rerender(<TiptapEditor blocks={latest} readOnly onChange={changed} />);
  rerender(<TiptapEditor blocks={structuredClone(initial)} readOnly onChange={changed} />);
  await waitFor(() => expect(container.querySelector('.ProseMirror > p')).toHaveTextContent("已有正文"));
});

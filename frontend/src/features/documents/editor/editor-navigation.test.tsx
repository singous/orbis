import {nativeEditorServer} from "./editor.test-utils";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Link, MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { DocumentEditorPage } from "./DocumentEditorPage";
import type { NoteBlocksV2 } from "../../content/model/blocks";
import { NOTE_ID, NOTEBOOK_ID, USER_ID, WORKSPACE_ID, blocks, content, http, page, response, session } from "../../collaboration/collaboration.test-utils";
import { authStore } from "../../../shared/auth/auth-store";
import { preparePendingNavigation } from "../../../shared/navigation/pending-navigation";

vi.mock("../DocumentShell", () => ({ DocumentShell: ({ toolbar, children }: { toolbar: React.ReactNode; children: React.ReactNode }) => <main>{toolbar}{children}</main> }));
vi.mock("./TiptapEditor", () => ({
  TiptapEditor: ({ blocks: value, onChange, onError, readOnly }: { blocks: NoteBlocksV2; onChange: (next: { blocks: ReturnType<typeof blocks> }) => void; onError: (message: string) => void; readOnly: boolean }) => <>
    <textarea aria-label="编辑正文" readOnly={readOnly} value={String((value.blocks[0]?.content as { text: string }[])?.[0]?.text ?? "")} onChange={event => onChange({ blocks: blocks(event.target.value) })} />
    <button onClick={() => onError("正文转换失败，本地编辑仍保留。")}>模拟转换失败</button>
  </>,
}));

let client: QueryClient;
beforeEach(() => {
  act(() => authStore.setState(session));
  client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
});
afterEach(() => { cleanup(); client.clear(); vi.unstubAllGlobals(); act(() => authStore.getState().clearSession()); });

function showEditor() {
  return render(<QueryClientProvider client={client}><MemoryRouter initialEntries={[`/documents/${NOTE_ID}`]}>
    <Link to="/elsewhere">离开文档</Link><Routes><Route path="/documents/:noteId" element={<DocumentEditorPage />} /><Route path="/elsewhere" element={<h1>其他页面</h1>} /><Route path="/collections/:notebookId" element={<h1>笔记本</h1>} /></Routes>
  </MemoryRouter></QueryClientProvider>);
}
function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>(done => { resolve = done; });
  return { promise, resolve };
}
function server(options:{status?:number;firstSave?:Promise<void>}={}){return nativeEditorServer({saveStatus:options.status,saveGate:options.firstSave});}

it("flushes title and body on selected navigation without unmounting or changing the draft", async () => {
  const { stored, requests } = server(); showEditor();
  const editor = await screen.findByLabelText("编辑正文");
  expect(requests.filter(item => item.method !== "GET")).toHaveLength(0);
  fireEvent.change(screen.getByLabelText("文档标题"), { target: { value: "搜索前标题" } });
  fireEvent.change(editor, { target: { value: "搜索前正文" } });
  await act(async () => { await preparePendingNavigation(); });
  expect(stored.note.title).toBe("搜索前标题");
  expect(stored.content).toMatchObject({ plain_text: "搜索前正文", content_version: 5 });
  expect(requests.filter(item => item.method !== "GET").map(item => item.method)).toEqual(["POST"]);
  expect(screen.getByLabelText("编辑正文")).toBe(editor);
  expect(editor).toHaveValue("搜索前正文");
});

it.each([409, 500])("keeps the draft after a %s and does not silently retry the failed save", async status => {
  const { requests } = server({ status }); showEditor();
  const editor = await screen.findByLabelText("编辑正文");
  fireEvent.change(editor, { target: { value: "不能丢失的草稿" } });
  await act(async () => { await expect(preparePendingNavigation()).rejects.toThrow("本地草稿仍保留"); });
  await expect(preparePendingNavigation()).rejects.toThrow("本地草稿仍保留");
  expect(requests.filter(item => item.path.endsWith("/operations"))).toHaveLength(status===500?2:1);
  expect(editor).toHaveValue("不能丢失的草稿");
  expect(editor).not.toHaveAttribute("readonly");
});

it("rejects conversion failure without writing an incomplete body", async () => {
  const { requests } = server(); showEditor();
  await screen.findByLabelText("编辑正文");
  fireEvent.click(screen.getByRole("button", { name: "模拟转换失败" }));
  await expect(preparePendingNavigation()).rejects.toThrow("正文转换失败");
  expect(requests.filter(item => item.method !== "GET")).toHaveLength(0);
});

it("flushes a newer draft queued behind an existing in-flight save", async () => {
  const firstSave = deferred();
  const { requests, stored } = server({ firstSave: firstSave.promise }); showEditor();
  const editor = await screen.findByLabelText("编辑正文");
  fireEvent.change(editor, { target: { value: "第一版" } });
  await waitFor(() => expect(requests.some(item => item.path.endsWith("/operations"))).toBe(true));
  fireEvent.change(editor, { target: { value: "最新正文" } });
  let pending!: Promise<void>;
  act(() => { pending = preparePendingNavigation(); });
  await act(async () => { firstSave.resolve(); await pending; });
  expect(requests.filter(item => item.path.endsWith("/operations")).map(item => item.body?.expected_version)).toEqual([4, 5]);
  expect(stored.content).toMatchObject({ plain_text: "最新正文", content_version: 6 });
});

it("cancels the pending transition after close while completing its save", async () => {
  const firstSave = deferred();
  const { requests, stored } = server({ firstSave: firstSave.promise }); showEditor();
  const editor = await screen.findByLabelText("编辑正文");
  fireEvent.change(editor, { target: { value: "关闭搜索后保留" } });
  const controller = new AbortController();
  let pending!: Promise<void>;
  act(() => { pending = preparePendingNavigation(controller.signal); });
  const failure = expect(pending).rejects.toMatchObject({ name: "AbortError" });
  await waitFor(() => expect(requests.some(item => item.path.endsWith("/operations"))).toBe(true));
  controller.abort();
  await act(async () => { firstSave.resolve(); await failure; });
  expect(stored.content.plain_text).toBe("关闭搜索后保留");
  expect(editor).toHaveValue("关闭搜索后保留");
});

it("allows a clean read-only document to remain open without a write", async () => {
  const { requests } = server();
  act(() => authStore.setState({ workspace: { ...session.workspace, role: "viewer" } }));
  showEditor(); await screen.findByLabelText("编辑正文");
  await preparePendingNavigation();
  expect(requests.filter(item => item.method !== "GET")).toHaveLength(0);
});

it("does not authorize a late result open after the source editor was unmounted", async () => {
  const firstSave = deferred();
  const { requests, stored } = server({ firstSave: firstSave.promise }); showEditor();
  const editor = await screen.findByLabelText("编辑正文");
  fireEvent.change(editor, { target: { value: "切换前草稿" } });
  const navigate = vi.fn();
  let pending!: Promise<void>;
  act(() => { pending = preparePendingNavigation().then(navigate); });
  const failure = expect(pending).rejects.toMatchObject({ name: "AbortError" });
  await waitFor(() => expect(requests.some(item => item.path.endsWith("/operations"))).toBe(true));
  fireEvent.click(screen.getByRole("link", { name: "离开文档" }));
  await screen.findByRole("heading", { name: "其他页面" });
  await act(async () => { firstSave.resolve(); await failure; });
  expect(navigate).not.toHaveBeenCalled();
  expect(stored.content.plain_text).toBe("切换前草稿");
  await preparePendingNavigation();
});

it("does not interrupt an archive that is still flushing its draft", async () => {
  const firstSave = deferred();
  const { requests } = server({ firstSave: firstSave.promise }); showEditor();
  const editor = await screen.findByLabelText("编辑正文");
  fireEvent.change(editor, { target: { value: "归档前草稿" } });
  await userEvent.click(screen.getByRole("button", { name: "更多文档操作" }));
  await userEvent.click(await screen.findByRole("menuitem", { name: "归档文档" }));
  await waitFor(() => expect(requests.some(item => item.path.endsWith("/operations"))).toBe(true));
  await expect(preparePendingNavigation()).rejects.toThrow("正在恢复或归档");
  expect(requests.filter(item => item.path.endsWith("/operations"))).toHaveLength(1);
  await act(async () => { firstSave.resolve(); });
  await screen.findByRole("heading", { name: "笔记本" });
});

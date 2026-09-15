import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { authStore } from "../../shared/auth/auth-store";
import type { NoteBlocksV2 } from "../notes/block-model";
import { DocumentEditorPage } from "../documents/DocumentEditorPage";
import { NOTE_ID, NOTEBOOK_ID, REVISION_ID, WORKSPACE_ID, USER_ID, blocks, content, http, page, response, revision, session } from "./collaboration.test-utils";

vi.mock("../documents/DocumentShell", () => ({ DocumentShell: ({ toolbar, children }: { toolbar: React.ReactNode; children: React.ReactNode }) => <main>{toolbar}{children}</main> }));
vi.mock("../notes/BlockNoteEditor", () => ({ BlockNoteEditor: ({ blocks: value, onChange, readOnly }: { blocks: NoteBlocksV2; onChange: (next: { blocks: ReturnType<typeof blocks> }) => void; readOnly: boolean }) => <textarea aria-label="编辑正文" readOnly={readOnly} value={String((value.blocks[0]?.content as { text: string }[])?.[0]?.text ?? "")} onChange={(event) => onChange({ blocks: blocks(event.target.value) })} /> }));
let client: QueryClient;
beforeEach(() => { act(() => authStore.setState(session)); client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } }); });
afterEach(() => { cleanup(); client.clear(); vi.unstubAllGlobals(); act(() => authStore.getState().clearSession()); });
function showEditor() {
  return render(<QueryClientProvider client={client}><MemoryRouter initialEntries={[`/documents/${NOTE_ID}`]}><Routes><Route path="/documents/:noteId" element={<DocumentEditorPage />} /></Routes></MemoryRouter></QueryClientProvider>);
}
function server(mutate: (url: URL, init: RequestInit) => Response | Promise<Response>) {
  return http((url, init) => {
    if (init.method && init.method !== "GET") return mutate(url, init);
    if (url.pathname.endsWith("/content")) return response(content());
    if (url.pathname.endsWith("/comments")) return response(page([]));
    if (url.pathname.endsWith("/revisions")) return response(page([revision]));
    if (url.pathname.endsWith(REVISION_ID)) return response({ ...revision, blocks: blocks("历史正文"), plain_text: "历史正文" });
    if (url.pathname.endsWith(NOTE_ID)) return response({ id: NOTE_ID, tenant_id: null, workspace_id: WORKSPACE_ID, owner_id: USER_ID, status: "active", created_at_ms: 1, updated_at_ms: 1, notebook_id: NOTEBOOK_ID, parent_id: null, sort_order: 0, title: "产品计划", note_type: "document" });
    return response(page([]));
  });
}
async function openHistory(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole("button", { name: "评论与历史" }));
  await user.click(await screen.findByRole("button", { name: "历史版本" }));
  await user.click(await screen.findByRole("button", { name: /查看版本 2/ }));
  await screen.findByText("历史正文");
}

describe("restoring from the editor", () => {
  it("saves the local draft before restore and uses its newly saved version", async () => {
    let finishSave!: (value: Response) => void;
    const requests = server((url) => url.pathname.endsWith("/content") ? new Promise<Response>((resolve) => { finishSave = resolve; }) : response(content(6, "历史正文")));
    const user = userEvent.setup();
    showEditor();
    const editor = await screen.findByLabelText("编辑正文");
    await user.clear(editor); await user.type(editor, "恢复前草稿");
    await openHistory(user);
    await user.click(screen.getByRole("button", { name: "恢复此版本" }));
    await waitFor(() => expect(requests.filter((request) => request.method === "PUT")).toHaveLength(1));
    expect(requests.some((request) => request.method === "POST")).toBe(false);
    expect(editor).toHaveAttribute("readonly");
    expect(screen.getByRole("button", { name: "关闭评论与历史" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "评论" })).toBeDisabled();
    await act(async () => { finishSave(response(content(5, "恢复前草稿"))); });
    await screen.findByRole("status", { name: "恢复结果" });
    expect(requests.filter((request) => request.method === "PUT").map((request) => request.body)).toEqual([{ expected_version: 4, blocks: blocks("恢复前草稿") }]);
    expect(requests.find((request) => request.method === "POST")?.body).toEqual({ expected_version: 5 });
    await user.click(screen.getByRole("button", { name: "关闭评论与历史" }));
    expect(screen.getByLabelText("编辑正文")).toHaveValue("历史正文");
    expect(screen.getByText("版本 6")).toBeInTheDocument();
  });

  it.each([409, 500])("blocks restore when saving fails with %s and keeps the local draft", async (status) => {
    const requests = server(() => response(null, status, status === 409 ? "版本冲突" : "网络错误"));
    const user = userEvent.setup();
    showEditor();
    const editor = await screen.findByLabelText("编辑正文");
    await user.clear(editor); await user.type(editor, "不能丢失的草稿");
    await openHistory(user);
    await user.click(screen.getByRole("button", { name: "恢复此版本" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(/保存|冲突/);
    expect(requests.some((request) => request.method === "POST")).toBe(false);
    const saveCount = requests.filter((request) => request.method === "PUT").length;
    await user.click(screen.getByRole("button", { name: "恢复此版本" }));
    expect(requests.filter((request) => request.method === "PUT")).toHaveLength(saveCount);
    await user.click(screen.getByRole("button", { name: "关闭评论与历史" }));
    expect(screen.getByLabelText("编辑正文")).toHaveValue("不能丢失的草稿");
  });

  it("keeps ordinary members' editor read-only while allowing history access", async () => {
    act(() => authStore.setState({ ...session, workspace: { ...session.workspace, role: "normal" } }));
    const requests = server(() => response(null, 403));
    const user = userEvent.setup();
    showEditor();
    expect(await screen.findByLabelText("编辑正文")).toHaveAttribute("readonly");
    expect(screen.getByLabelText("文档标题")).toHaveAttribute("readonly");
    await openHistory(user);
    expect(screen.queryByRole("button", { name: "恢复此版本" })).not.toBeInTheDocument();
    expect(requests.every((request) => request.method === "GET")).toBe(true);
  });
  it("keeps unsaved work when a newer background response arrives", async () => {
    server(() => response(content(7, "本地编辑")));
    const user = userEvent.setup();
    showEditor();
    const editor = await screen.findByLabelText("编辑正文");
    await user.clear(editor); await user.type(editor, "本地编辑");
    act(() => { client.setQueryData(["note-content", NOTE_ID], content(6, "其他窗口的内容")); });
    expect(screen.getByLabelText("编辑正文")).toHaveValue("本地编辑");
  });

  it("keeps the saved draft after a restore conflict and requires conflict resolution", async () => {
    const requests = server((url) => url.pathname.endsWith("/restore") ? response(null, 409, "版本已更新") : response(content(5, "本地编辑")));
    const user = userEvent.setup();
    showEditor();
    const editor = await screen.findByLabelText("编辑正文");
    await user.clear(editor); await user.type(editor, "本地编辑");
    await openHistory(user);
    await user.click(screen.getByRole("button", { name: "恢复此版本" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(/冲突/);
    await user.click(screen.getByRole("button", { name: "恢复此版本" }));
    expect(requests.filter((request) => request.method === "POST")).toHaveLength(1);
    await user.click(screen.getByRole("button", { name: "关闭评论与历史" }));
    expect(screen.getByLabelText("编辑正文")).toHaveValue("本地编辑");
    expect(screen.getByText("检测到其他窗口的更新")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "复制本地 Markdown" })).toBeInTheDocument();
  });

  it("does not restore a document left while its pending save is finishing", async () => {
    let finishSave!: (value: Response) => void;
    const requests = server((url) => url.pathname.endsWith("/content") ? new Promise<Response>((resolve) => { finishSave = resolve; }) : response(content(6, "历史正文")));
    const user = userEvent.setup();
    const view = showEditor();
    const editor = await screen.findByLabelText("编辑正文");
    await user.clear(editor); await user.type(editor, "离开前草稿");
    await openHistory(user);
    await user.click(screen.getByRole("button", { name: "恢复此版本" }));
    await waitFor(() => expect(requests.some((request) => request.method === "PUT")).toBe(true));
    view.unmount();
    await act(async () => { finishSave(response(content(5, "离开前草稿"))); });
    expect(requests.some((request) => request.method === "POST")).toBe(false);
  });

});

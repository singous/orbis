import {nativeSnapshot,nativeCollection,nativeDocument} from "../documents/editor/editor.test-utils";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { toast as heroToast } from "@heroui/react/toast";
import { act, cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { authStore } from "../../shared/auth/auth-store";
import { Toaster } from "../../shared/ui/Toast";
import type { NoteBlocksV2 } from "../content/model/blocks";
import { DocumentEditorPage } from "../documents/editor/DocumentEditorPage";
import { NOTE_ID, NOTEBOOK_ID, USER_ID, blocks, http, page, response, revision, session } from "./collaboration.test-utils";

vi.mock("../documents/DocumentShell", () => ({ DocumentShell: ({ toolbar, children }: { toolbar: React.ReactNode; children: React.ReactNode }) => <main>{toolbar}{children}</main> }));
vi.mock("../documents/editor/TiptapEditor", () => ({ TiptapEditor: ({ blocks: value, onChange, readOnly }: { blocks: NoteBlocksV2; onChange: (next: { blocks: ReturnType<typeof blocks> }) => void; readOnly: boolean }) => {
  const incoming = String((value.blocks[0]?.content as { text: string }[])?.[0]?.text ?? "");
  // ProseMirror owns its live input. The mock must not depend on a parent
  // React commit per character, but still apply an explicit restored body.
  const [local, setLocal] = useState({ source: value, text: incoming });
  if (local.source !== value) setLocal({ source: value, text: incoming });
  return <textarea aria-label="编辑正文" readOnly={readOnly} value={local.source === value ? local.text : incoming} onChange={event => { setLocal({ source: value, text: event.target.value }); onChange({ blocks: blocks(event.target.value) }); }} />;
} }));
let client: QueryClient;
beforeEach(() => { act(() => authStore.setState(session)); client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } }); });
afterEach(() => { act(() => heroToast.clear()); cleanup(); client.clear(); vi.unstubAllGlobals(); act(() => authStore.getState().clearSession()); });
function showEditor() {
  return render(<QueryClientProvider client={client}><MemoryRouter initialEntries={[`/documents/${NOTE_ID}`]}><Routes><Route path="/documents/:noteId" element={<DocumentEditorPage />} /></Routes></MemoryRouter><Toaster /></QueryClientProvider>);
}
const commandResult=(version:number)=>({document_id:NOTE_ID,operation_id:USER_ID,base_version:version-1,content_version:version,title:"产品计划",changed_block_ids:[],deleted_block_ids:[]});
function server(mutate: (url: URL, init: RequestInit) => Response | Promise<Response>) {
  return http((url, init) => {
    if (init.method && init.method !== "GET") return mutate(url, init);
    if(url.pathname.endsWith(`/collections/${NOTEBOOK_ID}`))return response(nativeCollection);
    if(url.pathname.endsWith("/children")){
      const snapshot=nativeSnapshot();return response({version:4,items:snapshot.blocks.map((block,position)=>({id:block.id,parent_id:null,position,block_type:block.type,payload_loaded:true,payload_bytes:100,block_revision:4,child_count:0,payload:{type:block.type,props:block.props,content:block.content}})),pagination:{next_cursor:null,has_more:false}});
    }
    if(url.pathname.endsWith("/content"))return response(nativeSnapshot(Number(url.searchParams.get("version")??4),url.searchParams.has("version")?"历史正文":"当前正文"));
    if (url.pathname.endsWith("/comments")) return response(page([]));
    if (url.pathname.endsWith("/revisions")) return response(page([revision]));
    if (url.pathname.endsWith(NOTE_ID)) return response(nativeDocument);
    return response(page([]));
  });
}
async function openHistory(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole("button", { name: "评论与历史" }));
  await user.click(await screen.findByRole("tab", { name: "历史版本" }));
    await user.click(await screen.findByRole("button", { name: "查看全部保存记录" }));
  await user.click(await screen.findByRole("button", { name: /查看保存记录 2/ }));
  await screen.findByText("历史正文");
}

describe("restoring from the editor", () => {
  it("saves the local draft before restore and uses its newly saved version", async () => {
    let finishSave!: (value: Response) => void;
    const requests = server((url) => url.pathname.endsWith("/operations") ? new Promise<Response>((resolve) => { finishSave = resolve; }) : response(nativeSnapshot(6,"历史正文")));
    const user = userEvent.setup();
    showEditor();
    const editor = await screen.findByLabelText("编辑正文");
    await user.clear(editor); await user.type(editor, "恢复前草稿");
    await openHistory(user);
    await user.click(screen.getByRole("button", { name: "恢复此版本" }));
    await waitFor(() => expect(requests.filter((request) => request.path.endsWith("/operations"))).toHaveLength(1));
    expect(requests.some((request) => request.path.endsWith("/restore"))).toBe(false);
    expect(editor).toHaveAttribute("readonly");
    expect(screen.getByRole("button", { name: "关闭评论与历史" })).toBeDisabled();
    expect(screen.getByRole("tab", { name: "评论" })).toHaveAttribute("aria-disabled", "true");
    await act(async () => { finishSave(response(commandResult(5))); });
    await screen.findByText("历史版本已恢复");
    expect(requests.find(request=>request.path.endsWith("/operations"))?.body).toMatchObject({expected_version:4,operation_id:expect.any(String),operations:[{type:"update_block",block:{content:[{text:"恢复前草稿"}]}}]});
    expect(requests.find((request) => request.path.endsWith("/restore"))?.body).toEqual({ expected_version: 5,source_version:2,operation_id:expect.any(String) });
    await user.click(screen.getByRole("button", { name: "关闭评论与历史" }));
    expect(screen.getByLabelText("编辑正文")).toHaveValue("历史正文");
    expect(screen.queryByText("版本 6")).not.toBeInTheDocument();
  });

  it.each([409, 500])("blocks restore when saving fails with %s and keeps the local draft", async (status) => {
    const requests = server(() => response(null, status, status === 409 ? "版本冲突" : "网络错误"));
    const user = userEvent.setup();
    showEditor();
    const editor = await screen.findByLabelText("编辑正文");
    await user.clear(editor); await user.type(editor, "不能丢失的草稿");
    await openHistory(user);
    await user.click(screen.getByRole("button", { name: "恢复此版本" }));
    expect(await within(screen.getByRole("region", { name: "文档历史版本" })).findByRole("alert")).toHaveTextContent(/保存|冲突/);
    expect(requests.some((request) => request.path.endsWith("/restore"))).toBe(false);
    const saveCount = requests.filter((request) => request.path.endsWith("/operations")).length;
    await user.click(screen.getByRole("button", { name: "恢复此版本" }));
    expect(requests.filter((request) => request.path.endsWith("/operations"))).toHaveLength(saveCount);
    await user.click(screen.getByRole("button", { name: "关闭评论与历史" }));
    expect(screen.getByLabelText("编辑正文")).toHaveValue("不能丢失的草稿");
  });

  it("keeps ordinary members' editor read-only while allowing history access", async () => {
    act(() => authStore.setState({ ...session, workspace: { ...session.workspace, role: "viewer" } }));
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
    server(() => response(commandResult(7)));
    const user = userEvent.setup();
    showEditor();
    const editor = await screen.findByLabelText("编辑正文");
    await user.clear(editor); await user.type(editor, "本地编辑");
    act(() => { client.setQueryData(["note-content-pages", NOTE_ID], {...client.getQueryData<Record<string,unknown>>(["note-content-pages",NOTE_ID]),content_version:6,blocks:blocks("其他窗口的内容")}); });
    expect(screen.getByLabelText("编辑正文")).toHaveValue("本地编辑");
  });

  it("keeps the saved draft after a restore conflict and requires conflict resolution", async () => {
    const requests = server((url) => url.pathname.endsWith("/restore") ? response(null, 409, "版本已更新") : response(commandResult(5)));
    const user = userEvent.setup();
    showEditor();
    const editor = await screen.findByLabelText("编辑正文");
    await user.clear(editor); await user.type(editor, "本地编辑");
    await openHistory(user);
    await user.click(screen.getByRole("button", { name: "恢复此版本" }));
    expect(await within(screen.getByRole("region", { name: "文档历史版本" })).findByRole("alert")).toHaveTextContent(/冲突/);
    await user.click(screen.getByRole("button", { name: "恢复此版本" }));
    expect(requests.filter((request) => request.path.endsWith("/restore"))).toHaveLength(1);
    await user.click(screen.getByRole("button", { name: "关闭评论与历史" }));
    expect(screen.getByLabelText("编辑正文")).toHaveValue("本地编辑");
    expect(screen.getByText("检测到其他窗口的更新")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "复制本地 Markdown" })).toBeInTheDocument();
  });

  it("does not restore a document left while its pending save is finishing", async () => {
    let finishSave!: (value: Response) => void;
    const requests = server((url) => url.pathname.endsWith("/operations") ? new Promise<Response>((resolve) => { finishSave = resolve; }) : response(nativeSnapshot(6,"历史正文")));
    const user = userEvent.setup();
    const view = showEditor();
    const editor = await screen.findByLabelText("编辑正文");
    await user.clear(editor); await user.type(editor, "离开前草稿");
    await openHistory(user);
    await user.click(screen.getByRole("button", { name: "恢复此版本" }));
    await waitFor(() => expect(requests.some((request) => request.path.endsWith("/operations"))).toBe(true));
    view.unmount();
    await act(async () => { finishSave(response(commandResult(5))); });
    expect(requests.some((request) => request.path.endsWith("/restore"))).toBe(false);
  });

});

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState, type ReactNode } from "react";
import { MemoryRouter, useLocation } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { DocumentPreviewDialog } from "./DocumentPreviewDialog";
import { authStore } from "../../shared/auth/auth-store";

const NOTE_ID = "018ff7c4-a5b6-7000-8000-000000000001";
const OTHER_ID = "018ff7c4-a5b6-7000-8000-000000000002";
const WORKSPACE_ID = "018ff7c4-a5b6-7000-8000-000000000003";
const FILE_ID = "018ff7c4-a5b6-7000-8000-000000000004";
const user = {bio:null,avatar_asset_id:null,profile_version:1,id: OTHER_ID, email: "owner@orbis.test", display_name: "Owner", preferred_workspace_id: WORKSPACE_ID, status: "active", created_at_ms: 1, updated_at_ms: 1 };
const workspace = { id: WORKSPACE_ID, name: "预览空间", workspace_type: "private", role: "owner" as const, is_current: true, created_at_ms: 1, updated_at_ms: 1 };

function note(id = NOTE_ID) {
  return { id, title: id === NOTE_ID ? "保存的标题" : "另一篇标题", workspace_id: WORKSPACE_ID, owner_id: OTHER_ID, collection_id:WORKSPACE_ID,parent_id:null,position:0,content_version:3,is_archived:false,archived_at_ms:null, created_at_ms: 1, updated_at_ms: 1 };
}
function blocks(text = "已保存正文") {
  return [{id:FILE_ID,type:"paragraph",props:{},content:[{text,marks:[],href:null}],children:[]}];
}
function content(id = NOTE_ID, value: unknown = blocks()) {
  return {revision:{document_id:id,version:3,title:note(id).title,title_recorded:true,author_id:OTHER_ID,author_name:"Owner",restored_from_version:null,created_at_ms:1},blocks:value};
}
function response(data: unknown, status = 200) {
  return new Response(JSON.stringify({ code: status === 200 ? "OK" : "UNAVAILABLE", message: status === 200 ? "成功" : "正文暂时无法读取", request_id: "preview-test", data }), { status, headers: { "Content-Type": "application/json" } });
}
function CurrentPath() { return <output aria-label="current path">{useLocation().pathname}</output>; }
function Harness() {
  const [noteId, setNoteId] = useState<string | null>(null);
  return <>
    <textarea aria-label="编辑中的草稿" defaultValue="未保存的草稿仍在这里" />
    <button onClick={() => setNoteId(NOTE_ID)}>预览目标文档</button>
    <DocumentPreviewDialog noteId={noteId} onClose={() => setNoteId(null)} />
    <CurrentPath />
  </>;
}
function provide(children: ReactNode, client = new QueryClient({ defaultOptions: { queries: { retry: false } } }), path = `/documents/${OTHER_ID}`) {
  return <QueryClientProvider client={client}><MemoryRouter initialEntries={[path]}>{children}</MemoryRouter></QueryClientProvider>;
}
beforeEach(() => { act(() => authStore.setState({ accessToken: "preview-token", refreshToken: "refresh", user, workspace })); });
afterEach(() => { cleanup(); act(() => authStore.getState().clearSession()); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe("saved document preview", () => {
  it("reads a native saved snapshot only while open, preserving the current draft and route", async () => {
    const requests: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (input: string, options: RequestInit) => {
      expect(options.method).toBe("GET");
      expect(new Headers(options.headers).get("Authorization")).toBe("Bearer preview-token");
      requests.push(input);
      const body=blocks();
      return response(input.endsWith("/content") ? content(NOTE_ID, body) : note());
    }));
    const actor = userEvent.setup();
    render(provide(<Harness />));
    const draft = screen.getByRole("textbox", { name: "编辑中的草稿" });
    const trigger = screen.getByRole("button", { name: "预览目标文档" });
    expect(requests).toHaveLength(0);
    await actor.click(trigger);
    const dialog = screen.getByRole("dialog", { name: "文档预览" });
    expect(within(dialog).getByText("预览已保存的内容")).toBeVisible();
    expect(await within(dialog).findByText("已保存正文")).toBeVisible();
    expect(within(dialog).getByRole("heading", { name: "保存的标题" })).toBeVisible();
    expect(dialog.querySelector('[contenteditable="true"]')).not.toBeInTheDocument();
    expect(draft).toHaveValue("未保存的草稿仍在这里");
    expect(requests.sort()).toEqual([`/api/v1/workspaces/${WORKSPACE_ID}/documents/${NOTE_ID}`, `/api/v1/workspaces/${WORKSPACE_ID}/documents/${NOTE_ID}/content`]);
    await actor.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "文档预览" })).not.toBeInTheDocument());
    await waitFor(() => expect(trigger).toHaveFocus());
    expect(draft).toHaveValue("未保存的草稿仍在这里");
    expect(screen.getByRole("status", { name: "current path" })).toHaveTextContent(`/documents/${OTHER_ID}`);
  });

  it("offers an explicit real document link without closing on a modified click", async () => {
    vi.stubGlobal("fetch", vi.fn(async (input: string) => response(input.endsWith("/content") ? content() : note())));
    render(provide(<Harness />));
    await userEvent.click(screen.getByRole("button", { name: "预览目标文档" }));
    const open = await screen.findByRole("link", { name: "打开文档" });
    expect(open).toHaveAttribute("href", `/documents/${NOTE_ID}`);
    open.addEventListener("click", event => event.preventDefault(), { once: true });
    fireEvent.click(open, { ctrlKey: true });
    expect(screen.getByRole("dialog", { name: "文档预览" })).toBeVisible();
    await userEvent.click(open);
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "文档预览" })).not.toBeInTheDocument());
    expect(screen.getByRole("status", { name: "current path" })).toHaveTextContent(`/documents/${NOTE_ID}`);
  });

  it("keeps loading and failure states explicit and retries the persisted reads", async () => {
    let failed = true;
    vi.stubGlobal("fetch", vi.fn(async (input: string) => input.endsWith("/content") && failed ? response(null, 503) : response(input.endsWith("/content") ? content() : note())));
    render(provide(<DocumentPreviewDialog noteId={NOTE_ID} onClose={vi.fn()} />));
    expect(screen.getByRole("status", { name: "正在加载文档预览…" })).toBeVisible();
    expect(await screen.findByRole("alert")).toHaveTextContent("文档预览加载失败");
    expect(screen.queryByRole("article", { name: "已保存的文档内容" })).not.toBeInTheDocument();
    failed = false;
    await userEvent.click(screen.getByRole("button", { name: "重新加载预览" }));
    expect(await screen.findByText("已保存正文")).toBeVisible();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it.each([{ resource: "content", status: 500 }, { resource: "note", status: 404 }])("isolates a preview $resource $status failure from cached editing queries and the live draft", async ({ resource, status }) => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    client.setQueryData(["note", NOTE_ID], note());
    client.setQueryData(["note-content", NOTE_ID], content());
    const previousNote = client.getQueryState(["note", NOTE_ID]);
    const previousContent = client.getQueryState(["note-content", NOTE_ID]);
    vi.stubGlobal("fetch", vi.fn(async (input: string) => {
      const readingContent = input.endsWith("/content");
      return readingContent === (resource === "content") ? response(null, status) : response(readingContent ? content() : note());
    }));
    render(provide(<Harness />, client, `/documents/${NOTE_ID}`));
    const draft = screen.getByRole("textbox", { name: "编辑中的草稿" });
    const trigger = screen.getByRole("button", { name: "预览目标文档" });
    await userEvent.click(trigger);
    expect(await screen.findByRole("alert")).toHaveTextContent("文档预览加载失败");
    expect(client.getQueryState(["note", NOTE_ID])).toEqual(previousNote);
    expect(client.getQueryState(["note-content", NOTE_ID])).toEqual(previousContent);
    expect(draft).toHaveValue("未保存的草稿仍在这里");
    await userEvent.click(screen.getByRole("button", { name: "关闭预览" }));
    await waitFor(() => expect(trigger).toHaveFocus());
    expect(screen.getByRole("status", { name: "current path" })).toHaveTextContent(`/documents/${NOTE_ID}`);
    expect(draft).toHaveValue("未保存的草稿仍在这里");
    await waitFor(() => expect(client.getQueryCache().findAll({ queryKey: ["document-preview"] })).toHaveLength(0));
  });

  it("reads a fresh saved snapshot on each opening without replacing cached editor content", async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const editingContent = content();
    client.setQueryData(["note-content", NOTE_ID], editingContent);
    let savedText = "第一次保存快照";
    const fetch = vi.fn(async (input: string) => response(input.endsWith("/content") ? content(NOTE_ID, blocks(savedText)) : note()));
    vi.stubGlobal("fetch", fetch);
    render(provide(<Harness />, client));
    const trigger = screen.getByRole("button", { name: "预览目标文档" });
    await userEvent.click(trigger);
    expect(await screen.findByText("第一次保存快照")).toBeVisible();
    expect(client.getQueryData(["note-content", NOTE_ID])).toBe(editingContent);
    await userEvent.click(screen.getByRole("button", { name: "关闭预览" }));
    await waitFor(() => expect(client.getQueryCache().findAll({ queryKey: ["document-preview"] })).toHaveLength(0));
    savedText = "重新打开后的保存快照";
    await userEvent.click(trigger);
    expect(await screen.findByText("重新打开后的保存快照")).toBeVisible();
    expect(screen.queryByText("第一次保存快照")).not.toBeInTheDocument();
    expect(client.getQueryData(["note-content", NOTE_ID])).toBe(editingContent);
    expect(fetch).toHaveBeenCalledTimes(4);
  });

  it("cancels an old preview request when another document is selected", async () => {
    let finishOld!: (value: Response) => void;
    let oldSignal: AbortSignal | null | undefined;
    vi.stubGlobal("fetch", vi.fn((input: string, options: RequestInit) => {
      if (input === `/api/v1/workspaces/${WORKSPACE_ID}/documents/${NOTE_ID}/content`) {
        oldSignal = options.signal;
        return new Promise<Response>(resolve => { finishOld = resolve; });
      }
      return Promise.resolve(response(input.endsWith("/content") ? content(OTHER_ID, blocks("新的已保存正文")) : note(input.includes(OTHER_ID) ? OTHER_ID : NOTE_ID)));
    }));
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const view = render(provide(<DocumentPreviewDialog noteId={NOTE_ID} onClose={vi.fn()} />, client));
    await waitFor(() => expect(oldSignal).toBeDefined());
    view.rerender(provide(<DocumentPreviewDialog noteId={OTHER_ID} onClose={vi.fn()} />, client));
    expect(await screen.findByText("新的已保存正文")).toBeVisible();
    expect(oldSignal?.aborted).toBe(true);
    await act(async () => { finishOld(response(content(NOTE_ID, blocks("过期正文")))); });
    expect(screen.queryByText("过期正文")).not.toBeInTheDocument();
  });

  it("loads private preview media through auth and revokes its object URLs on close", async () => {
    const revoke = vi.fn();
    vi.stubGlobal("URL", class extends URL { static createObjectURL() { return "blob:preview-private"; } static revokeObjectURL = revoke; });
    const media=[{id:FILE_ID,type:"image",props:{source:{type:"asset",asset_id:FILE_ID},name:"预览图片"},content:[],children:[]}];
    vi.stubGlobal("fetch", vi.fn(async (input: string, options: RequestInit) => {
      expect(new Headers(options.headers).get("Authorization")).toBe("Bearer preview-token");
      if (input.startsWith(`/api/v1/workspaces/${WORKSPACE_ID}/assets/`)) return new Response(new Blob(["image"], { type: "image/png" }));
      return response(input.endsWith("/content") ? content(NOTE_ID, media) : note());
    }));
    const view = render(provide(<DocumentPreviewDialog noteId={NOTE_ID} onClose={vi.fn()} />));
    expect(await screen.findByRole("img", { name: "预览图片" })).toHaveAttribute("src", "blob:preview-private");
    view.unmount();
    await waitFor(() => expect(revoke).toHaveBeenCalledWith("blob:preview-private"));
  });
});

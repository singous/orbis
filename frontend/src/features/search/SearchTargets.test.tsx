import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { authStore } from "../../shared/auth/auth-store";
import { ArchivePage } from "../documents/ArchivePage";
import { SearchGroupTarget } from "./SearchGroupTarget";

const mocks = vi.hoisted(() => ({ notes: [] as Record<string, unknown>[], restore: vi.fn(), notebooks: vi.fn(() => ({ data: { items: [] as Record<string, unknown>[] }, isLoading: false, isError: false })) }));
vi.mock("../documents/DocumentShell", () => ({ DocumentShell: ({ children }: { children: React.ReactNode }) => <>{children}</> }));
vi.mock("../documents/queries", async importOriginal => ({
  ...await importOriginal<typeof import("../documents/queries")>(),
  useDocumentGroups: () => ({ data: { items: [] }, isLoading: false }),
  useNotebooks: mocks.notebooks,
  useDocumentIndex: () => ({ data: { items: mocks.notes,pagination:{page:1,page_size:20,total:mocks.notes.length,has_next:false} }, isLoading: false }),
  useArchiveDocumentGroup: () => ({ mutateAsync: mocks.restore, isPending: false }),
  useArchiveNotebook: () => ({ mutateAsync: mocks.restore, isPending: false }),
  useArchiveNote: () => ({ mutateAsync: mocks.restore, isPending: false }),
}));
vi.mock("../../shared/ui/Toast", () => ({ showToast: vi.fn() }));
const id = "018ff7c4-a5b6-7000-8000-000000000001";
const workspaceId = "018ff7c4-a5b6-7000-8000-000000000002";
function fetchTarget(type = "document") {
  return vi.fn(async (input: string) => {
    const url = new URL(input, "http://orbis.test");
    if(url.pathname.endsWith(`/collections/${workspaceId}`))return new Response(JSON.stringify({code:"OK",message:"成功",request_id:"detail",data:{id:workspaceId,workspace_id:workspaceId,group_id:id,title:"文集",sort_order:0,icon:null,metadata_version:1,directory_version:7,is_archived:false,archived_at_ms:null,created_at_ms:1,updated_at_ms:1}}),{headers:{"Content-Type":"application/json"}});
    expect(url.searchParams.get("resource_id")).toBe(id);
    expect(url.searchParams.get("type")).toBe(type);
    return new Response(JSON.stringify({ code: "OK", message: "成功", request_id: "target", data: {
      items: [{ id, type, workspace_id: workspaceId, workspace_name: "当前空间", title: "目标资源", location: "父目录", snippet: "摘要", match: "title", matched_comment_id: null, status: type === "group" ? "active" : "archived", updated_at_ms: 1, collection_id:workspaceId, group_id: null }],
      pagination: { page: 1, page_size: 20, total: 1, total_pages: 1, has_next: false, has_previous: false },
      scope: { workspace_ids: [workspaceId], preferred_workspace_id: workspaceId }, workspaces: [{ id: workspaceId, name: "当前空间", is_current: true }],
    } }), { headers: { "Content-Type": "application/json" } });
  });
}
function provide(children: React.ReactNode, route = "/") {
  return render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><MemoryRouter initialEntries={[route]}>{children}</MemoryRouter></QueryClientProvider>);
}
beforeEach(() => {
  mocks.notes = [];
  mocks.notebooks.mockReturnValue({ data: { items: [] }, isLoading: false, isError: false });
  act(() => authStore.setState({ accessToken: "token", refreshToken: "refresh", workspace: { id: workspaceId, name: "空间", role: "owner", created_at_ms: 1, updated_at_ms: 1 } }));
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.clearAllMocks(); act(() => authStore.getState().clearSession()); });

it.each([false, true])("locates an archived resource independently of loaded pages and deduplicates it (already loaded: %s)", async (loaded) => {
  if (loaded) mocks.notes = [{ id, title: "目标资源", notebook_id: workspaceId }];
  vi.stubGlobal("fetch", fetchTarget());
  provide(<ArchivePage />, `/documents/archive?resource=${id}&type=document`);
  await screen.findByText("目标资源");
  expect(screen.getAllByText("目标资源")).toHaveLength(1);
  expect(screen.getByText("父目录")).toBeVisible();
  expect(screen.getByLabelText("搜索定位的回收站内容")).toHaveFocus();
  await userEvent.click(await screen.findByRole("button", { name: "恢复 目标资源" }));
  expect(mocks.restore).toHaveBeenCalledWith({ id, archived: false,expected_directory_version:7 });
});

it("opens a group outside the loaded group page and loads its notebooks by group id", async () => {
  mocks.notebooks.mockReturnValue({ data: { items: [{ id: workspaceId, title: "目标分组中的笔记本" }] }, isLoading: false, isError: false });
  vi.stubGlobal("fetch", fetchTarget("group"));
  provide(<SearchGroupTarget id={id} canCreate={false} onCreate={() => undefined} />);
  expect(await screen.findByRole("heading", { name: "目标资源" })).toBeVisible();
  expect(screen.getByRole("link", { name: "目标分组中的笔记本" })).toHaveAttribute("href", `/collections/${workspaceId}`);
  await waitFor(() => expect(mocks.notebooks).toHaveBeenCalledWith(id));
});

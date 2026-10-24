import { Toaster } from "../../shared/ui/Toast";
import {QueryClient,QueryClientProvider} from "@tanstack/react-query";
import {authStore} from "../../shared/auth/auth-store";
import { transferableAbortController } from "node:util";
import { render as renderTestingLibrary, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, RouterProvider, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { CollectionsPage } from "./CollectionsPage";
import { DocumentEditorPage } from "./editor/DocumentEditorPage";
import { NotebookPage } from "./NotebookPage";
import { ApiError } from "../../shared/api/api-client";

function render(ui:React.ReactElement){return renderTestingLibrary(<QueryClientProvider client={new QueryClient({defaultOptions:{queries:{retry:false}}})}>{ui}<Toaster /></QueryClientProvider>);}

const mocks = vi.hoisted(() => ({
  metadata:{} as Record<string,unknown>,
  toast: vi.fn(),
  archiveGroup: vi.fn(),
  archiveNotebook: vi.fn(),
  archiveNote: vi.fn(),
  archiveGroupState: {
    isPending: false,
    isError: false,
    error: null as Error | null,
    variables: undefined as { id: string; archived: boolean } | undefined,
  },
  archiveNotebookState: {
    isPending: false,
    isError: false,
    error: null as Error | null,
    variables: undefined as { id: string; archived: boolean } | undefined,
  },
  archiveNoteState: {
    isPending: false,
    isError: false,
    error: null as Error | null,
    variables: undefined as { id: string; archived: boolean } | undefined,
  },
  activeNotes: undefined as unknown[] | undefined,
  activeNotebooks: undefined as unknown[] | undefined,
  noteQueryResult: undefined as Record<string, unknown> | undefined,
  noteSearchCalls: [] as Array<{
    query: string;
    status?: string;
    options?: { enabled?: boolean };
  }>,
  notebookCalls: [] as Array<{
    groupId?: string;
    status?: string;
    options?: { includeInactiveParents?: boolean };
  }>,
}));

vi.mock("../../shared/ui/Toast", async importOriginal => ({
  ...await importOriginal<typeof import("../../shared/ui/Toast")>(),
  showToast: mocks.toast,
  dismissToast: vi.fn(),
  useToast: () => ({ toast: mocks.toast }),
}));

vi.mock("./queries", () => {
  const ids = {
    group: "018ff7c4-a5b6-7000-8000-000000000001",
    notebook: "018ff7c4-a5b6-7000-8000-000000000002",
    firstNote: "018ff7c4-a5b6-7000-8000-000000000003",
    secondNote: "018ff7c4-a5b6-7000-8000-000000000004",
    archivedGroup: "018ff7c4-a5b6-7000-8000-000000000005",
    archivedNotebook: "018ff7c4-a5b6-7000-8000-000000000006",
    archivedNote: "018ff7c4-a5b6-7000-8000-000000000007",
    archivedNotebookWithActiveGroup: "018ff7c4-a5b6-7000-8000-000000000011",
    archivedNoteWithActiveNotebook: "018ff7c4-a5b6-7000-8000-000000000012",
    activeNotebookWithArchivedGroup: "018ff7c4-a5b6-7000-8000-000000000013",
    archivedNoteWithArchivedGroup: "018ff7c4-a5b6-7000-8000-000000000014",
    archivedParentNote: "018ff7c4-a5b6-7000-8000-000000000015",
    archivedChildNote: "018ff7c4-a5b6-7000-8000-000000000016",
    archivedNoteWithArchivedNotebook: "018ff7c4-a5b6-7000-8000-000000000017",
  };
  const common = {
    icon:null,version:3,metadata_version:4,directory_version:7,content_version:2,archived_at_ms:null,
    workspace_id: "018ff7c4-a5b6-7000-8000-000000000008",
    owner_id: "018ff7c4-a5b6-7000-8000-000000000009",
    created_at_ms: 1,
    updated_at_ms: 2,
  };
  const groups = [
    {
      ...common,
      id: ids.group,
      name: "默认分组",
      is_default: true,
      sort_order: 0,
      is_archived:false,
    },
  ];
  const notebooks = [
    {
      ...common,
      id: ids.notebook,
      group_id: ids.group,
      title: "产品手册",
      sort_order: 0,
      is_archived:false,
    },
    {
      ...common,
      id: ids.activeNotebookWithArchivedGroup,
      group_id: ids.archivedGroup,
      title: "已归档分组中的活跃笔记本",
      sort_order: 1,
      is_archived:false,
    },
  ];
  const notes = [
    {
      ...common,
      id: ids.secondNote,
      notebook_id: ids.notebook,
      parent_id: null,
      sort_order: 1,
      title: "更新较早的文档",
      note_type: "document",
      summary: "早期内容",
      updated_at_ms: 10,
      is_archived:false,
    },
    {
      ...common,
      id: ids.firstNote,
      notebook_id: ids.notebook,
      parent_id: null,
      sort_order: 0,
      title: "最新文档",
      note_type: "document",
      summary: "最新内容",
      updated_at_ms: 20,
      is_archived:false,
    },
  ];
  const archivedGroups = [
    {
      ...common,
      id: ids.archivedGroup,
      name: "已归档分组",
      is_default: false,
      sort_order: 0,
      is_archived:true,
    },
  ];
  const archivedNotebooks = [
    {
      ...common,
      id: ids.archivedNotebook,
      group_id: ids.archivedGroup,
      title: "已归档笔记本",
      sort_order: 0,
      is_archived:true,
    },
    {
      ...common,
      id: ids.archivedNotebookWithActiveGroup,
      group_id: ids.group,
      title: "活跃分组中的已归档笔记本",
      sort_order: 1,
      is_archived:true,
    },
  ];
  const archivedNotes = [
    {
      ...common,
      id: ids.archivedNote,
      notebook_id: ids.archivedNotebook,
      parent_id: null,
      sort_order: 0,
      title: "已归档文档",
      note_type: "document",
      summary: "归档内容",
      is_archived:true,
    },
    {
      ...common,
      id: ids.archivedNoteWithActiveNotebook,
      notebook_id: ids.notebook,
      parent_id: null,
      sort_order: 1,
      title: "活跃笔记本中的已归档文档",
      note_type: "document",
      summary: "归档内容",
      is_archived:true,
    },
    {
      ...common,
      id: ids.archivedNoteWithArchivedGroup,
      notebook_id: ids.activeNotebookWithArchivedGroup,
      parent_id: null,
      sort_order: 2,
      title: "已归档分组中的已归档文档",
      note_type: "document",
      summary: "归档内容",
      is_archived:true,
    },
    {
      ...common,
      id: ids.archivedParentNote,
      notebook_id: ids.notebook,
      parent_id: null,
      sort_order: 3,
      title: "已归档父文档",
      note_type: "document",
      summary: "归档内容",
      is_archived:true,
    },
    {
      ...common,
      id: ids.archivedChildNote,
      notebook_id: ids.notebook,
      parent_id: ids.archivedParentNote,
      sort_order: 4,
      title: "已归档子文档",
      note_type: "document",
      summary: "归档内容",
      is_archived:true,
    },
    {
      ...common,
      id: ids.archivedNoteWithArchivedNotebook,
      notebook_id: ids.archivedNotebookWithActiveGroup,
      parent_id: null,
      sort_order: 5,
      title: "已归档笔记本中的已归档文档",
      note_type: "document",
      summary: "归档内容",
      is_archived:true,
    },
  ];
  const result = (items: unknown[]) => ({
    data: { items,pagination:{page:1,page_size:20,total:items.length,has_next:false} },
    isLoading: false,
    isError: false,
  });

  mocks.metadata=Object.fromEntries([...notebooks,...archivedNotebooks].map(item=>[item.id,item]));
  return {
    useDocumentAuth:()=>({accessToken:"access-token",refreshToken:null,workspaceId:"018ff7c4-a5b6-7000-8000-000000000008",onTokenRefresh:vi.fn(),onUnauthorized:vi.fn()}),
    useNotebook: (id?: string) => ({ data: ((mocks.activeNotebooks ?? notebooks) as typeof notebooks).find(item => item.id === id), isLoading: false, isError: false }),
    useDocumentGroups: (status?: string) =>
      result(status === "archived" ? archivedGroups : groups),
    useNotebooks: (
      groupId?: string,
      status?: string,
      options?: { includeInactiveParents?: boolean },
    ) => {
      mocks.notebookCalls.push({ groupId, status, options });
      return result(
        status === "archived"
          ? archivedNotebooks
          : (mocks.activeNotebooks ?? notebooks),
      );
    },
    useDocumentIndex: (status="active") => result(status==="archived"?archivedNotes:mocks.activeNotes??notes),
    useNoteTree: () => result([]),
    useNote: () =>
      mocks.noteQueryResult ?? {
        data: undefined,
        isLoading: false,
        isError: false,
        refetch: vi.fn(),
      },
    useNoteContent: () => ({
      data: undefined,
      isLoading: false,
      isError: false,
      refetch: vi.fn(),
    }),
    useCreateDocumentGroup: () => ({ mutateAsync: vi.fn(), isPending: false }),
    useUpdateDocumentGroup: () => ({ mutateAsync: vi.fn(), isPending: false }),
    useArchiveDocumentGroup: () => ({
      mutate: mocks.archiveGroup,
      mutateAsync: mocks.archiveGroup,
      ...mocks.archiveGroupState,
    }),
    useCreateNotebook: () => ({ mutateAsync: vi.fn(), isPending: false }),
    useUpdateNotebook: () => ({ mutateAsync: vi.fn(), isPending: false }),
    useArchiveNotebook: () => ({
      mutate: mocks.archiveNotebook,
      mutateAsync: mocks.archiveNotebook,
      ...mocks.archiveNotebookState,
    }),
    useCreateNote: () => ({ mutateAsync: vi.fn(), isPending: false }),
    useArchiveNote: () => ({
      mutate: mocks.archiveNote,
      mutateAsync: mocks.archiveNote,
      ...mocks.archiveNoteState,
    }),
    useUpdateNote: () => ({ mutateAsync: vi.fn(), isPending: false }),
    useSaveNoteContent: () => ({ mutateAsync: vi.fn(), isPending: false }),
    useImportMarkdown: () => ({ mutateAsync: vi.fn(), isPending: false }),
    useExportMarkdown: () => ({ mutateAsync: vi.fn(), isPending: false }),
  };
});

const user = {bio: null, avatar_asset_id: null, profile_version: 1,
  id: "018ff7c4-a5b6-7000-8000-000000000010",
  email: "owner@orbis.test",
  display_name: "Orbis Owner",
  preferred_workspace_id: "018ff7c4-a5b6-7000-8000-000000000008",
  created_at_ms: 1,
  updated_at_ms: 1,
};

const workspace = {
  id: "018ff7c4-a5b6-7000-8000-000000000008",
  name: "Orbis Workspace",
  role: "owner" as const,
  created_at_ms: 1,
  updated_at_ms: 1,
};

function sessionFor(role: "owner" | "viewer" = "owner", workspaceOverride?: typeof workspace | null) {
  return {
    credentialID:"synthetic-test-credential",
    accessToken: "access-token",
    refreshToken: "refresh-token",
    user,
    workspace: workspaceOverride === undefined ? { ...workspace, role } : workspaceOverride,
  };
}

async function renderRoute(path: string, role: "owner" | "viewer" = "owner", workspaceOverride?: typeof workspace | null) {
  window.history.replaceState({}, "", path);
  window.localStorage.setItem("orbis.auth.v2", JSON.stringify(sessionFor(role, workspaceOverride)));
  vi.resetModules();
  const { router } = await import("../../app/router");
  return render(<RouterProvider router={router} />);
}

describe("document function pages", () => {
  it("reveals and focuses a collapsed group opened from global search", async () => {
    const groupId = "018ff7c4-a5b6-7000-8000-000000000001";
    localStorage.setItem(`orbis.collapsedDocumentGroups.${workspace.id}`, JSON.stringify([groupId]));
    await renderRoute(`/documents/collections?group=${groupId}`);
    expect(await screen.findByRole("button", { name: "收起分组 默认分组" })).toHaveAttribute("aria-expanded", "true");
    expect(document.getElementById(`group-${groupId}`)).toHaveFocus();
  });
  it("collapses a notebook group with keyboard and restores its choice after remount", async () => {
    const actor = userEvent.setup();
    const view = await renderRoute("/documents/collections");
    const toggle = await screen.findByRole("button", { name: "收起分组 默认分组" });
    expect(toggle).toHaveAttribute("aria-expanded", "true");
    expect(within(screen.getByRole("region", { name: "笔记本" })).getByText("产品手册")).toBeVisible();
    toggle.focus();
    await actor.keyboard("{Enter}");
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(within(screen.getByRole("region", { name: "笔记本" })).queryByText("产品手册")).not.toBeVisible();
    view.unmount();
    await renderRoute("/documents/collections");
    const restored = await screen.findByRole("button", { name: "展开分组 默认分组" });
    expect(restored).toHaveAttribute("aria-expanded", "false");
    await actor.click(restored);
    expect(within(screen.getByRole("region", { name: "笔记本" })).getByText("产品手册")).toBeVisible();
  });

  it("keeps group creation actions independent of the collapsed content", async () => {
    const actor = userEvent.setup();
    await renderRoute("/documents/collections");
    await actor.click(await screen.findByRole("button", { name: "收起分组 默认分组" }));
    const collapsedGroup = screen.getByRole("button", { name: "展开分组 默认分组" });
    await actor.click(screen.getByRole("button", { name: "+ 笔记本" }));
    expect(screen.getByRole("dialog", { name: "新建笔记本" })).toBeVisible();
    expect(collapsedGroup).toHaveAttribute("aria-expanded", "false");
  });

  beforeEach(() => {
    // React Router uses Node's Request in jsdom; its signal must use the same realm.
    vi.stubGlobal("AbortController", transferableAbortController().constructor);
    mocks.toast.mockReset();
    mocks.archiveGroup.mockReset();
    mocks.archiveNotebook.mockReset();
    mocks.archiveNote.mockReset();
    mocks.archiveGroupState.isPending = false;
    mocks.archiveGroupState.isError = false;
    mocks.archiveGroupState.error = null;
    mocks.archiveGroupState.variables = undefined;
    mocks.archiveNotebookState.isPending = false;
    mocks.archiveNotebookState.isError = false;
    mocks.archiveNotebookState.error = null;
    mocks.archiveNotebookState.variables = undefined;
    mocks.archiveNoteState.isPending = false;
    mocks.archiveNoteState.isError = false;
    mocks.archiveNoteState.error = null;
    mocks.archiveNoteState.variables = undefined;
    mocks.activeNotes = undefined;
    mocks.activeNotebooks = undefined;
    mocks.noteQueryResult = undefined;
    mocks.noteSearchCalls.length = 0;
    mocks.notebookCalls.length = 0;
    window.localStorage.clear();
    authStore.getState().setSession(sessionFor());
    vi.stubGlobal("fetch",vi.fn(async(input:string)=>{
      const id=input.split("/").at(-1)??"";
      const data=input.endsWith("/me")?user:mocks.metadata[id];
      return new Response(JSON.stringify({code:data?"OK":"NOT_FOUND",message:"测试",request_id:"test",data:data??null}),{status:data?200:404,headers:{"Content-Type":"application/json"}});
    }));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    window.localStorage.clear();
  });

  it.each([
    ["/documents", "在线文档", "heading"],
    ["/documents/recent", "最近文档", "heading"],
    ["/documents/collections", "我的笔记本", "heading"],
    ["/documents/archive", "回收站", "heading"],
  ] as const)("renders %s as the %s page", async (path, name, role) => {
    await renderRoute(path);
    expect(await screen.findByRole(role, { name, level: 1 })).toBeVisible();
  });

  it("shows recent home documents in the API order", async () => {
    await renderRoute("/home");

    const recent = await screen.findByRole("region", { name: "最近编辑" });
    expect(recent).toHaveTextContent("更新较早的文档");
    expect(recent).toHaveTextContent("最新文档");
    expect(recent.textContent?.indexOf("更新较早的文档")).toBeLessThan(
      recent.textContent?.indexOf("最新文档") ?? -1,
    );
    expect(screen.queryByRole("navigation", { name: "在线文档功能" })).not.toBeInTheDocument();
    expect(document.querySelector(".workspace-shell")).not.toHaveClass("has-section-menu");
  });

  it.each(["/", "/home"])("opens the restored home from %s", async (path) => {
    await renderRoute(path);
    expect(await screen.findByRole("heading", { name: "首页", level: 1 })).toBeVisible();
    expect(window.location.pathname).toBe("/home");
    const rail = screen.getByRole("navigation", { name: "业务板块" });
    expect(within(rail).getByRole("link", { name: "首页" })).toHaveAttribute("aria-current", "page");
    expect(within(rail).getByRole("link", { name: "首页" })).toHaveAttribute("href", "/home");
    expect(screen.getByRole("button", { name: "切换工作空间" })).toBeInTheDocument();
  });

  it("keeps account settings on the workspace shell without document functions", async () => {
    await renderRoute("/settings/account");

    expect(await screen.findByRole("heading", { name: "个人资料", level: 1 })).toBeVisible();
    expect(screen.queryByRole("navigation", { name: "在线文档功能" })).not.toBeInTheDocument();
    expect(document.querySelector(".workspace-shell")).toHaveClass("has-section-menu");
  });

  it("recommends notebook creation on the overview outside any notebook", async () => {
    await renderRoute("/documents");

    expect(await screen.findByRole("button", { name: "新建笔记本" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "新建文档" })).not.toBeInTheDocument();
  });

  it("links the recent empty state to collections", async () => {
    mocks.activeNotes = [];
    await renderRoute("/documents/recent");

    expect(await screen.findByRole("link", { name: "前往我的笔记本" })).toHaveAttribute(
      "href",
      "/documents/collections",
    );
  });

  it("redirects an unavailable collection and shows a floating error", async () => {
    mocks.activeNotebooks = [];
    render(
      <MemoryRouter initialEntries={["/collections/018ff7c4-a5b6-7000-8000-000000000099"]}>
        <Routes>
          <Route path="/collections/:collectionId" element={<NotebookPage />} />
          <Route path="/documents/collections" element={<CollectionsPage />} />
        </Routes>
      </MemoryRouter>,
    );

    expect(await screen.findByRole("heading", { name: "我的笔记本" })).toBeVisible();
    await waitFor(() => expect(mocks.toast).toHaveBeenCalledWith(expect.objectContaining({
      title: "无法打开资源",
      description: expect.stringContaining("无法打开笔记本"),
      tone: "danger",
    })));
    expect(screen.queryByRole("button", { name: "关闭提示" })).not.toBeInTheDocument();
  });

  it("redirects a missing document to collections with a floating error", async () => {
    mocks.noteQueryResult = {
      data: undefined,
      isLoading: false,
      isError: true,
      error: new ApiError(404, "Note not found"),
      refetch: vi.fn(),
    };
    render(
      <MemoryRouter initialEntries={["/documents/018ff7c4-a5b6-7000-8000-000000000099"]}>
        <Routes>
          <Route path="/documents/:noteId" element={<DocumentEditorPage />} />
          <Route path="/documents/collections" element={<CollectionsPage />} />
        </Routes>
      </MemoryRouter>,
    );

    expect(await screen.findByRole("heading", { name: "我的笔记本" })).toBeVisible();
    await waitFor(() => expect(mocks.toast).toHaveBeenCalledWith(expect.objectContaining({
      title: "无法打开资源",
      description: expect.stringContaining("无法打开文档"),
      tone: "danger",
    })));
  });

  it("keeps a transient document query error on the current route", async () => {
    mocks.noteQueryResult = {
      data: undefined,
      isLoading: false,
      isError: true,
      error: new Error("Network request failed"),
      refetch: vi.fn(),
    };
    await renderRoute("/documents/018ff7c4-a5b6-7000-8000-000000000099");

    expect(await screen.findByText("无法打开文档")).toBeVisible();
    expect(screen.queryByRole("heading", { name: "我的笔记本" })).not.toBeInTheDocument();
  });

  it("requires parents to be restored before their archived descendants", async () => {
    await renderRoute("/documents/archive");

    expect(await screen.findByText("归属分组：已归档分组")).toBeVisible();
    expect(screen.getByText("归属笔记本：已归档笔记本")).toBeVisible();
    expect(screen.getAllByText("请先恢复分组").length).toBeGreaterThan(0);
    expect(screen.getAllByText("请先恢复笔记本").length).toBeGreaterThan(0);
    expect(await screen.findByText("请先恢复父文档")).toBeVisible();
    expect(
      screen.getByRole("button", { name: "恢复 已归档笔记本" }),
    ).toBeDisabled();
    expect(
      screen.getByRole("button", { name: "恢复 已归档文档" }),
    ).toBeDisabled();
    const groupBlockedNote = screen.getByRole("button", {
      name: "恢复 已归档分组中的已归档文档",
    });
    expect(groupBlockedNote).toBeDisabled();
    expect(groupBlockedNote.parentElement).toHaveTextContent("请先恢复分组");
    const notebookBlockedNote = screen.getByRole("button", {
      name: "恢复 已归档笔记本中的已归档文档",
    });
    expect(notebookBlockedNote).toBeDisabled();
    expect(notebookBlockedNote.parentElement).toHaveTextContent("请先恢复笔记本");
    const parentBlockedNote = screen.getByRole("button", {
      name: "恢复 已归档子文档",
    });
    expect(parentBlockedNote).toBeDisabled();
    expect(parentBlockedNote.parentElement).toHaveTextContent("请先恢复父文档");
    const fullyBlockedNote = screen.getByRole("button", {
      name: "恢复 已归档文档",
    });
    expect(fullyBlockedNote.parentElement).toHaveTextContent("请先恢复分组");
    expect(mocks.notebookCalls.some(call=>call.options?.includeInactiveParents)).toBe(false);
  });

  it("restores an archived group for an owner", async () => {
    const actor = userEvent.setup();
    await renderRoute("/documents/archive");

    await actor.click(
      await screen.findByRole("button", { name: "恢复 已归档分组" }),
    );

    expect(mocks.archiveGroup).toHaveBeenCalledWith({
      id: "018ff7c4-a5b6-7000-8000-000000000005",
      archived: false,expected_version:3,
    });
  });

  it("allows restores whose direct parent is already active", async () => {
    const actor = userEvent.setup();
    await renderRoute("/documents/archive");

    const notebookButton = await screen.findByRole("button", {
      name: "恢复 活跃分组中的已归档笔记本",
    });
    const noteButton = screen.getByRole("button", {
      name: "恢复 活跃笔记本中的已归档文档",
    });
    expect(notebookButton).toBeEnabled();
    await waitFor(()=>expect(noteButton).toBeEnabled());

    await actor.click(notebookButton);
    await actor.click(noteButton);

    expect(mocks.archiveNotebook).toHaveBeenCalledWith({
      id: "018ff7c4-a5b6-7000-8000-000000000011",
      archived: false,expected_directory_version:7,
    });
    expect(mocks.archiveNote).toHaveBeenCalledWith({
      id: "018ff7c4-a5b6-7000-8000-000000000012",
      archived: false,expected_directory_version:7,
    });
  });

  it("shows a pending restore state for the affected resource", async () => {
    mocks.archiveGroupState.isPending = true;
    mocks.archiveGroupState.variables = {
      id: "018ff7c4-a5b6-7000-8000-000000000005",
      archived: false,
    };
    await renderRoute("/documents/archive");

    expect(await screen.findByText("正在恢复…")).toBeVisible();
    expect(
      screen.getByRole("button", { name: "正在恢复 已归档分组" }),
    ).toBeDisabled();
  });

  it.each([
    new ApiError(403, "Permission denied"),
    new ApiError(409, "Parent resources must be restored first"),
    new Error("Network request failed"),
  ])("shows a floating restore error: %s", async (error) => {
    mocks.archiveNote.mockRejectedValue(error);
    const actor = userEvent.setup();
    await renderRoute("/documents/archive");
    await actor.click(await screen.findByRole("button", { name: "恢复 活跃笔记本中的已归档文档" }));
    await waitFor(() => expect(mocks.toast).toHaveBeenCalledWith(expect.objectContaining({
      title: "恢复失败",
      description: error.message,
      tone: "danger",
    })));
  });

  it("does not offer restore controls to a normal member", async () => {
    await renderRoute("/documents/archive", "viewer");

    await screen.findByRole("heading", { name: "回收站" });
    expect(
      screen.queryByRole("button", { name: /恢复/ }),
    ).not.toBeInTheDocument();
  });

  it("does not offer restore controls without a current workspace", async () => {
    await renderRoute("/documents/archive", "owner", null);

    await screen.findByRole("heading", { name: "回收站" });
    expect(screen.queryByRole("button", { name: /恢复/ })).not.toBeInTheDocument();
  });
});

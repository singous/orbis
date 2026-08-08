import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, RouterProvider, Routes, useLocation } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { DocumentSearchPage } from "./DocumentSearchPage";
import { CollectionsPage } from "./CollectionsPage";
import { DocumentEditorPage } from "./DocumentEditorPage";
import { NotebookPage } from "./NotebookPage";
import { ApiError } from "../../shared/api/api-client";

const mocks = vi.hoisted(() => ({
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
  };
  const common = {
    tenant_id: null,
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
      status: "active",
    },
  ];
  const notebooks = [
    {
      ...common,
      id: ids.notebook,
      group_id: ids.group,
      title: "产品手册",
      sort_order: 0,
      status: "active",
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
      plain_text: "早期内容",
      updated_at_ms: 10,
      status: "active",
    },
    {
      ...common,
      id: ids.firstNote,
      notebook_id: ids.notebook,
      parent_id: null,
      sort_order: 0,
      title: "最新文档",
      note_type: "document",
      plain_text: "最新内容",
      updated_at_ms: 20,
      status: "active",
    },
  ];
  const archivedGroups = [
    {
      ...common,
      id: ids.archivedGroup,
      name: "已归档分组",
      is_default: false,
      sort_order: 0,
      status: "archived",
    },
  ];
  const archivedNotebooks = [
    {
      ...common,
      id: ids.archivedNotebook,
      group_id: ids.archivedGroup,
      title: "已归档文集",
      sort_order: 0,
      status: "archived",
    },
    {
      ...common,
      id: ids.archivedNotebookWithActiveGroup,
      group_id: ids.group,
      title: "活跃分组中的已归档文集",
      sort_order: 1,
      status: "archived",
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
      plain_text: "归档内容",
      status: "archived",
    },
    {
      ...common,
      id: ids.archivedNoteWithActiveNotebook,
      notebook_id: ids.notebook,
      parent_id: null,
      sort_order: 1,
      title: "活跃文集中的已归档文档",
      note_type: "document",
      plain_text: "归档内容",
      status: "archived",
    },
  ];
  const result = (items: unknown[]) => ({
    data: { items },
    isLoading: false,
    isError: false,
  });

  return {
    useDocumentGroups: (status?: string) =>
      result(status === "archived" ? archivedGroups : groups),
    useNotebooks: (_groupId?: string, status?: string) =>
      result(
        status === "archived"
          ? archivedNotebooks
          : (mocks.activeNotebooks ?? notebooks),
      ),
    useNoteSearch: (
      query = "",
      status?: string,
      options?: { enabled?: boolean },
    ) => {
      mocks.noteSearchCalls.push({ query, status, options });
      return result(
        status === "archived"
          ? archivedNotes
          : mocks.activeNotes ??
              notes.filter(
                (note) =>
                  note.title.includes(query) || note.plain_text.includes(query),
              ),
      );
    },
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

const user = {
  id: "018ff7c4-a5b6-7000-8000-000000000010",
  tenant_id: null,
  email: "owner@orbis.test",
  display_name: "Orbis Owner",
  current_workspace_id: "018ff7c4-a5b6-7000-8000-000000000008",
  status: "active",
  created_at_ms: 1,
  updated_at_ms: 1,
};

const workspace = {
  id: "018ff7c4-a5b6-7000-8000-000000000008",
  name: "Orbis Workspace",
  workspace_type: "team",
  role: "owner" as const,
  is_current: true,
  created_at_ms: 1,
  updated_at_ms: 1,
};

function sessionFor(role: "owner" | "normal" = "owner", workspaceOverride?: typeof workspace | null) {
  return {
    accessToken: "access-token",
    refreshToken: "refresh-token",
    user,
    workspace: workspaceOverride === undefined ? { ...workspace, role } : workspaceOverride,
  };
}

async function renderRoute(path: string, role: "owner" | "normal" = "owner", workspaceOverride?: typeof workspace | null) {
  window.history.replaceState({}, "", path);
  window.localStorage.setItem("orbis.auth", JSON.stringify(sessionFor(role, workspaceOverride)));
  vi.resetModules();
  const { router } = await import("../../app/router");
  return render(<RouterProvider router={router} />);
}

function CurrentSearch() {
  return <output aria-label="current search">{useLocation().search}</output>;
}

describe("document function pages", () => {
  beforeEach(() => {
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
    window.localStorage.clear();
  });

  afterEach(() => {
    window.localStorage.clear();
  });

  it.each([
    ["/documents", "文档概览", "heading"],
    ["/documents/recent", "最近文档", "heading"],
    ["/documents/collections", "我的文集", "heading"],
    ["/documents/archive", "归档", "heading"],
  ] as const)("renders %s as the %s page", async (path, name, role) => {
    await renderRoute(path);
    expect(await screen.findByRole(role, { name })).toBeVisible();
  });

  it("renders the document search input", async () => {
    await renderRoute("/documents/search");
    expect(
      await screen.findByRole("searchbox", { name: "搜索文档" }),
    ).toBeVisible();
  });

  it("stores a document search query in the URL", async () => {
    const actor = userEvent.setup();
    render(
      <MemoryRouter initialEntries={["/documents/search"]}>
        <DocumentSearchPage />
        <CurrentSearch />
      </MemoryRouter>,
    );

    await actor.type(
      screen.getByRole("searchbox", { name: "搜索文档" }),
      "最新",
    );

    expect(
      screen.getByRole("status", { name: "current search" }),
    ).toHaveTextContent("?q=%E6%9C%80%E6%96%B0");
    expect(screen.getByRole("heading", { name: "最新文档" })).toBeVisible();
  });

  it("does not search or render all documents for a blank query", async () => {
    await renderRoute("/documents/search");

    expect(await screen.findByText("输入关键词搜索标题或正文。")).toBeVisible();
    expect(screen.queryByRole("heading", { name: "最新文档" })).not.toBeInTheDocument();
    expect(mocks.noteSearchCalls).toContainEqual({
      query: "",
      status: "active",
      options: { enabled: false },
    });
  });

  it("shows each search result's collection without additional row requests", async () => {
    await renderRoute("/documents/search?q=%E6%9C%80%E6%96%B0");

    expect(await screen.findByText("所属文集：产品手册")).toBeVisible();
  });

  it("provides a clear action to reset the document search", async () => {
    const actor = userEvent.setup();
    render(
      <MemoryRouter initialEntries={["/documents/search?q=%E6%9C%80%E6%96%B0"]}>
        <DocumentSearchPage />
        <CurrentSearch />
      </MemoryRouter>,
    );

    await actor.click(screen.getByRole("button", { name: "清空搜索" }));

    expect(screen.getByRole("status", { name: "current search" })).toHaveTextContent("");
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

  it("keeps account settings on the workspace shell without document functions", async () => {
    await renderRoute("/settings/account");

    expect(await screen.findByRole("heading", { name: "账号" })).toBeVisible();
    expect(screen.queryByRole("navigation", { name: "在线文档功能" })).not.toBeInTheDocument();
    expect(document.querySelector(".workspace-shell")).not.toHaveClass("has-section-menu");
  });

  it("links the overview quick actions to both document and collection creation", async () => {
    await renderRoute("/documents");

    expect(await screen.findByRole("button", { name: "新建文档" })).toBeVisible();
    expect(screen.getByRole("link", { name: "新建文集" })).toHaveAttribute(
      "href",
      "/documents/collections",
    );
  });

  it("links the recent empty state to collections", async () => {
    mocks.activeNotes = [];
    await renderRoute("/documents/recent");

    expect(await screen.findByRole("link", { name: "前往我的文集" })).toHaveAttribute(
      "href",
      "/documents/collections",
    );
  });

  it("redirects an unavailable collection to collections with a persistent, dismissible error", async () => {
    const actor = userEvent.setup();
    mocks.activeNotebooks = [];
    render(
      <MemoryRouter initialEntries={["/collections/018ff7c4-a5b6-7000-8000-000000000099"]}>
        <Routes>
          <Route path="/collections/:collectionId" element={<NotebookPage />} />
          <Route path="/documents/collections" element={<CollectionsPage />} />
        </Routes>
      </MemoryRouter>,
    );

    expect(await screen.findByRole("heading", { name: "我的文集" })).toBeVisible();
    expect(screen.getByRole("alert")).toHaveTextContent("无法打开文集");

    await actor.click(screen.getByRole("button", { name: "关闭提示" }));

    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("redirects a missing document to collections with a persistent error", async () => {
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

    expect(await screen.findByRole("heading", { name: "我的文集" })).toBeVisible();
    expect(screen.getByRole("alert")).toHaveTextContent("无法打开文档");
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
    expect(screen.queryByRole("heading", { name: "我的文集" })).not.toBeInTheDocument();
  });

  it("requires parents to be restored before their archived descendants", async () => {
    await renderRoute("/documents/archive");

    expect(await screen.findByText("归属分组：已归档分组")).toBeVisible();
    expect(screen.getByText("归属文集：已归档文集")).toBeVisible();
    expect(screen.getByText("请先恢复分组")).toBeVisible();
    expect(screen.getByText("请先恢复文集")).toBeVisible();
    expect(
      screen.getByRole("button", { name: "恢复 已归档文集" }),
    ).toBeDisabled();
    expect(
      screen.getByRole("button", { name: "恢复 已归档文档" }),
    ).toBeDisabled();
  });

  it("restores an archived group for an owner", async () => {
    const actor = userEvent.setup();
    await renderRoute("/documents/archive");

    await actor.click(
      await screen.findByRole("button", { name: "恢复 已归档分组" }),
    );

    expect(mocks.archiveGroup).toHaveBeenCalledWith({
      id: "018ff7c4-a5b6-7000-8000-000000000005",
      archived: false,
    });
  });

  it("allows restores whose direct parent is already active", async () => {
    const actor = userEvent.setup();
    await renderRoute("/documents/archive");

    const notebookButton = await screen.findByRole("button", {
      name: "恢复 活跃分组中的已归档文集",
    });
    const noteButton = screen.getByRole("button", {
      name: "恢复 活跃文集中的已归档文档",
    });
    expect(notebookButton).toBeEnabled();
    expect(noteButton).toBeEnabled();

    await actor.click(notebookButton);
    await actor.click(noteButton);

    expect(mocks.archiveNotebook).toHaveBeenCalledWith({
      id: "018ff7c4-a5b6-7000-8000-000000000011",
      archived: false,
    });
    expect(mocks.archiveNote).toHaveBeenCalledWith({
      id: "018ff7c4-a5b6-7000-8000-000000000012",
      archived: false,
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
    new ApiError(409, "Parent collection must be restored first"),
    new Error("Network request failed"),
  ])("shows a visible restore error: %s", async (error) => {
    mocks.archiveNoteState.isError = true;
    mocks.archiveNoteState.error = error;
    mocks.archiveNoteState.variables = {
      id: "018ff7c4-a5b6-7000-8000-000000000007",
      archived: false,
    };
    await renderRoute("/documents/archive");

    expect(await screen.findByRole("alert")).toHaveTextContent(error.message);
  });

  it("does not offer restore controls to a normal member", async () => {
    await renderRoute("/documents/archive", "normal");

    await screen.findByRole("heading", { name: "归档" });
    expect(
      screen.queryByRole("button", { name: /恢复/ }),
    ).not.toBeInTheDocument();
  });

  it("does not offer restore controls without a current workspace", async () => {
    await renderRoute("/documents/archive", "owner", null);

    await screen.findByRole("heading", { name: "归档" });
    expect(screen.queryByRole("button", { name: /恢复/ })).not.toBeInTheDocument();
  });
});

import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, RouterProvider, useLocation } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { DocumentSearchPage } from "./DocumentSearchPage";

const mocks = vi.hoisted(() => ({
  archiveGroup: vi.fn(),
  archiveNotebook: vi.fn(),
  archiveNote: vi.fn(),
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
      result(status === "archived" ? archivedNotebooks : notebooks),
    useNoteSearch: (query = "", status?: string) =>
      result(
        status === "archived"
          ? archivedNotes
          : notes.filter(
              (note) =>
                note.title.includes(query) || note.plain_text.includes(query),
            ),
      ),
    useNoteTree: () => result([]),
    useNote: () => ({
      data: undefined,
      isLoading: false,
      isError: false,
      refetch: vi.fn(),
    }),
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
      isPending: false,
    }),
    useCreateNotebook: () => ({ mutateAsync: vi.fn(), isPending: false }),
    useUpdateNotebook: () => ({ mutateAsync: vi.fn(), isPending: false }),
    useArchiveNotebook: () => ({
      mutate: mocks.archiveNotebook,
      mutateAsync: mocks.archiveNotebook,
      isPending: false,
    }),
    useCreateNote: () => ({ mutateAsync: vi.fn(), isPending: false }),
    useArchiveNote: () => ({
      mutate: mocks.archiveNote,
      mutateAsync: mocks.archiveNote,
      isPending: false,
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

function sessionFor(role: "owner" | "normal" = "owner") {
  return {
    accessToken: "access-token",
    refreshToken: "refresh-token",
    user,
    workspace: { ...workspace, role },
  };
}

async function renderRoute(path: string, role: "owner" | "normal" = "owner") {
  window.history.replaceState({}, "", path);
  window.localStorage.setItem("orbis.auth", JSON.stringify(sessionFor(role)));
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

  it("restores an archived resource for an owner", async () => {
    const actor = userEvent.setup();
    await renderRoute("/documents/archive");

    await actor.click(
      await screen.findByRole("button", { name: "恢复 已归档文档" }),
    );

    expect(mocks.archiveNote).toHaveBeenCalledWith({
      id: "018ff7c4-a5b6-7000-8000-000000000007",
      archived: false,
    });
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

  it("restores an archived notebook for an owner", async () => {
    const actor = userEvent.setup();
    await renderRoute("/documents/archive");

    await actor.click(
      await screen.findByRole("button", { name: "恢复 已归档文集" }),
    );

    expect(mocks.archiveNotebook).toHaveBeenCalledWith({
      id: "018ff7c4-a5b6-7000-8000-000000000006",
      archived: false,
    });
  });

  it("does not offer restore controls to a normal member", async () => {
    await renderRoute("/documents/archive", "normal");

    await screen.findByRole("heading", { name: "归档" });
    expect(
      screen.queryByRole("button", { name: /恢复/ }),
    ).not.toBeInTheDocument();
  });
});

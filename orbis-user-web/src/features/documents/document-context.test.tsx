import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { act } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { authStore } from "../../shared/auth/auth-store";
import { DocumentContextPanel } from "./DocumentContextPanel";
import { DocumentEditorPage } from "./DocumentEditorPage";
import { DocumentShell } from "./DocumentShell";
import {
  documentContextStorageKey,
  readDocumentContextOpen,
  writeDocumentContextOpen,
} from "./document-context-state";

const mocks = vi.hoisted(() => ({
  refetchTree: vi.fn(),
  archiveNote: vi.fn(),
}));

let treeState: { data: { items: Array<Record<string, unknown>> } | undefined; isLoading: boolean; isError: boolean; refetch: () => void };
let noteState: { data: Record<string, unknown> | undefined; isError: boolean; refetch: () => void };
let contentState: { data: Record<string, unknown> | undefined; isError: boolean; refetch: () => void };

vi.mock("./queries", () => ({
  useNoteTree: () => treeState,
  useCreateNote: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useUpdateNote: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useArchiveNote: () => ({ mutateAsync: mocks.archiveNote, isPending: false }),
  useNote: () => noteState,
  useNoteContent: () => contentState,
  useSaveNoteContent: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useExportMarkdown: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));

vi.mock("../notes/TiptapNoteEditor", () => ({
  TiptapNoteEditor: () => <div>编辑器仍可用</div>,
}));

const user = {
  id: "018ff7c4-a5b6-7000-8000-000000000001",
  tenant_id: null,
  email: "owner@orbis.test",
  display_name: "Orbis Owner",
  current_workspace_id: "workspace-1",
  status: "active",
  created_at_ms: 1,
  updated_at_ms: 1,
};

const workspace = {
  id: "workspace-1",
  name: "Orbis Workspace",
  workspace_type: "team",
  role: "owner" as const,
  is_current: true,
  created_at_ms: 1,
  updated_at_ms: 1,
};

const rootNote = {
  id: "018ff7c4-a5b6-7000-8000-000000000003",
  notebook_id: "018ff7c4-a5b6-7000-8000-000000000002",
  parent_id: null,
  sort_order: 0,
  title: "产品计划",
  tenant_id: null,
  workspace_id: "workspace-1",
  owner_id: user.id,
  created_at_ms: 1,
  updated_at_ms: 2,
  children: [
    {
      id: "018ff7c4-a5b6-7000-8000-000000000004",
      notebook_id: "018ff7c4-a5b6-7000-8000-000000000002",
      parent_id: "018ff7c4-a5b6-7000-8000-000000000003",
      sort_order: 0,
      title: "发布范围",
      tenant_id: null,
      workspace_id: "workspace-1",
      owner_id: user.id,
      created_at_ms: 1,
      updated_at_ms: 2,
      children: [],
    },
  ],
};

function renderPanel(props: Partial<React.ComponentProps<typeof DocumentContextPanel>> = {}) {
  return render(
    <MemoryRouter>
      <DocumentContextPanel
        notebookId="018ff7c4-a5b6-7000-8000-000000000002"
        activeNoteId="018ff7c4-a5b6-7000-8000-000000000004"
        {...props}
      />
    </MemoryRouter>,
  );
}

function CurrentPath() {
  return <output aria-label="current path">{useLocation().pathname}</output>;
}

describe("document context state", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  afterEach(() => {
    window.localStorage.clear();
  });

  it("persists only the open state under the workspace-scoped key", () => {
    const key = "orbis.document-context.open.workspace-1";
    window.localStorage.setItem(key, "false");

    expect(documentContextStorageKey("workspace-1")).toBe(key);
    expect(readDocumentContextOpen("workspace-1")).toBe(false);

    writeDocumentContextOpen("workspace-1", true);

    expect(window.localStorage.getItem(key)).toBe("true");
    expect(window.localStorage).toHaveLength(1);
    expect(window.localStorage.key(0)).toBe(key);
  });

  it("defaults missing and malformed workspace state to open", () => {
    expect(readDocumentContextOpen("workspace-1")).toBe(true);
    window.localStorage.setItem("orbis.document-context.open.workspace-1", "expanded");
    expect(readDocumentContextOpen("workspace-1")).toBe(true);
  });
});

describe("DocumentContextPanel", () => {
  beforeEach(() => {
    mocks.refetchTree.mockReset();
    mocks.archiveNote.mockReset();
    mocks.archiveNote.mockResolvedValue({});
    treeState = { data: { items: [rootNote] }, isLoading: false, isError: false, refetch: mocks.refetchTree };
    noteState = {
      data: { id: rootNote.id, notebook_id: rootNote.notebook_id, title: rootNote.title },
      isError: false,
      refetch: vi.fn(),
    };
    contentState = {
      data: { note_id: rootNote.id, content_version: 1, blocks: { schema_version: 1, editor: "tiptap", doc: { type: "doc", content: [] }, plain_text: "" } },
      isError: false,
      refetch: vi.fn(),
    };
    act(() => {
      authStore.setState({ accessToken: "access-token", refreshToken: "refresh-token", user, workspace });
    });
  });

  afterEach(() => {
    act(() => authStore.getState().clearSession());
  });

  it("renders a nested tree and marks the open note as the current page", () => {
    renderPanel();

    expect(screen.getByRole("link", { name: "产品计划" })).toHaveAttribute("href", "/documents/018ff7c4-a5b6-7000-8000-000000000003");
    expect(screen.getByRole("link", { name: "发布范围" })).toHaveAttribute("aria-current", "page");
  });

  it("does not offer document mutations to a Normal workspace member", () => {
    act(() => authStore.setState((state) => ({ ...state, workspace: state.workspace ? { ...state.workspace, role: "normal" } : null })));

    renderPanel();

    expect(screen.queryByRole("button", { name: "新建文档" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "新建子文档 发布范围" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "归档 发布范围" })).not.toBeInTheDocument();
  });

  it("keeps tree failure recovery inside the context panel", async () => {
    treeState = { data: undefined, isLoading: false, isError: true, refetch: mocks.refetchTree };
    const actor = userEvent.setup();
    renderPanel();

    await actor.click(screen.getByRole("button", { name: "重试加载目录" }));

    expect(mocks.refetchTree).toHaveBeenCalledOnce();
  });

  it("closes mobile navigation after following a document link", async () => {
    const onNavigate = vi.fn();
    const actor = userEvent.setup();
    renderPanel({ mobile: true, onNavigate });

    await actor.click(screen.getByRole("link", { name: "发布范围" }));

    expect(onNavigate).toHaveBeenCalledOnce();
  });

  it("returns to the collection after archiving the open document", async () => {
    const actor = userEvent.setup();
    render(
      <MemoryRouter initialEntries={[`/documents/${rootNote.children[0].id}`]}>
        <DocumentContextPanel notebookId={rootNote.notebook_id} activeNoteId={rootNote.children[0].id} />
        <CurrentPath />
      </MemoryRouter>,
    );

    await actor.click(screen.getByRole("button", { name: "归档 发布范围" }));

    await waitFor(() => expect(screen.getByRole("status", { name: "current path" })).toHaveTextContent(`/collections/${rootNote.notebook_id}`));
    expect(mocks.archiveNote).toHaveBeenCalledWith({ id: rootNote.children[0].id, archived: true });
  });

  it("keeps the editor available when only its contextual tree fails", () => {
    treeState = { data: undefined, isLoading: false, isError: true, refetch: mocks.refetchTree };
    render(
      <MemoryRouter initialEntries={[`/documents/${rootNote.id}`]}>
        <Routes><Route path="/documents/:noteId" element={<DocumentEditorPage />} /></Routes>
      </MemoryRouter>,
    );

    expect(screen.getByText("编辑器仍可用")).toBeInTheDocument();
    expect(screen.getByText("目录加载失败")).toBeInTheDocument();
  });

  it("returns direct note failures to the collections function", async () => {
    noteState = { data: undefined, isError: true, refetch: vi.fn() };
    render(
      <MemoryRouter initialEntries={[`/documents/${rootNote.id}`]}>
        <Routes><Route path="*" element={<><DocumentEditorPage /><CurrentPath /></>} /></Routes>
      </MemoryRouter>,
    );

    await waitFor(() => expect(screen.getByRole("status", { name: "current path" })).toHaveTextContent("/documents/collections"));
  });

  it("persists the shell open state and hides the open control while visible", async () => {
    window.localStorage.setItem("orbis.document-context.open.workspace-1", "false");
    const actor = userEvent.setup();
    render(
      <MemoryRouter>
        <DocumentShell contextPanel={<div>上下文内容</div>}><div>正文</div></DocumentShell>
      </MemoryRouter>,
    );

    await actor.click(screen.getByRole("button", { name: "打开上下文面板" }));

    expect(screen.getByRole("complementary", { name: "上下文面板" })).toHaveTextContent("上下文内容");
    expect(screen.queryByRole("button", { name: "打开上下文面板" })).not.toBeInTheDocument();
    expect(window.localStorage.getItem("orbis.document-context.open.workspace-1")).toBe("true");

    await actor.click(screen.getByRole("button", { name: "收起上下文面板" }));

    expect(window.localStorage.getItem("orbis.document-context.open.workspace-1")).toBe("false");
  });
});

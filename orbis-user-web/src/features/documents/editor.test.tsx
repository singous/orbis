import { act, fireEvent, render, screen } from "@testing-library/react";
import { Link, MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createEmptyNoteBlocks } from "../notes/note-contract";
import { authStore } from "../../shared/auth/auth-store";
import { DocumentEditorPage } from "./DocumentEditorPage";

const updateNote = vi.fn();
const saveContent = vi.fn();
const editorInputs = vi.fn();

// Mutable content fixture so tests can simulate the post-save setQueryData echo.
const contentFixture = {
  current: {
    note_id: "018ff7c4-a5b6-7000-8000-000000000001",
    blocks: createEmptyNoteBlocks(),
    plain_text: "",
    content_version: 4,
  },
};

const ownerSession = {
  accessToken: "access-token",
  refreshToken: "refresh-token",
  user: {
    id: "018ff7c4-a5b6-7000-8000-000000000002",
    tenant_id: null,
    email: "owner@orbis.test",
    display_name: "Orbis Owner",
    current_workspace_id: "018ff7c4-a5b6-7000-8000-000000000003",
    status: "active",
    created_at_ms: 1,
    updated_at_ms: 1,
  },
  workspace: {
    id: "018ff7c4-a5b6-7000-8000-000000000003",
    name: "Orbis Workspace",
    workspace_type: "team",
    role: "owner" as const,
    is_current: true,
    created_at_ms: 1,
    updated_at_ms: 1,
  },
};

vi.mock("./DocumentShell", () => ({ DocumentShell: ({ children }: { children: React.ReactNode }) => <main>{children}</main> }));
vi.mock("../notes/TiptapEditor", () => ({
  TiptapEditor: ({ blocks, onChange, readOnly }: { blocks: unknown; onChange: (next: { blocks: { schema_version: 2; editor: "blocknote"; blocks: unknown[] }; plainText: string }) => void; readOnly: boolean }) => { editorInputs(blocks); return <button type="button" disabled={readOnly} onClick={() => onChange({ blocks: { schema_version: 2, editor: "blocknote", blocks: [{ id: "b1", type: "paragraph", props: {}, content: [{ type: "text", text: "已编辑" }], children: [] }] }, plainText: "已编辑" })}>模拟编辑</button>; },
}));
vi.mock("./queries", () => ({
  useNote: () => ({ data: { id: "018ff7c4-a5b6-7000-8000-000000000001", notebook_id: "018ff7c4-a5b6-7000-8000-000000000004", title: "产品计划" }, isError: false }),
  useNoteContent: () => ({ data: contentFixture.current, isError: false, refetch: vi.fn() }),
  useNotebooks: () => ({ data: { items: [] }, isLoading: false, isError: false }),
  useNotebook: () => ({ data: undefined, isLoading: false, isError: false }),
  useUpdateNote: () => ({ mutateAsync: updateNote, isPending: false }),
  useSaveNoteContent: () => ({ mutateAsync: saveContent, isPending: false }),
  useArchiveNote: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useExportMarkdown: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));

describe("DocumentEditorPage", () => {
  beforeEach(() => {
    editorInputs.mockClear();
    updateNote.mockReset();
    updateNote.mockResolvedValue({});
    saveContent.mockReset();
    saveContent.mockResolvedValue({ content_version: 5 });
    contentFixture.current = {
      note_id: "018ff7c4-a5b6-7000-8000-000000000001",
      blocks: createEmptyNoteBlocks(),
      plain_text: "",
      content_version: 4,
    };
    act(() => authStore.setState(ownerSession));
  });

  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
    act(() => authStore.getState().clearSession());
  });

  it("autosaves structured blocks with the current optimistic version", async () => {
    render(<MemoryRouter initialEntries={["/documents/018ff7c4-a5b6-7000-000000000001"]}><Routes><Route path="/documents/:noteId" element={<DocumentEditorPage />} /></Routes></MemoryRouter>);
    // Mount the lazy editor under real timers, then drive autosave with fake timers.
    const editButton = await screen.findByRole("button", { name: "模拟编辑" });
    vi.useFakeTimers();
    fireEvent.click(editButton);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(750);
    });
    expect(saveContent).toHaveBeenCalledTimes(1);
    const payload = saveContent.mock.calls[0][0];
    expect(payload.noteId).toBe("018ff7c4-a5b6-7000-000000000001");
    expect(payload.expectedVersion).toBe(4);
    expect(payload.blocks.schema_version).toBe(2);
    expect(payload.blocks.editor).toBe("blocknote");
    expect(screen.getByText(/版本 5/)).toBeInTheDocument();
  });

  it("keeps the live draft when the content-version bump is our own save echo", async () => {
    const view = render(
      <MemoryRouter initialEntries={["/documents/018ff7c4-a5b6-7000-000000000001"]}>
        <Routes><Route path="/documents/:noteId" element={<DocumentEditorPage />} /></Routes>
      </MemoryRouter>,
    );
    const editButton = await screen.findByRole("button", { name: "模拟编辑" });
    vi.useFakeTimers();
    fireEvent.click(editButton);
    const titleInput = screen.getByLabelText("文档标题");
    fireEvent.change(titleInput, { target: { value: "新产品计划" } });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(750);
    });
    expect(saveContent).toHaveBeenCalledTimes(1);

    // The server echo: version bumped, blocks round-tripped through JSONB.
    // Rebuilding the draft from this echo would wipe the just-typed title.
    contentFixture.current = {
      ...contentFixture.current,
      content_version: 5,
    };
    act(() => {
      view.rerender(
        <MemoryRouter initialEntries={["/documents/018ff7c4-a5b6-7000-000000000001"]}>
          <Routes><Route path="/documents/:noteId" element={<DocumentEditorPage />} /></Routes>
        </MemoryRouter>,
      );
    });

    expect((titleInput as HTMLInputElement).value).toBe("新产品计划");
  });

  it("keeps the live draft when a late stale response regresses the cached version", async () => {
    const view = render(
      <MemoryRouter initialEntries={["/documents/018ff7c4-a5b6-7000-8000-000000000001"]}>
        <Routes><Route path="/documents/:noteId" element={<DocumentEditorPage />} /></Routes>
      </MemoryRouter>,
    );
    const editButton = await screen.findByRole("button", { name: "模拟编辑" });
    vi.useFakeTimers();
    fireEvent.click(editButton);
    const titleInput = screen.getByLabelText("文档标题");
    fireEvent.change(titleInput, { target: { value: "新版本草稿" } });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(750);
    });
    expect(saveContent).toHaveBeenCalledTimes(1);

    // A slow query response generated before our save lands afterwards,
    // regressing the cache to an older version with older blocks.
    contentFixture.current = {
      ...contentFixture.current,
      blocks: createEmptyNoteBlocks(),
      content_version: 3,
    };
    act(() => {
      view.rerender(
        <MemoryRouter initialEntries={["/documents/018ff7c4-a5b6-7000-8000-000000000001"]}>
          <Routes><Route path="/documents/:noteId" element={<DocumentEditorPage />} /></Routes>
        </MemoryRouter>,
      );
    });

    expect((titleInput as HTMLInputElement).value).toBe("新版本草稿");
  });
});


it("opens a cached destination without first mounting the previous document", async () => {
  act(() => authStore.setState(ownerSession));
  render(<MemoryRouter initialEntries={["/documents/first"]}><Link to="/documents/second">Next document</Link><Routes><Route path="/documents/:noteId" element={<DocumentEditorPage />} /></Routes></MemoryRouter>);
  await screen.findByRole("button", { name: "模拟编辑" });
  editorInputs.mockClear();
  contentFixture.current = {
    ...contentFixture.current,
    note_id: "second",
    blocks: { schema_version: 1, editor: "tiptap", doc: { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "Destination body" }] }] } },
  };
  await act(async () => { fireEvent.click(screen.getByRole("link", { name: "Next document" })); });
  expect(editorInputs.mock.calls.length).toBeGreaterThan(0);
  for (const [blocks] of editorInputs.mock.calls) expect(blocks.blocks[0].content).toEqual([{ type: "text", text: "Destination body", styles: {} }]);
  act(() => authStore.getState().clearSession());
});

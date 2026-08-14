import { act, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createEmptyNoteBlocks } from "../notes/note-contract";
import { authStore } from "../../shared/auth/auth-store";
import { DocumentEditorPage } from "./DocumentEditorPage";

const updateNote = vi.fn();
const saveContent = vi.fn();

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
vi.mock("../notes/BlockNoteEditor", () => ({
  BlockNoteEditor: ({ onChange, readOnly }: { onChange: (next: { blocks: { schema_version: 2; editor: "blocknote"; blocks: unknown[] }; plainText: string }) => void; readOnly: boolean }) => <button type="button" disabled={readOnly} onClick={() => onChange({ blocks: { schema_version: 2, editor: "blocknote", blocks: [{ id: "b1", type: "paragraph", props: {}, content: [{ type: "text", text: "已编辑" }], children: [] }] }, plainText: "已编辑" })}>模拟编辑</button>,
}));
vi.mock("./queries", () => ({
  useNote: () => ({ data: { id: "018ff7c4-a5b6-7000-8000-000000000001", notebook_id: "018ff7c4-a5b6-7000-8000-000000000004", title: "产品计划" }, isError: false }),
  useNoteContent: () => ({ data: { note_id: "018ff7c4-a5b6-7000-8000-000000000001", blocks: createEmptyNoteBlocks(), plain_text: "", content_version: 4 }, isError: false, refetch: vi.fn() }),
  useNotebooks: () => ({ data: { items: [] }, isLoading: false, isError: false }),
  useUpdateNote: () => ({ mutateAsync: updateNote, isPending: false }),
  useSaveNoteContent: () => ({ mutateAsync: saveContent, isPending: false }),
  useArchiveNote: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useExportMarkdown: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));

describe("DocumentEditorPage", () => {
  beforeEach(() => {
    updateNote.mockReset();
    updateNote.mockResolvedValue({});
    saveContent.mockReset();
    saveContent.mockResolvedValue({ content_version: 5 });
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
});

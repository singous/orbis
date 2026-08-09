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
vi.mock("../notes/TiptapNoteEditor", () => ({
  TiptapNoteEditor: ({ onChange, readOnly }: { onChange: (next: { blocks: ReturnType<typeof createEmptyNoteBlocks>; plainText: string }) => void; readOnly: boolean }) => <button type="button" disabled={readOnly} onClick={() => onChange({ blocks: { schema_version: 1, editor: "tiptap", doc: { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "已编辑" }] }] } }, plainText: "已编辑" })}>模拟编辑</button>,
}));
vi.mock("./queries", () => ({
  useNote: () => ({ data: { id: "018ff7c4-a5b6-7000-8000-000000000001", notebook_id: "018ff7c4-a5b6-7000-8000-000000000004", title: "产品计划" }, isError: false }),
  useNoteContent: () => ({ data: { note_id: "018ff7c4-a5b6-7000-8000-000000000001", blocks: createEmptyNoteBlocks(), plain_text: "", content_version: 4 }, isError: false, refetch: vi.fn() }),
  useUpdateNote: () => ({ mutateAsync: updateNote, isPending: false }),
  useSaveNoteContent: () => ({ mutateAsync: saveContent, isPending: false }),
  useArchiveNote: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useExportMarkdown: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));

describe("DocumentEditorPage", () => {
  beforeEach(() => {
    vi.useFakeTimers();
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
    render(<MemoryRouter initialEntries={["/documents/018ff7c4-a5b6-7000-8000-000000000001"]}><Routes><Route path="/documents/:noteId" element={<DocumentEditorPage />} /></Routes></MemoryRouter>);
    fireEvent.click(screen.getByRole("button", { name: "模拟编辑" }));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(750);
    });
    expect(saveContent).toHaveBeenCalledWith(expect.objectContaining({
      noteId: "018ff7c4-a5b6-7000-8000-000000000001",
      expectedVersion: 4,
      blocks: expect.objectContaining({ editor: "tiptap" }),
    }));
    expect(screen.getByText(/版本 5/)).toBeInTheDocument();
  });
});

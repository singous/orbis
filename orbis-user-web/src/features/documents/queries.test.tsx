import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { authStore } from "../../shared/auth/auth-store";
import { useArchiveNote, useNoteSearch } from "./queries";

const setNoteArchivedMock = vi.fn();
const searchNotesMock = vi.fn();

vi.mock("./api", async () => ({
  ...(await vi.importActual<typeof import("./api")>("./api")),
  setNoteArchived: (...args: unknown[]) => setNoteArchivedMock(...args),
  searchNotes: (...args: unknown[]) => searchNotesMock(...args),
}));

const noteId = "018ff7c4-a5b6-7000-8000-000000000001";

function ArchiveNoteButton() {
  const archiveNote = useArchiveNote();
  return (
    <button
      type="button"
      onClick={() => archiveNote.mutate({ id: noteId, archived: true })}
    >
      归档文档
    </button>
  );
}

function DisabledSearchProbe() {
  useNoteSearch("   ", "active", { enabled: false });
  return null;
}

describe("document query mutations", () => {
  beforeEach(() => {
    setNoteArchivedMock.mockReset();
    searchNotesMock.mockReset();
    searchNotesMock.mockResolvedValue({ items: [] });
    authStore.setState({
      accessToken: "access-token",
      refreshToken: "refresh-token",
      user: null,
      workspace: null,
    });
  });

  afterEach(() => {
    authStore.setState({
      accessToken: null,
      refreshToken: null,
      user: null,
      workspace: null,
    });
  });

  it("removes stale note detail and content after archiving", async () => {
    setNoteArchivedMock.mockResolvedValue({ id: noteId, status: "archived" });
    const queryClient = new QueryClient({
      defaultOptions: { mutations: { retry: false } },
    });
    queryClient.setQueryData(["note", noteId], { id: noteId, status: "active" });
    queryClient.setQueryData(["note-content", noteId], {
      note_id: noteId,
      content_version: 1,
    });
    queryClient.setQueryData(["note-search", "active", ""], { items: [] });

    const { unmount } = render(
      <QueryClientProvider client={queryClient}>
        <ArchiveNoteButton />
      </QueryClientProvider>,
    );

    await userEvent.click(screen.getByRole("button", { name: "归档文档" }));

    await waitFor(() => {
      expect(queryClient.getQueryData(["note", noteId])).toBeUndefined();
      expect(queryClient.getQueryData(["note-content", noteId])).toBeUndefined();
    });
    expect(
      queryClient.getQueryState(["note-search", "active", ""]),
    ).toMatchObject({ isInvalidated: true });
    unmount();
  });

  it("does not request a disabled note search", async () => {
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    const { unmount } = render(
      <QueryClientProvider client={queryClient}>
        <DisabledSearchProbe />
      </QueryClientProvider>,
    );

    await waitFor(() => expect(searchNotesMock).not.toHaveBeenCalled());
    unmount();
  });
});

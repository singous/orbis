import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  createNote,
  listDocumentGroups,
  saveNoteContent,
  searchNotes,
  type AuthRequestOptions,
} from "./api";
import { createEmptyNoteBlocks } from "../notes/note-contract";

const auth: AuthRequestOptions = {
  accessToken: "access-token",
  refreshToken: null,
  onTokenRefresh: vi.fn(),
  onUnauthorized: vi.fn(),
};

function jsonResponse(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("document API", () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
  });

  it("uses the unversioned group and search routes", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ items: [] }))
      .mockResolvedValueOnce(jsonResponse({ items: [] }));
    vi.stubGlobal("fetch", fetchMock);

    await listDocumentGroups(auth);
    await searchNotes("release plan", auth);

    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      "/api/document-groups",
      expect.objectContaining({ headers: expect.objectContaining({ Authorization: "Bearer access-token" }) }),
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      "/api/notes?q=release+plan",
      expect.any(Object),
    );
  });

  it("creates note metadata separately from versioned content", async () => {
    const note = {
      id: "018ff7c4-a5b6-7000-8000-000000000001",
      tenant_id: null,
      workspace_id: "018ff7c4-a5b6-7000-8000-000000000002",
      owner_id: "018ff7c4-a5b6-7000-8000-000000000003",
      notebook_id: "018ff7c4-a5b6-7000-8000-000000000004",
      parent_id: null,
      sort_order: 0,
      title: "Release plan",
      note_type: "doc",
      status: "active",
      created_at_ms: 1710000000000,
      updated_at_ms: 1710000000000,
    };
    const content = {
      note_id: note.id,
      blocks: createEmptyNoteBlocks(),
      plain_text: "",
      content_version: 2,
      created_at_ms: 1710000000000,
      updated_at_ms: 1710000001000,
    };
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(note, 201))
      .mockResolvedValueOnce(jsonResponse(content));
    vi.stubGlobal("fetch", fetchMock);

    await createNote(
      { notebook_id: note.notebook_id, title: note.title, parent_id: null, sort_order: 0 },
      auth,
    );
    await saveNoteContent(
      { noteId: note.id, expectedVersion: 1, blocks: createEmptyNoteBlocks() },
      auth,
    );

    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      "/api/notes",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          notebook_id: note.notebook_id,
          title: note.title,
          parent_id: null,
          sort_order: 0,
        }),
      }),
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      `/api/notes/${note.id}/content`,
      expect.objectContaining({
        method: "PUT",
        body: JSON.stringify({ expected_version: 1, blocks: createEmptyNoteBlocks() }),
      }),
    );
  });
});

import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { Note, NoteBlocks, NoteListItem } from "../../shared/api/schemas";
import { createEmptyNoteBlocks } from "./note-contract";
import { NotesWorkspace } from "./NotesWorkspace";

const listNotesMock = vi.fn<() => NoteListItem[]>();
const noteDetailMock = vi.fn<() => Note | undefined>();
const createNoteMock = vi.fn();
const saveNoteMock = vi.fn();

vi.mock("./notes-api", () => ({
  useNotesList: () => ({
    data: { items: listNotesMock() },
    isLoading: false,
    isError: false,
    error: null,
  }),
  useNoteDetail: () => ({
    data: noteDetailMock(),
    isLoading: false,
    isError: false,
  }),
  useCreateNote: () => ({
    mutateAsync: createNoteMock,
    isPending: false,
  }),
  useSaveNoteContent: () => ({
    mutateAsync: saveNoteMock,
    isPending: false,
  }),
}));

vi.mock("./TiptapNoteEditor", () => ({
  TiptapNoteEditor: ({
    blocks,
    onChange,
  }: {
    blocks: NoteBlocks;
    onChange: (next: { blocks: NoteBlocks; plainText: string }) => void;
  }) => (
    <div>
      <div data-testid="mock-editor">{String(blocks.doc.type)}</div>
      <button
        type="button"
        onClick={() =>
          onChange({
            blocks: {
              schema_version: 1,
              editor: "tiptap",
              doc: {
                type: "doc",
                content: [
                  {
                    type: "paragraph",
                    content: [{ type: "text", text: "Edited from test" }],
                  },
                ],
              },
            },
            plainText: "测试编辑内容",
          })
        }
      >
        模拟编辑
      </button>
    </div>
  ),
}));

const noteListItem: NoteListItem = {
  id: "018ff7c4-a5b6-7000-8000-000000000001",
  workspace_id: "018ff7c4-a5b6-7000-8000-000000000002",
  owner_id: "018ff7c4-a5b6-7000-8000-000000000003",
  title: "第一条笔记",
  note_type: "doc",
  plain_text: "你好 Orbis",
  content_version: 2,
  status: "active",
  created_at_ms: 1710000000000,
  updated_at_ms: 1710000100000,
};

const noteDetail: Note = {
  ...noteListItem,
  blocks: createEmptyNoteBlocks(),
};

function renderWorkspace() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
    },
  });

  function Wrapper({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={queryClient}>
        <MemoryRouter>{children}</MemoryRouter>
      </QueryClientProvider>
    );
  }

  return render(<NotesWorkspace />, { wrapper: Wrapper });
}

describe("NotesWorkspace", () => {
  beforeEach(() => {
    listNotesMock.mockReturnValue([noteListItem]);
    noteDetailMock.mockReturnValue(noteDetail);
    createNoteMock.mockReset();
    createNoteMock.mockResolvedValue(noteDetail);
    saveNoteMock.mockReset();
    saveNoteMock.mockResolvedValue({ ...noteDetail, content_version: 3 });
  });

  it("shows an empty state and creates a first note", async () => {
    listNotesMock.mockReturnValue([]);
    noteDetailMock.mockReturnValue(undefined);

    renderWorkspace();

    expect(screen.getByText("还没有笔记")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "创建笔记" }));

    expect(createNoteMock).toHaveBeenCalledWith({
      title: "未命名笔记",
      blocks: createEmptyNoteBlocks(),
      plain_text: "",
      note_type: "doc",
    });
  });

  it("saves edited note content with the current optimistic version", async () => {
    renderWorkspace();

    await userEvent.click(screen.getByRole("button", { name: "模拟编辑" }));
    await userEvent.click(screen.getByRole("button", { name: "保存笔记" }));

    expect(saveNoteMock).toHaveBeenCalledWith({
      noteId: noteDetail.id,
      expectedVersion: 2,
      title: "第一条笔记",
      blocks: expect.objectContaining({ editor: "tiptap" }),
      plainText: "测试编辑内容",
    });
  });

  it("keeps local edits visible when the backend reports a version conflict", async () => {
    saveNoteMock.mockRejectedValue(
      Object.assign(new Error("Note version conflict"), {
        status: 409,
        detail: "Note version conflict",
        isConflict: true,
      }),
    );

    renderWorkspace();

    await userEvent.click(screen.getByRole("button", { name: "模拟编辑" }));
    await userEvent.click(screen.getByRole("button", { name: "保存笔记" }));

    expect(await screen.findByText("版本冲突")).toBeInTheDocument();
    expect(screen.getByText("测试编辑内容")).toBeInTheDocument();
  });
});

import {QueryClient,QueryClientProvider} from "@tanstack/react-query";
import { act, fireEvent, render as renderTestingLibrary, screen } from "@testing-library/react";
import { Link, MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createEmptyNoteBlocks } from "../../content/codecs/tiptap-document";
import { authStore } from "../../../shared/auth/auth-store";
import { ApiError } from "../../../shared/api/api-client";
import * as checkpointHooks from "./use-draft-checkpoints";
import { DocumentRoute } from "../../../app/DocumentRoute";

function render(ui:React.ReactElement){const client=new QueryClient({defaultOptions:{queries:{retry:false}}});return renderTestingLibrary(ui,{wrapper:({children})=><QueryClientProvider client={client}>{children}</QueryClientProvider>});}

const updateNote = vi.fn();
const saveContent = vi.fn();
const editorInputs = vi.fn();
const editorEdits = { sequence: 0 };

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
  user: {bio: null, avatar_asset_id: null, profile_version: 1,
    id: "018ff7c4-a5b6-7000-8000-000000000002",
    email: "owner@orbis.test",
    display_name: "Orbis Owner",
    preferred_workspace_id: "018ff7c4-a5b6-7000-8000-000000000003",
    created_at_ms: 1,
    updated_at_ms: 1,
  },
  workspace: {
    id: "018ff7c4-a5b6-7000-8000-000000000003",
    name: "Orbis Workspace",
    role: "owner" as const,
    created_at_ms: 1,
    updated_at_ms: 1,
  },
};

vi.mock("../DocumentShell", () => ({ DocumentShell: ({ children, toolbar }: { children: React.ReactNode; toolbar?: React.ReactNode }) => <main>{toolbar}{children}</main> }));
vi.mock("../../sharing/ShareButton", () => ({ ShareButton: () => null }));
vi.mock("./TiptapEditor", () => ({
  TiptapEditor: ({ blocks, onChange, readOnly }: { blocks: unknown; onChange: (next: { blocks: { schema_version: 2; editor: "blocknote"; blocks: unknown[] }; plainText: string }) => void; readOnly: boolean }) => { editorInputs(blocks); return <button type="button" disabled={readOnly} onClick={() => {
    editorEdits.sequence += 1;
    const text = editorEdits.sequence === 1 ? "已编辑" : `已编辑 ${editorEdits.sequence}`;
    onChange({ blocks: { schema_version: 2, editor: "blocknote", blocks: [{ id: "b1", type: "paragraph", props: {}, content: [{ type: "text", text }], children: [] }] }, plainText: text });
  }}>模拟编辑</button>; },
}));
vi.mock("../queries", () => ({
  useNote: () => ({ data: { id: "018ff7c4-a5b6-7000-8000-000000000001", workspace_id: ownerSession.workspace.id, notebook_id: "018ff7c4-a5b6-7000-8000-000000000004", title: "产品计划" }, isError: false }),
  useNoteContent: () => ({ data: contentFixture.current, isError: false, refetch: vi.fn() }),
  useNotebooks: () => ({ data: { items: [] }, isLoading: false, isError: false }),
  useNotebook: () => ({ data: undefined, isLoading: false, isError: false }),
  useUpdateNote: () => ({ mutateAsync: updateNote, isPending: false }),
  useSaveNoteContent: () => ({ mutateAsync: saveContent, isPending: false }),
  useArchiveNote: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useExportMarkdown: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));

describe("DocumentRoute", () => {
  beforeEach(() => {
    editorInputs.mockClear();
    editorEdits.sequence = 0;
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
    vi.restoreAllMocks();
    vi.clearAllTimers();
    vi.useRealTimers();
    act(() => authStore.getState().clearSession());
  });

  it("autosaves structured blocks with the current optimistic version", async () => {
    render(<MemoryRouter initialEntries={["/documents/018ff7c4-a5b6-7000-8000-000000000001"]}><Routes><Route path="/documents/:noteId" element={<DocumentRoute />} /></Routes></MemoryRouter>);
    // Mount the lazy editor under real timers, then drive autosave with fake timers.
    const editButton = await screen.findByRole("button", { name: "模拟编辑" });
    vi.useFakeTimers();
    fireEvent.click(editButton);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(750);
    });
    expect(saveContent).toHaveBeenCalledTimes(1);
    const payload = saveContent.mock.calls[0][0];
    expect(payload.document_id).toBe("018ff7c4-a5b6-7000-8000-000000000001");
    expect(payload.expected_version).toBe(4);
    expect(payload.submitted.blocks.schema_version).toBe(2);
    expect(payload.submitted.blocks.editor).toBe("blocknote");
    expect(screen.queryByText(/版本 5/)).not.toBeInTheDocument();
  });

  it("keeps a server version conflict visible even when the local draft is persisted", async () => {
    const originalHook = checkpointHooks.useDraftCheckpoints;
    vi.spyOn(checkpointHooks, "useDraftCheckpoints").mockImplementation(scopeKey => ({
      ...originalHook(scopeKey),
      status: { status: "saved", sequence: 1 },
    }));
    saveContent.mockRejectedValue(new ApiError(409, "正文版本冲突", "NOTE_VERSION_CONFLICT"));
    render(<MemoryRouter initialEntries={["/documents/018ff7c4-a5b6-7000-8000-000000000001"]}><Routes><Route path="/documents/:noteId" element={<DocumentRoute />} /></Routes></MemoryRouter>);
    const editButton = await screen.findByRole("button", { name: "模拟编辑" });
    vi.useFakeTimers();
    fireEvent.click(editButton);
    await act(async () => { await vi.advanceTimersByTimeAsync(750); });
    expect(saveContent).toHaveBeenCalledTimes(1);
    const status = document.querySelector(".document-save-state");
    expect(status).toHaveTextContent("版本冲突");
    expect(status).not.toHaveTextContent("等待同步");
  });

  it("keeps the live draft when the content-version bump is our own save echo", async () => {
    const view = render(
      <MemoryRouter initialEntries={["/documents/018ff7c4-a5b6-7000-8000-000000000001"]}>
        <Routes><Route path="/documents/:noteId" element={<DocumentRoute />} /></Routes>
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
        <MemoryRouter initialEntries={["/documents/018ff7c4-a5b6-7000-8000-000000000001"]}>
          <Routes><Route path="/documents/:noteId" element={<DocumentRoute />} /></Routes>
        </MemoryRouter>,
      );
    });

    expect((titleInput as HTMLInputElement).value).toBe("新产品计划");
  });

  it("keeps typed echoes without per-key renders and replaces them with a newer server revision", async () => {
    const show = () => <MemoryRouter initialEntries={["/documents/018ff7c4-a5b6-7000-8000-000000000001"]}><Routes><Route path="/documents/:noteId" element={<DocumentRoute />} /></Routes></MemoryRouter>;
    const view = render(show());
    const edit = await screen.findByRole("button", { name: "模拟编辑" });
    vi.useFakeTimers();
    fireEvent.click(edit);
    const afterTransition = editorInputs.mock.calls.length;
    for (let index = 2; index <= 36; index += 1) fireEvent.click(edit);
    expect(editorInputs.mock.calls.length).toBe(afterTransition);
    // A later shell render must receive the latest body, rather than the
    // initially supplied blocks or the first key's previous React props.
    fireEvent.change(screen.getByLabelText("文档标题"), { target: { value: "Latest title" } });
    expect(editorInputs.mock.calls.at(-1)![0].blocks[0].content[0].text).toBe("已编辑 36");
    await act(async () => { await vi.advanceTimersByTimeAsync(750); });
    expect(saveContent.mock.calls[0][0].submitted.blocks.blocks[0].content[0].text).toBe("已编辑 36");
    vi.useRealTimers();
    contentFixture.current = { ...contentFixture.current, content_version: 6,
      blocks: { ...createEmptyNoteBlocks(), doc: { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "Restored body" }] }] } },
    };
    view.rerender(show());
    await screen.findByRole("button", { name: "模拟编辑" });
    expect(editorInputs.mock.calls.at(-1)![0].blocks[0].content[0].text).toBe("Restored body");
  });

  it("keeps the live draft when a late stale response regresses the cached version", async () => {
    const view = render(
      <MemoryRouter initialEntries={["/documents/018ff7c4-a5b6-7000-8000-000000000001"]}>
        <Routes><Route path="/documents/:noteId" element={<DocumentRoute />} /></Routes>
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
          <Routes><Route path="/documents/:noteId" element={<DocumentRoute />} /></Routes>
        </MemoryRouter>,
      );
    });

    expect((titleInput as HTMLInputElement).value).toBe("新版本草稿");
  });

  it("adopts an already loaded newer snapshot after an older receipt settles",async()=>{
    let finish!:(value:{content_version:number})=>void;
    saveContent.mockReturnValueOnce(new Promise(resolve=>{finish=resolve;}));
    const show=()=><MemoryRouter initialEntries={["/documents/018ff7c4-a5b6-7000-8000-000000000001"]}><Routes><Route path="/documents/:noteId" element={<DocumentRoute/>}/></Routes></MemoryRouter>;
    const view=render(show());
    const edit=await screen.findByRole("button",{name:"模拟编辑"});
    vi.useFakeTimers();fireEvent.click(edit);
    await act(async()=>{await vi.advanceTimersByTimeAsync(750);});
    contentFixture.current={...contentFixture.current,content_version:6,blocks:{...createEmptyNoteBlocks(),doc:{type:"doc",content:[{type:"paragraph",content:[{type:"text",text:"较新快照"}]}]}}};
    view.rerender(show());
    expect(editorInputs.mock.calls.at(-1)![0].blocks[0].content[0].text).toBe("已编辑");
    await act(async()=>{finish({content_version:5});});
    expect(editorInputs.mock.calls.at(-1)![0].blocks[0].content[0].text).toBe("较新快照");
    expect(saveContent).toHaveBeenCalledTimes(1);
  });
});


it("opens a cached destination without first mounting the previous document", async () => {
  act(() => authStore.setState(ownerSession));
  render(<MemoryRouter initialEntries={["/documents/first"]}><Link to="/documents/second">Next document</Link><Routes><Route path="/documents/:noteId" element={<DocumentRoute />} /></Routes></MemoryRouter>);
  await screen.findByRole("button", { name: "模拟编辑" });
  editorInputs.mockClear();
  contentFixture.current = {
    ...contentFixture.current,
    note_id: "second",
    blocks: { schema_version: 1, editor: "tiptap", doc: { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "Destination body" }] }] } },
  };
  await act(async () => { fireEvent.click(screen.getByRole("link", { name: "Next document" })); });
  // The destination acquires its own asynchronous draft lane before becoming
  // editable. Every editor render must still contain only destination content.
  await screen.findByRole("button", { name: "模拟编辑" });
  expect(editorInputs.mock.calls.length).toBeGreaterThan(0);
  for (const [blocks] of editorInputs.mock.calls) expect(blocks.blocks[0].content).toEqual([{ type: "text", text: "Destination body", styles: {} }]);
  act(() => authStore.getState().clearSession());
});

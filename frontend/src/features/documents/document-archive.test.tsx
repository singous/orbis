import {nativeEditorServer} from "./editor/editor.test-utils";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Link, MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { authStore } from "../../shared/auth/auth-store";
import { NOTE_ID, NOTEBOOK_ID, USER_ID, WORKSPACE_ID, blocks, content, http, page, response, session } from "../collaboration/collaboration.test-utils";
import type { NoteBlocksV2 } from "../content/model/blocks";
import { DocumentEditorPage } from "./editor/DocumentEditorPage";

vi.mock("./DocumentShell", () => ({ DocumentShell: ({ toolbar, children }: { toolbar: React.ReactNode; children: React.ReactNode }) => <main>{toolbar}{children}</main> }));
vi.mock("./editor/TiptapEditor", () => ({
  TiptapEditor: ({ blocks: value, onChange, readOnly }: { blocks: NoteBlocksV2; onChange: (next: { blocks: ReturnType<typeof blocks> }) => void; readOnly: boolean }) => (
    <textarea aria-label="编辑正文" readOnly={readOnly} value={String((value.blocks[0]?.content as { text: string }[])?.[0]?.text ?? "")} onChange={(event) => onChange({ blocks: blocks(event.target.value) })} />
  ),
}));

let client: QueryClient;
beforeEach(() => {
  act(() => authStore.setState(session));
  client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
});
afterEach(() => {
  cleanup();
  client.clear();
  vi.unstubAllGlobals();
  act(() => authStore.getState().clearSession());
});

function showEditor() {
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[`/documents/${NOTE_ID}`]}>
        <Link to="/elsewhere">离开文档</Link>
        <Routes>
          <Route path="/documents/:noteId" element={<DocumentEditorPage />} />
          <Route path="/collections/:notebookId" element={<h1>笔记本</h1>} />
          <Route path="/elsewhere" element={<h1>其他页面</h1>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

async function archiveFromMenu() {
  const user = userEvent.setup();
  await user.click(screen.getByRole("button", { name: "更多文档操作" }));
  await user.click(await screen.findByRole("menuitem", { name: "归档文档" }));
}

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => { resolve = done; });
  return { promise, resolve };
}

const archiveServer=nativeEditorServer;

describe("archiving from the editor", () => {
  it("persists the title and body before archiving a draft still in the debounce window", async () => {
    const { stored, requests } = archiveServer();
    showEditor();
    const editor = await screen.findByLabelText("编辑正文");
    fireEvent.change(screen.getByLabelText("文档标题"), { target: { value: "归档前标题" } });
    fireEvent.change(editor, { target: { value: "归档前正文" } });
    await archiveFromMenu();

    await screen.findByRole("heading", { name: "笔记本" });
    expect(stored.note).toMatchObject({ is_archived:true, title: "归档前标题" });
    expect(stored.content).toMatchObject({ plain_text: "归档前正文", content_version: 5 });
    expect(requests.filter((request) => request.method !== "GET").map((request) => request.method)).toEqual(["POST", "PUT"]);
  });

  it("locks editing and duplicate archive actions until the draft save completes", async () => {
    const save = deferred();
    const { stored, requests } = archiveServer({ saveGate: save.promise });
    showEditor();
    const editor = await screen.findByLabelText("编辑正文");
    fireEvent.change(editor, { target: { value: "保存中正文" } });
    const archive = screen.getByRole("button", { name: "更多文档操作" });
    await archiveFromMenu();
    await waitFor(() => expect(requests.some((request) => request.path.endsWith("/operations"))).toBe(true));
    expect(requests.some((request) => request.path.endsWith("/archive"))).toBe(false);
    expect(editor).toHaveAttribute("readonly");
    expect(screen.getByLabelText("文档标题")).toHaveAttribute("readonly");
    expect(archive).toBeDisabled();
    expect(screen.getByRole("button", { name: "评论与历史" })).toBeDisabled();
    fireEvent.change(editor, { target: { value: "归档时不应接受的编辑" } });
    fireEvent.click(archive);
    expect(screen.queryByRole("menuitem", { name: "归档文档" })).not.toBeInTheDocument();
    await act(async () => { save.resolve(); });
    await screen.findByRole("heading", { name: "笔记本" });
    expect(stored.content.plain_text).toBe("保存中正文");
    expect(requests.filter((request) => request.path.endsWith("/archive"))).toHaveLength(1);
  });

  it.each([409, 500])("keeps the local draft and blocks archive retries after a %s save failure", async (saveStatus) => {
    const { stored, requests } = archiveServer({ saveStatus });
    showEditor();
    const editor = await screen.findByLabelText("编辑正文");
    fireEvent.change(editor, { target: { value: "需要保留的草稿" } });
    await archiveFromMenu();
    await screen.findByText(saveStatus === 409 ? "检测到其他窗口的更新" : "自动保存失败");
    expect(stored.note.is_archived).toBe(false);
    expect(screen.getByLabelText("编辑正文")).toHaveValue("需要保留的草稿");
    expect(screen.getByLabelText("编辑正文")).not.toHaveAttribute("readonly");
    await archiveFromMenu();
    expect(requests.filter((request) => request.path.endsWith("/operations"))).toHaveLength(saveStatus===500?2:1);
    expect(requests.some((request) => request.path.endsWith("/archive"))).toBe(false);
  });

  it("saves edits queued behind an in-flight autosave before archiving", async () => {
    const save = deferred();
    const { stored, requests } = archiveServer({ saveGate: save.promise });
    showEditor();
    const editor = await screen.findByLabelText("编辑正文");
    fireEvent.change(editor, { target: { value: "第一版正文" } });
    await waitFor(() => expect(requests.some((request) => request.path.endsWith("/operations"))).toBe(true));
    fireEvent.change(editor, { target: { value: "归档时的最新正文" } });
    await archiveFromMenu();
    expect(requests.some((request) => request.path.endsWith("/archive"))).toBe(false);
    await act(async () => { save.resolve(); });
    await screen.findByRole("heading", { name: "笔记本" });
    expect(stored.content).toMatchObject({ plain_text: "归档时的最新正文", content_version: 6 });
    expect(requests.filter((request) => request.path.endsWith("/operations")).map((request) => request.body?.expected_version)).toEqual([4, 5]);
  });

  it("keeps the saved document editable after an archive failure and permits retry", async () => {
    const options = { archiveStatus: 500 };
    const { stored, requests } = archiveServer(options);
    showEditor();
    const editor = await screen.findByLabelText("编辑正文");
    fireEvent.change(editor, { target: { value: "已保存但未归档" } });
    await archiveFromMenu();
    expect(await screen.findByRole("alert")).toHaveTextContent("归档请求失败");
    expect(stored.note.is_archived).toBe(false);
    expect(stored.content.plain_text).toBe("已保存但未归档");
    expect(editor).not.toHaveAttribute("readonly");
    options.archiveStatus = 0;
    fireEvent.change(editor, { target: { value: "重试归档前再编辑" } });
    await archiveFromMenu();
    await screen.findByRole("heading", { name: "笔记本" });
    expect(stored.content.plain_text).toBe("重试归档前再编辑");
    expect(stored.note.is_archived).toBe(true);
    expect(requests.filter((request) => request.path.endsWith("/archive"))).toHaveLength(2);
  });

  it("cancels archive when the user leaves while the draft is saving", async () => {
    const save = deferred();
    const { stored, requests } = archiveServer({ saveGate: save.promise });
    showEditor();
    const editor = await screen.findByLabelText("编辑正文");
    fireEvent.change(editor, { target: { value: "离开前草稿" } });
    await archiveFromMenu();
    await waitFor(() => expect(requests.some((request) => request.path.endsWith("/operations"))).toBe(true));
    fireEvent.click(screen.getByRole("link", { name: "离开文档" }));
    await act(async () => { save.resolve(); });
    await screen.findByRole("heading", { name: "其他页面" });
    expect(stored.content.plain_text).toBe("离开前草稿");
    expect(stored.note.is_archived).toBe(false);
    expect(requests.some((request) => request.path.endsWith("/archive"))).toBe(false);
  });

  it("does not navigate away from another page after a pending archive finishes", async () => {
    const archive = deferred();
    const { stored, requests } = archiveServer({ archiveGate: archive.promise });
    showEditor();
    await screen.findByLabelText("编辑正文");
    await archiveFromMenu();
    await waitFor(() => expect(requests.some((request) => request.path.endsWith("/archive"))).toBe(true));
    fireEvent.click(screen.getByRole("link", { name: "离开文档" }));
    await act(async () => { archive.resolve(); });
    expect(stored.note.is_archived).toBe(true);
    expect(screen.getByRole("heading", { name: "其他页面" })).toBeInTheDocument();
  });
});

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { authStore } from "../../shared/auth/auth-store";
import { BoardShell } from "./BoardShell";
import type { Board } from "./model";

vi.mock("../workspace/WorkspaceTopbar", () => ({ WorkspaceTopbar: () => null }));
vi.mock("../workspace/RailCreateMenu", () => ({ RailCreateMenu: () => null }));
vi.mock("../documents/DocumentContextPanel", () => ({
  DocumentContextPanel: ({ notebookId, activeNoteId }: { notebookId: string; activeNoteId?: string }) => (
    <nav aria-label="测试笔记本目录" data-notebook={notebookId} data-active-note={activeNoteId}>文档与画板</nav>
  ),
}));
vi.mock("../documents/queries", () => ({
  useNotebook: () => ({ data: { id: "notebook", title: "设计笔记本" } }),
  useNotebooks: () => ({ data: { items: [] } }),
  useCreateNote: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useNoteTree: () => ({ data: { items: [] }, isSuccess: true }),
}));

const board: Board = {
  id: "board", document_id: "board-document", collection_id: "notebook", workspace_id: "workspace",
  title: "体验设计画板", schema_version: 1, revision: 0,
  created_at_ms: 1, updated_at_ms: 1,
  pages: [{ id: "page", name: "页面 1", position: 0, background: "#fff", version: 1 }],
};

beforeEach(() => {
  localStorage.clear();
  authStore.setState({ accessToken: "test", workspace: { id: "workspace", name: "设计空间", role: "owner", created_at_ms: 1, updated_at_ms: 1 } });
});
afterEach(() => { cleanup(); authStore.getState().clearSession(); });

it("uses the notebook directory and preserves the board heading and actions while it is collapsed", () => {
  render(
    <QueryClientProvider client={new QueryClient()}>
      <MemoryRouter initialEntries={["/documents/board-document"]}>
        <BoardShell board={board} status={<span role="status">已保存</span>} actions={<button>导出</button>}>
          <div>画布内容</div>
        </BoardShell>
      </MemoryRouter>
    </QueryClientProvider>,
  );
  const directory = screen.getByRole("navigation", { name: "测试笔记本目录" });
  expect(directory).toHaveAttribute("data-notebook", "notebook");
  expect(directory).toHaveAttribute("data-active-note", "board-document");
  fireEvent.click(screen.getByRole("button", { name: "收起笔记本目录" }));
  expect(screen.queryByRole("navigation", { name: "测试笔记本目录" })).toBeNull();
  expect(screen.getByRole("heading", { level: 1, name: board.title })).toBeVisible();
  expect(screen.getByRole("status")).toHaveTextContent("已保存");
  expect(screen.getByRole("button", { name: "导出" })).toBeVisible();
  expect(screen.getByRole("region", { name: "画板工作区" })).toHaveTextContent("画布内容");
  fireEvent.click(screen.getByRole("button", { name: "展开笔记本目录" }));
  expect(directory).toBeVisible();
});

import type { ReactNode } from "react";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { authStore } from "../../shared/auth/auth-store";
import { HomePage } from "./HomePage";

const mocks = vi.hoisted(() => ({ openSearch: vi.fn(), create: vi.fn(), refetch: vi.fn(), failed: false, hasNotebook: false, tree: vi.fn(() => { throw new Error("Home must not load the document tree"); }) }));
vi.mock("../workspace/WorkspaceShell", () => ({ WorkspaceShell: ({ children }: { children: ReactNode }) => <main>{children}</main> }));
vi.mock("../search/search-palette-context", () => ({ useSearchPalette: () => ({ isOpen: false, openSearch: mocks.openSearch }) }));
vi.mock("../quick-notes/QuickNoteComposer", () => ({ QuickNoteComposer: ({ canEdit }: { canEdit: boolean }) => <section aria-label="快速记录"><button disabled={!canEdit}>记一下</button></section> }));
vi.mock("../quick-notes/QuickNoteTags", () => ({ QuickNoteTags: () => null }));
vi.mock("../documents/queries", () => ({
  useNotebooks: () => ({ data: { items: mocks.hasNotebook ? [{ id: "notebook", title: "Notebook", updated_at_ms: 1 }] : [], pagination: { total: 12 } }, isSuccess: true }),
  useDocumentIndex: () => ({ data: { items: [], pagination: { total: 128 } }, isSuccess: !mocks.failed, isError: mocks.failed, refetch: mocks.refetch }),
  useCreateNote: () => ({ mutateAsync: mocks.create, isPending: false }),
  useNoteTree: mocks.tree,
}));
vi.mock("./home-queries", () => ({ useHomeQuickNotes: () => ({
  summary: { data: { total: 36 }, isSuccess: true },
  recent: { data: { items: [] }, isSuccess: true },
  tags: { data: { items: [] }, isSuccess: true }, refresh: vi.fn(),
}) }));

beforeEach(() => { mocks.failed = false; mocks.hasNotebook = false; vi.clearAllMocks(); authStore.setState({ user: null, workspace: null }); });
afterEach(cleanup);
function renderHome() { return render(<MemoryRouter><HomePage /></MemoryRouter>); }

it("creates a document without fetching the notebook tree", async () => {
  mocks.hasNotebook = true;
  mocks.create.mockResolvedValue({ id: "created" });
  authStore.setState({ workspace: { id: "workspace", role: "owner" } as never });
  renderHome();
  fireEvent.click(screen.getByRole("button", { name: "写篇文档" }));
  await waitFor(() => expect(mocks.create).toHaveBeenCalledWith({ notebook_id: "notebook", title: "未命名文档", parent_id: null }));
  expect(mocks.tree).not.toHaveBeenCalled();
});

it("uses server totals and keeps navigation available in the new home layout", () => {
  renderHome();
  const stats = screen.getByRole("navigation", { name: "内容统计" });
  expect(within(stats).getByRole("link", { name: "128 篇文档" })).toHaveAttribute("href", "/documents");
  expect(within(stats).getByRole("link", { name: "12 本笔记本" })).toHaveAttribute("href", "/documents/collections");
  expect(within(stats).getByRole("link", { name: "36 条随手记" })).toHaveAttribute("href", "/documents/quick-notes");
  expect(screen.getByRole("link", { name: "查看全部" })).toHaveAttribute("href", "/documents/recent");
  expect(screen.getByText("还没有可继续的文档")).toBeVisible();
  expect(screen.getByRole("region", { name: "灵感足迹" })).toHaveTextContent("依据最近 0 篇文档与 0 条随手记");
});

it("submits the search text and ignores Enter during IME composition", () => {
  renderHome();
  const input = screen.getByRole("searchbox", { name: "搜索文档" });
  fireEvent.change(input, { target: { value: "  灵感  " } });
  fireEvent.keyDown(input, { key: "Enter", isComposing: true });
  expect(mocks.openSearch).not.toHaveBeenCalled();
  fireEvent.submit(screen.getByRole("search"));
  expect(mocks.openSearch).toHaveBeenCalledWith({ q: "灵感", type: "document" });
});

it("allows retrying a failed section without presenting its count as zero", () => {
  mocks.failed = true;
  renderHome();
  expect(screen.getByRole("alert")).toHaveTextContent("部分内容加载失败");
  expect(screen.getByRole("link", { name: "— 篇文档" })).toBeVisible();
  expect(screen.queryByText("还没有可继续的文档")).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "重新加载" }));
  expect(mocks.refetch).toHaveBeenCalledOnce();
});

it("keeps viewers in read-only mode", () => {
  authStore.setState({ user: { id: "user", created_at_ms: Date.now() } as never, workspace: { id: "workspace", role: "viewer" } as never });
  renderHome();
  expect(screen.queryByRole("button", { name: "写篇文档" })).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: "记一下" })).toBeDisabled();
  expect(screen.getByRole("link", { name: "浏览文档" })).toHaveAttribute("href", "/documents");
});

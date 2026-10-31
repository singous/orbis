import {QueryClient,QueryClientProvider} from "@tanstack/react-query";
import { act, cleanup, fireEvent, render as renderTestingLibrary, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { createNotebookSidebar } from "./NotebookSectionMenu";
import { WorkspaceShell, type WorkspaceSidebarConfig } from "../workspace/WorkspaceShell";
import { authStore } from "../../shared/auth/auth-store";

function render(ui:React.ReactElement){return renderTestingLibrary(ui,{wrapper:({children})=><QueryClientProvider client={new QueryClient()}>{children}</QueryClientProvider>});}

vi.mock("../workspace/WorkspaceTopbar", () => ({ WorkspaceTopbar: () => null }));
vi.mock("../workspace/RailCreateMenu", () => ({ RailCreateMenu: () => null }));
vi.mock("./DocumentContextPanel", () => ({ DocumentContextPanel: () => <nav aria-label="测试目录">当前文档</nav> }));
vi.mock("./queries", () => ({
  useNotebook: () => ({ data: { id: "notebook", title: "当前笔记本" } }),
  useNotebooks: () => ({ data: { items: [{ id: "notebook", title: "当前笔记本" }] } }),
  useCreateNote: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useNoteTree: () => ({ data: { items: [] }, isSuccess: true }),
}));

beforeEach(() => {
  localStorage.clear();
  authStore.setState({accessToken:"test", workspace: { id: "directory", name: "测试空间", role: "owner", created_at_ms: 1, updated_at_ms: 1 } });
});
afterEach(() => { cleanup(); authStore.getState().clearSession(); vi.restoreAllMocks(); });
const shell = (config: WorkspaceSidebarConfig) => <MemoryRouter initialEntries={["/collections/notebook"]}><WorkspaceShell sidebar={config}>笔记本首页</WorkspaceShell></MemoryRouter>;

it("retains the tree while collapsed and supports public keyboard resizing", () => {
  render(shell(createNotebookSidebar("notebook")));
  const resize = screen.getByRole("separator", { name: "调整笔记本目录宽度" });
  expect(screen.getByRole("link", { name: "当前笔记本" })).toHaveAttribute("href", "/collections/notebook");
  expect(screen.getByRole("button", { name: "创建内容" })).toBeEnabled();
  fireEvent.keyDown(resize, { key: "ArrowRight" });
  expect(localStorage.getItem("orbis.notebookDirectoryWidth")).toBe("248");
  fireEvent.click(screen.getByRole("button", { name: "收起笔记本目录" }));
  expect(screen.queryByRole("navigation", { name: "测试目录" })).toBeNull();
  expect(screen.getByRole("navigation", { name: "测试目录", hidden: true })).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "展开笔记本目录" })).toHaveFocus();
  fireEvent.click(screen.getByRole("button", { name: "展开笔记本目录" }));
  expect(resize).not.toBeInTheDocument();
  expect(screen.getByRole("separator", { name: "调整笔记本目录宽度" })).toHaveAttribute("aria-valuenow", "248");
});

it.each(["159", "481", "NaN", "Infinity", "broken"])("ignores invalid legacy width %s without overwriting the stored setting", stored => {
  localStorage.setItem("orbis.notebookDirectoryWidth", stored);
  render(shell(createNotebookSidebar("notebook")));
  expect(screen.getByRole("separator")).toHaveAttribute("aria-valuenow", "232");
  expect(localStorage.getItem("orbis.notebookDirectoryWidth")).toBe(stored);
});

it("switches preference profiles without leaking the previous menu's width or collapse state", () => {
  localStorage.setItem("orbis.notebookDirectoryWidth", "300");
  localStorage.setItem("orbis.sidebarWidth", "350");
  localStorage.setItem("orbis.sidebarCollapsed", "1");
  const view = render(shell(createNotebookSidebar("notebook")));
  expect(screen.getByRole("separator")).toHaveAttribute("aria-valuenow", "300");
  view.rerender(shell({ title: "普通菜单", content: <nav>功能菜单</nav> }));
  expect(screen.getByRole("button", { name: "收起侧栏" })).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "展开侧栏" })).toBeNull();
  expect(screen.getByRole("separator")).toHaveAttribute("aria-valuenow", "350");
  view.rerender(shell(createNotebookSidebar("notebook")));
  expect(screen.getByRole("separator")).toHaveAttribute("aria-valuenow", "300");
});

it("keeps resizing and collapse usable when browser preference storage is unavailable", () => {
  vi.spyOn(localStorage, "getItem").mockImplementation(() => { throw new Error("Storage blocked"); });
  vi.spyOn(localStorage, "setItem").mockImplementation(() => { throw new Error("Storage blocked"); });
  render(shell(createNotebookSidebar("notebook")));
  fireEvent.keyDown(screen.getByRole("separator"), { key: "ArrowRight" });
  expect(screen.getByRole("separator")).toHaveAttribute("aria-valuenow", "248");
  fireEvent.click(screen.getByRole("button", { name: "收起笔记本目录" }));
  expect(screen.getByRole("button", { name: "展开笔记本目录" })).toBeInTheDocument();
  act(() => { fireEvent.click(screen.getByRole("button", { name: "展开笔记本目录" })); });
  expect(screen.getByRole("navigation", { name: "测试目录" })).toBeInTheDocument();
});

it("shares the default width and resize limit with ordinary function sidebars", () => {
  const view = render(shell({ title: "普通菜单", content: <nav>功能菜单</nav> }));
  const ordinary = screen.getByRole("separator");
  const width = ordinary.getAttribute("aria-valuenow");
  const maximum = ordinary.getAttribute("aria-valuemax");
  view.rerender(shell(createNotebookSidebar("notebook")));
  expect(screen.getByRole("separator")).toHaveAttribute("aria-valuenow", width);
  expect(screen.getByRole("separator")).toHaveAttribute("aria-valuemax", maximum);
});

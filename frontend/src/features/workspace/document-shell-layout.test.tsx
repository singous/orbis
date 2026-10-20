import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { WorkspaceShell, type WorkspaceSidebarConfig } from "./WorkspaceShell";
import { authStore } from "../../shared/auth/auth-store";

vi.mock("./WorkspaceTopbar", () => ({ WorkspaceTopbar: () => null }));
vi.mock("./WorkspaceNavigation", () => ({ WorkspaceNavigation: () => <nav aria-label="功能菜单">功能导航</nav> }));
vi.mock("./BusinessRail", () => ({ BusinessRail: ({ collapsed, onExpand, expandLabel, createMenu }: { collapsed: boolean; onExpand: () => void; expandLabel: string; createMenu: React.ReactNode }) => <nav aria-label="业务导航">{createMenu}{collapsed ? <button data-sidebar-toggle="expand" aria-label={expandLabel} onClick={onExpand}>展开</button> : null}</nav> }));
vi.mock("./RailCreateMenu", () => ({ RailCreateMenu: () => <button>新建资产</button> }));

const notebook: WorkspaceSidebarConfig = {
  id: "notebook-directory",
  title: <a href="/collections/notebook">当前笔记本</a>,
  actions: <button>新建文档</button>,
  content: <nav aria-label="笔记本目录"><a href="/documents/note">文档树</a></nav>,
  label: "笔记本目录栏",
  collapseLabel: "收起笔记本目录",
  expandLabel: "展开笔记本目录",
  resizeLabel: "调整笔记本目录宽度",
  preferences: { widthKey: "orbis.notebookDirectoryWidth" },
};

beforeEach(() => { localStorage.clear(); });
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.useRealTimers(); authStore.getState().clearSession(); });
function open(sidebar: WorkspaceSidebarConfig | false = notebook, compact = false) {
  vi.stubGlobal("matchMedia", (query: string) => ({ matches: compact && query.includes("max-width"), addEventListener: vi.fn(), removeEventListener: vi.fn() }));
  authStore.setState({ accessToken: "layout-test", workspace: { id: "layout", name: "测试", role: "owner", created_at_ms: 1, updated_at_ms: 1 } });
  return render(<MemoryRouter initialEntries={["/collections/notebook"]}><WorkspaceShell sidebar={sidebar}><p>笔记本首页</p></WorkspaceShell></MemoryRouter>);
}
it("uses the public sidebar container and header slots inside the rail frame", () => {
  const view = open();
  const sidebar = view.container.querySelector(".workspace-main-navigation > .workspace-sidebar")!;
  expect(sidebar).toHaveAttribute("id", "notebook-directory");
  expect(sidebar.querySelector(".workspace-sidebar-header")).toContainElement(screen.getByRole("link", { name: "当前笔记本" }));
  expect(sidebar.querySelector(".workspace-sidebar-header")).toContainElement(screen.getByRole("button", { name: "新建文档" }));
  expect(view.container.querySelector(".workspace-shell-grid > .workspace-sidebar")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "收起笔记本目录" }));
  expect(sidebar).toHaveAttribute("inert", "");
  expect(screen.getByRole("button", { name: "展开笔记本目录" })).toHaveFocus();
  expect(screen.queryByRole("navigation", { name: "笔记本目录" })).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "展开笔记本目录" }));
  expect(screen.getByRole("button", { name: "收起笔记本目录" })).toHaveFocus();
  expect(screen.getByRole("navigation", { name: "笔记本目录" })).toBeInTheDocument();
});
it("restores widths but starts expanded across remounts despite legacy collapse values", () => {
  localStorage.setItem("orbis.sidebarWidth", "350");
  localStorage.setItem("orbis.sidebarCollapsed", "1");
  localStorage.setItem("orbis.notebookDirectoryWidth", "300");
  localStorage.setItem("orbis.notebookDirectoryCollapsed", "1");
  const view = open();
  expect(screen.getByRole("separator", { name: "调整笔记本目录宽度" })).toHaveAttribute("aria-valuenow", "300");
  fireEvent.click(screen.getByRole("button", { name: "收起笔记本目录" }));
  expect(screen.getByRole("button", { name: "展开笔记本目录" })).toBeInTheDocument();
  view.unmount();
  open();
  expect(screen.getByRole("button", { name: "收起笔记本目录" })).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "展开笔记本目录" })).toBeNull();
  expect(screen.getByRole("separator", { name: "调整笔记本目录宽度" })).toHaveAttribute("aria-valuenow", "300");
});

it("uses the same animation state and clears it after rapid toggles", () => {
  vi.useFakeTimers();
  const view = open();
  fireEvent.click(screen.getByRole("button", { name: "收起笔记本目录" }));
  fireEvent.click(screen.getByRole("button", { name: "展开笔记本目录" }));
  expect(view.container.querySelector(".workspace-shell")).toHaveClass("sidebar-animating");
  act(() => { vi.advanceTimersByTime(300); });
  expect(view.container.querySelector(".workspace-shell")).toHaveClass("sidebar-animating");
  act(() => { vi.advanceTimersByTime(200); });
  expect(view.container.querySelector(".workspace-shell")).not.toHaveClass("sidebar-animating");
});
it("keeps global creation in the rail and traps then restores focus in the mobile drawer", () => {
  open(notebook, true);
  const trigger = screen.getByRole("button", { name: "打开主导航" });
  act(() => { trigger.focus(); });
  fireEvent.click(trigger);
  expect(screen.getByRole("navigation", { name: "业务导航" })).toBeInTheDocument();
  expect(screen.getByRole("navigation", { name: "笔记本目录" })).toBeInTheDocument();
  expect(screen.getAllByRole("button", { name: "新建资产" })).toHaveLength(1);
  expect(screen.queryByRole("separator")).toBeNull();
  const last = screen.getByRole("link", { name: "文档树" });
  act(() => { last.focus(); });
  fireEvent.keyDown(last, { key: "Tab" });
  expect(screen.getByRole("button", { name: "新建资产" })).toHaveFocus();
  fireEvent.keyDown(document, { key: "Escape" });
  expect(trigger).toHaveAttribute("aria-expanded", "false");
  expect(trigger).toHaveFocus();
  expect(localStorage.getItem("orbis.notebookDirectoryCollapsed")).toBeNull();
});
it("supports a rail-only overview without a phantom expand control", () => {
  open(false);
  expect(screen.queryByRole("button", { name: "展开侧栏" })).toBeNull();
  expect(screen.queryByRole("region", { name: "侧栏" })).toBeNull();
  expect(screen.getByRole("button", { name: "新建资产" })).toBeInTheDocument();
});

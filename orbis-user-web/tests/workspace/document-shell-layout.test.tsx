import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, expect, it, vi } from "vitest";
import { WorkspaceShell } from "../../src/features/workspace/WorkspaceShell";
import { authStore } from "../../src/shared/auth/auth-store";
vi.mock("../../src/features/workspace/WorkspaceTopbar", () => ({ WorkspaceTopbar: () => null }));
vi.mock("../../src/features/workspace/WorkspaceNavigation", () => ({ WorkspaceNavigation: () => <nav aria-label="全局文档导航">全局导航</nav> }));
vi.mock("../../src/features/workspace/BusinessRail", () => ({ BusinessRail: ({ collapsed, onExpand, expandLabel }: { collapsed: boolean; onExpand: () => void; expandLabel: string }) => <nav aria-label="业务导航">{collapsed ? <button aria-label={expandLabel} onClick={onExpand}>展开</button> : null}</nav> }));
vi.mock("../../src/features/workspace/RailCreateMenu", () => ({ RailCreateMenu: () => null }));
vi.mock("../../src/features/workspace/use-sidebar-resize", () => ({ SIDEBAR_MIN_WIDTH: 160, useSidebarResize: () => ({ width: 224, maximum: 400, style: {}, preview: vi.fn(), commit: vi.fn(), reset: vi.fn(), begin: () => vi.fn() }) }));
afterEach(() => { cleanup(); vi.unstubAllGlobals(); authStore.getState().clearSession(); });
function open(compact = false) {
  vi.stubGlobal("matchMedia", () => ({ matches: compact, addEventListener: vi.fn(), removeEventListener: vi.fn() }));
  authStore.setState({ accessToken: "layout-test" });
  return render(<MemoryRouter initialEntries={["/collections/notebook"]}><WorkspaceShell sectionMenu={<nav aria-label="笔记本目录">文档树</nav>}><p>笔记本首页</p></WorkspaceShell></MemoryRouter>);
}
it("keeps the rail and notebook directory inside the same navigation frame", () => {
  const view = open();
  expect(screen.getByRole("navigation", { name: "业务导航" })).toBeInTheDocument();
  expect(screen.getByRole("navigation", { name: "笔记本目录" })).toBeInTheDocument();
  expect(view.container.querySelector('.workspace-main-navigation nav[aria-label="笔记本目录"]')).not.toBeNull();
  expect(view.container.querySelector('.workspace-shell-grid > .notebook-directory-column')).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "收起笔记本目录" }));
  expect(screen.queryByRole("navigation", { name: "笔记本目录" })).toBeNull();
  expect(screen.getByRole("navigation", { name: "业务导航" })).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "展开笔记本目录" }));
  expect(screen.getByRole("navigation", { name: "笔记本目录" })).toBeInTheDocument();
});
it("makes global navigation and the notebook tree available in the mobile drawer", () => {
  open(true);
  fireEvent.click(screen.getByRole("button", { name: "打开主导航" }));
  expect(screen.getByRole("navigation", { name: "业务导航" })).toBeInTheDocument();
  expect(screen.getByRole("navigation", { name: "笔记本目录" })).toBeInTheDocument();
  fireEvent.keyDown(document, { key: "Escape" });
  expect(screen.getByRole("button", { name: "打开主导航" })).toHaveAttribute("aria-expanded", "false");
});

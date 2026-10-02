import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, expect, it, vi } from "vitest";
import { BusinessRail } from "../../src/features/workspace/BusinessRail";
import { WorkspaceShell } from "../../src/features/workspace/WorkspaceShell";
import { authStore } from "../../src/shared/auth/auth-store";

const query = vi.hoisted(() => vi.fn(() => ({ data: { items: [{ id: "quick", title: "快捷笔记本" }, { id: "other", title: "普通笔记本" }] } })));
vi.mock("../../src/features/documents/queries", () => ({ useNotebooks: query }));
vi.mock("../../src/features/workspace/WorkspaceTopbar", () => ({ WorkspaceTopbar: () => null }));
vi.mock("../../src/features/workspace/RailCreateMenu", () => ({ RailCreateMenu: () => null }));
vi.mock("../../src/features/documents/pinned-notebooks", () => ({ usePinnedNotebooks: () => ({ isPinned: (id: string) => id === "quick" }) }));
afterEach(() => { cleanup(); query.mockClear(); authStore.getState().clearSession(); });

it("never loads notebook shortcuts or opens a business menu from a rail hover", () => {
  render(<MemoryRouter initialEntries={["/documents"]}><BusinessRail collapsed={false} onExpand={() => undefined} /></MemoryRouter>);
  fireEvent.mouseEnter(screen.getByRole("link", { name: "在线文档" }));
  expect(query).not.toHaveBeenCalled();
  expect(screen.queryByRole("navigation", { name: "笔记本快捷访问" })).not.toBeInTheDocument();
});

it("keeps saved notebook shortcuts in the expanded function menu and removes them when authentication ends", () => {
  authStore.setState({ accessToken: "test" });
  render(<MemoryRouter initialEntries={["/documents"]}><WorkspaceShell>内容</WorkspaceShell></MemoryRouter>);
  expect(screen.getByRole("link", { name: "快捷笔记本" })).toHaveAttribute("href", "/collections/quick");
  expect(screen.queryByRole("link", { name: "普通笔记本" })).not.toBeInTheDocument();
  expect(screen.getByRole("link", { name: "最近编辑" })).toHaveAttribute("href", "/documents/recent");
  expect(screen.getByRole("link", { name: "归档" })).toHaveAttribute("href", "/documents/archive");
  act(() => authStore.getState().clearSession());
  expect(screen.queryByRole("link", { name: "快捷笔记本" })).not.toBeInTheDocument();
});

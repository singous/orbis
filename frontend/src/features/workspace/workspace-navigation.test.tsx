import {RequireAuth} from "../../shared/auth/RequireAuth";
import {QueryClient,QueryClientProvider} from "@tanstack/react-query";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter,Route,Routes } from "react-router-dom";
import { afterEach,beforeEach, expect, it, vi } from "vitest";
import { BusinessRail } from "./BusinessRail";
import { WorkspaceShell } from "./WorkspaceShell";
import { authStore } from "../../shared/auth/auth-store";
import { SearchPaletteProvider } from "../search/search-palette-context";

const query = vi.hoisted(() => vi.fn(() => ({ data: { items: [{ id: "quick", title: "快捷笔记本" }, { id: "other", title: "普通笔记本" }] } })));
vi.mock("../documents/queries", () => ({ useNotebooks: query }));
vi.mock("./WorkspaceTopbar", () => ({ WorkspaceTopbar: () => null }));
vi.mock("./RailCreateMenu", () => ({ RailCreateMenu: () => null }));
vi.mock("../documents/pinned-notebooks", () => ({ usePinnedNotebooks: () => ({ isPinned: (id: string) => id === "quick" }) }));
beforeEach(()=>authStore.setState({accessToken:"test"}));
afterEach(() => { cleanup(); query.mockClear(); authStore.getState().clearSession(); });

it("never loads notebook shortcuts or opens a business menu from a rail hover", () => {
  render(<MemoryRouter initialEntries={["/documents"]}><SearchPaletteProvider><BusinessRail collapsed={false} onExpand={() => undefined} /></SearchPaletteProvider></MemoryRouter>);
  fireEvent.mouseEnter(screen.getByRole("link", { name: "在线文档" }));
  expect(query).not.toHaveBeenCalled();
  expect(screen.queryByRole("navigation", { name: "笔记本快捷访问" })).not.toBeInTheDocument();
});

it("keeps saved notebook shortcuts in the expanded function menu and removes them when authentication ends", () => {
  authStore.setState({ accessToken: "test" });
  render(<MemoryRouter initialEntries={["/documents"]}><QueryClientProvider client={new QueryClient()}><Routes><Route path="/login" element={<div>登录</div>}/><Route path="*" element={<RequireAuth><WorkspaceShell>内容</WorkspaceShell></RequireAuth>}/></Routes></QueryClientProvider></MemoryRouter>);
  expect(screen.getByRole("link", { name: "快捷笔记本" })).toHaveAttribute("href", "/collections/quick");
  expect(screen.queryByRole("link", { name: "普通笔记本" })).not.toBeInTheDocument();
  expect(screen.getByRole("link", { name: "最近编辑" })).toHaveAttribute("href", "/documents/recent");
  expect(screen.getByRole("link", { name: "回收站" })).toHaveAttribute("href", "/documents/archive");
  expect(screen.queryByRole("link", { name: "知识库" })).not.toBeInTheDocument();
  expect(screen.queryByRole("link", { name: "记忆" })).not.toBeInTheDocument();
  act(() => authStore.getState().clearSession());
  expect(screen.queryByRole("link", { name: "快捷笔记本" })).not.toBeInTheDocument();
});

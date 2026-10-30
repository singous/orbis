import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { lazy, type ComponentType } from "react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { WorkspaceRoute } from "../../src/app/WorkspaceRoute";
import { WorkspaceShell } from "../../src/features/workspace/WorkspaceShell";
import { authStore } from "../../src/shared/auth/auth-store";

const id = "018ff7c4-a5b6-7000-8000-000000000001";
beforeEach(() => {
  authStore.getState().setSession({ accessToken: "test-access", refreshToken: "test-refresh", user: { id, email: "owner@example.com", display_name: "Owner", avatar_asset_id: null, bio: null, profile_version: 1, preferred_workspace_id: id, created_at_ms: 1, updated_at_ms: 1 }, workspace: { id, name: "工作空间", role: "owner", created_at_ms: 1, updated_at_ms: 1 } });
  vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ code: "OK", message: "成功", request_id: "lazy-frame", data: { items: [], pagination: { page: 1, page_size: 20, total: 0 } } }), { headers: { "Content-Type": "application/json" } })));
});
afterEach(() => { cleanup(); authStore.getState().clearSession(); delete window.__ORBIS_HOST__; vi.unstubAllGlobals(); vi.restoreAllMocks(); });

it.each([["web", false], ["desktop", false], ["web", true]] as const)("preserves an open palette and its trigger while the %s page finishes loading (compact: %s)", async (surface, compact) => {
  window.__ORBIS_HOST__ = { surface };
  vi.spyOn(window, "matchMedia").mockImplementation(query => ({ matches: compact && query === "(max-width: 767px)", media: query, onchange: null, addListener: () => {}, removeListener: () => {}, addEventListener: () => {}, removeEventListener: () => {}, dispatchEvent: () => false }));
  let complete!: (value: { default: ComponentType }) => void;
  const Page = lazy(() => new Promise<{ default: ComponentType }>(resolve => { complete = resolve; }));
  function LoadedPage() { return <WorkspaceShell><h1>页面加载完成</h1></WorkspaceShell>; }
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(<QueryClientProvider client={client}><MemoryRouter initialEntries={["/home"]}><WorkspaceRoute><Page /></WorkspaceRoute></MemoryRouter></QueryClientProvider>);
  await screen.findByRole("status", { name: "正在打开首页…" });
  const name = surface === "web" ? "搜索" : "全局搜索";
  const user = userEvent.setup();
  if (compact) await user.click(screen.getByRole("button", { name: "打开主导航" }));
  const oldTrigger = screen.getByRole("button", { name });
  await user.click(oldTrigger);
  const input = screen.getByRole("combobox", { name: "搜索任何内容" });
  await user.type(input, "保留加载中的搜索");
  await waitFor(() => expect(input).toHaveFocus());
  await act(async () => complete({ default: LoadedPage }));
  expect(oldTrigger).toBeInTheDocument();
  expect(screen.getByRole("heading", { name: "页面加载完成", hidden: true })).toBeInTheDocument();
  expect(screen.getByRole("combobox", { name: "搜索任何内容" })).toBe(input);
  expect(input).toHaveValue("保留加载中的搜索");
  expect(input).toHaveFocus();
  expect(screen.getAllByRole("dialog", { name: "全局搜索" })).toHaveLength(1);
  await user.click(screen.getByRole("button", { name: "关闭搜索" }));
  await waitFor(() => expect(screen.queryByRole("dialog", { name: "全局搜索" })).not.toBeInTheDocument());
  const currentTrigger = screen.getByRole("button", { name });
  expect(currentTrigger).toBe(oldTrigger);
  await waitFor(() => expect(currentTrigger).toHaveFocus());
  await user.click(currentTrigger);
  expect(screen.getByRole("combobox", { name: "搜索任何内容" })).toHaveValue("");
  client.clear();
});

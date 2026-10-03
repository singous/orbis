import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, expect, it, vi } from "vitest";
import { SiteEditorPage } from "../../src/features/sites/SiteEditorPage";
import { authStore } from "../../src/shared/auth/auth-store";
import { preparePendingNavigation } from "../../src/shared/navigation/pending-navigation";
import { page, response, session } from "../../src/features/collaboration/collaboration.test-utils";

vi.mock("../../src/features/workspace/WorkspaceShell", () => ({ WorkspaceShell: ({ children }: { children: React.ReactNode }) => <main>{children}</main> }));
const id = "018ff7c4-a5b6-7000-8000-000000000001";
const site = { id, name: "产品手册", slug: "guide", description: "产品知识", site_kind: "handbook", accent_color: "#0f766e", navigation: [], config_version: 2, published_release_id: null, published_slug: null, created_at_ms: 1, updated_at_ms: 2 };
let client: QueryClient;
afterEach(() => { cleanup(); client?.clear(); vi.unstubAllGlobals(); act(() => authStore.getState().clearSession()); });
function showSite() {
  act(() => authStore.setState(session));
  const writes: string[] = [];
  vi.stubGlobal("fetch", vi.fn(async (path: string, init?: RequestInit) => {
    if (init?.method && init.method !== "GET") writes.push(init.method);
    if (path === `/api/sites/${id}`) return response(init?.method === "PUT" ? { ...site, ...JSON.parse(String(init.body)), config_version: 3 } : site);
    return response(page([]));
  }));
  client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  render(<QueryClientProvider client={client}><MemoryRouter initialEntries={[`/sites/${id}`]}><Routes><Route path="/sites/:siteId" element={<SiteEditorPage />} /></Routes></MemoryRouter></QueryClientProvider>);
  return writes;
}

it("blocks a dirty site form without saving or publishing it on the user's behalf", async () => {
  const writes = showSite();
  const name = await screen.findByRole("textbox", { name: "站点名称" });
  await preparePendingNavigation();
  fireEvent.change(name, { target: { value: "未保存的站点" } });
  await expect(preparePendingNavigation()).rejects.toThrow("请先保存站点设置");
  expect(writes).toEqual([]);
  expect(name).toHaveValue("未保存的站点");
});

it("allows selection after an explicit settings save without publishing", async () => {
  const writes = showSite();
  const name = await screen.findByRole("textbox", { name: "站点名称" });
  fireEvent.change(name, { target: { value: "已明确保存" } });
  fireEvent.submit(name.closest("form")!);
  await waitFor(() => expect(screen.getByText("设置已与服务器同步")).toBeInTheDocument());
  await waitFor(() => expect(screen.getByRole("button", { name: "保存设置" })).toBeEnabled());
  await preparePendingNavigation();
  expect(writes).toEqual(["PUT"]);
});

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { createMemoryRouter, RouterProvider } from "react-router-dom";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { SiteEditorPage } from "./SiteEditorPage";
import { authStore } from "../../shared/auth/auth-store";
import { preparePendingNavigation } from "../../shared/navigation/pending-navigation";
import { page, response, session } from "../collaboration/collaboration.test-utils";
import { BrowserRequest } from "../../../tests/sites/browser-request";

vi.mock("../workspace/WorkspaceShell", () => ({ WorkspaceShell: ({ children }: { children: React.ReactNode }) => <main>{children}</main> }));
const id = "018ff7c4-a5b6-7000-8000-000000000001";
const site = {workspace_id:session.workspace.id,version:2,source:{kind:"manual",collections:[],excluded_document_ids:[],page_overrides:[]},branding:{logo:null,links:[],footer_links:[],cta:null,theme:"system"},id, name: "产品手册", slug: "guide", description: "产品知识", site_kind: "handbook", accent_color: "#0f766e", navigation: [], published_release_id: null, published_slug: null, created_at_ms: 1, updated_at_ms: 2 };
let client: QueryClient;
beforeEach(() => { vi.stubGlobal("Request", BrowserRequest); });
afterEach(() => { cleanup(); client?.clear(); vi.unstubAllGlobals(); act(() => authStore.getState().clearSession()); });
function showSite() {
  act(() => authStore.setState(session));
  const writes: string[] = [];
  vi.stubGlobal("fetch", vi.fn(async (path: string, init?: RequestInit) => {
    if (init?.method && init.method !== "GET") writes.push(init.method);
    if (path === `/api/v1/workspaces/${session.workspace.id}/sites/${id}`) return response(init?.method === "PUT" ? { ...site, ...JSON.parse(String(init.body)), version:3 } : site);
    return response(page([]));
  }));
  client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  render(<QueryClientProvider client={client}><RouterProvider router={createMemoryRouter([{ path: "/sites/:siteId", element: <SiteEditorPage /> }, { path: "/sites", element: <h1>全部站点列表</h1> }], { initialEntries: [`/sites/${id}`] })} /></QueryClientProvider>);
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


it("keeps unsaved settings when an ordinary site link is followed, until explicitly discarded", async () => {
  const writes = showSite();
  const name = await screen.findByRole("textbox", { name: "站点名称" });
  fireEvent.change(name, { target: { value: "未保存的设置" } });
  fireEvent.click(screen.getByRole("link", { name: "所有站点" }));
  expect(await screen.findByRole("dialog", { name: "站点设置尚未保存" })).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "继续编辑" }));
  expect(name).toHaveValue("未保存的设置");
  expect(writes).toEqual([]);
  fireEvent.click(screen.getByRole("link", { name: "所有站点" }));
  fireEvent.click(await screen.findByRole("button", { name: "放弃修改并离开" }));
  expect(await screen.findByRole("heading", { name: "全部站点列表" })).toBeInTheDocument();
  expect(writes).toEqual([]);
});

it("saves settings only after choosing save-and-leave and never publishes them", async () => {
  const writes = showSite();
  fireEvent.change(await screen.findByRole("textbox", { name: "站点名称" }), { target: { value: "离开前保存" } });
  fireEvent.click(screen.getByRole("link", { name: "所有站点" }));
  fireEvent.click(await screen.findByRole("button", { name: "保存并离开" }));
  expect(await screen.findByRole("heading", { name: "全部站点列表" })).toBeInTheDocument();
  expect(writes).toEqual(["PUT"]);
});

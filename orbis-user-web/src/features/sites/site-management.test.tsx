import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { authStore } from "../../shared/auth/auth-store";
import { SiteEditorPage } from "./SiteEditorPage";

const id = "018ff7c4-a5b6-7000-8000-000000000001";
const baseSite = { id, name: "产品手册", slug: "guide", description: "产品知识", site_kind: "handbook", accent_color: "#0f766e", navigation: [], config_version: 2, published_release_id: null, published_slug: null, created_at_ms: 1, updated_at_ms: 2 };
const page = (items: unknown[]) => ({ items, pagination: { page: 1, page_size: 20, total: items.length, total_pages: items.length ? 1 : 0, has_next: false, has_previous: false } });
const response = (data: unknown, status = 200) => new Response(JSON.stringify({ code: "OK", message: "成功", request_id: id, data }), { status, headers: { "Content-Type": "application/json" } });
let requests: Array<{ path: string; method: string; body: Record<string, unknown> }>;

beforeEach(() => {
  requests = [];
  authStore.setState({ accessToken: "test-token", refreshToken: "refresh-token", workspace: { id, name: "测试空间", workspace_type: "private", role: "owner", is_current: true, created_at_ms: 1, updated_at_ms: 1 } });
  vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
    const path = String(url);
    const method = init?.method || "GET";
    const body = init?.body ? JSON.parse(String(init.body)) : {};
    requests.push({ path, method, body });
    if (path.includes("/releases")) return response(page([]));
    if (path === `/api/sites/${id}`) return response(method === "PUT" ? { ...baseSite, ...body, config_version: 3 } : baseSite);
    return response(page([]));
  }));
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); authStore.getState().clearSession(); });

function renderEditor() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(<QueryClientProvider client={client}><MemoryRouter initialEntries={[`/sites/${id}`]}><Routes><Route path="/sites/:siteId" element={<SiteEditorPage />} /><Route path="/sites/:siteId/preview" element={<h1>站点预览</h1>} /></Routes></MemoryRouter></QueryClientProvider>);
}

describe("site editing", () => {
  it("saves newly selected documents with public default paths independent of their IDs", async () => {
    const noteId = "018ff7c4-a5b6-7000-8000-000000000002";
    const currentFetch = globalThis.fetch;
    vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => String(url).startsWith("/api/notes?")
      ? response(page([{ id: noteId, tenant_id: null, workspace_id: id, owner_id: id, status: "active", notebook_id: id, parent_id: null, sort_order: 0, title: "开始使用", note_type: "document", plain_text: "安装与配置", created_at_ms: 1, updated_at_ms: 1 }]))
      : currentFetch(url, init)));
    renderEditor();
    await userEvent.click(await screen.findByRole("button", { name: "开始使用 安装与配置" }));
    expect(screen.getByRole("textbox", { name: "第 1 篇页面路径" })).toHaveValue("page-1");
    await userEvent.click(screen.getByRole("button", { name: "保存设置" }));
    await waitFor(() => expect(requests.find((item) => item.method === "PUT")?.body.navigation).toEqual([
      { note_id: noteId, title: "开始使用", slug: "page-1", group: null },
    ]));
    const navigation = requests.find((item) => item.method === "PUT")?.body.navigation as Array<{ slug: string }>;
    expect(navigation[0].slug).not.toContain(noteId);
  });

  it("leaves existing configured paths unchanged when saving another setting", async () => {
    const navigation = [{ note_id: id, slug: `page-${id}`, title: "Existing page", group: null }];
    const currentFetch = globalThis.fetch;
    vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => String(url) === `/api/sites/${id}` && (init?.method || "GET") === "GET"
      ? response({ ...baseSite, navigation }) : currentFetch(url, init)));
    renderEditor();
    const input = await screen.findByRole("textbox", { name: "站点名称" });
    await userEvent.type(input, "新版");
    await userEvent.click(screen.getByRole("button", { name: "保存设置" }));
    await waitFor(() => expect(requests.find((item) => item.method === "PUT")?.body.navigation).toEqual(navigation));
  });

  it("saves the changed site config with its version without publishing", async () => {
    renderEditor();
    const input = await screen.findByRole("textbox", { name: "站点名称" });
    await userEvent.clear(input);
    await userEvent.type(input, "团队使用手册");
    await userEvent.click(screen.getByRole("button", { name: "保存设置" }));
    await waitFor(() => expect(requests.find((item) => item.method === "PUT")?.body).toMatchObject({ name: "团队使用手册", expected_version: 2 }));
    expect(requests.some((item) => item.path.endsWith("/publish"))).toBe(false);
    expect(await screen.findByText("设置已保存")).toBeInTheDocument();
  });

  it("preserves the form and shows a save conflict rather than overwriting the newer version", async () => {
    const currentFetch = globalThis.fetch;
    vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => init?.method === "PUT"
      ? new Response(JSON.stringify({ code: "SITE_VERSION_CONFLICT", message: "站点设置已被其他人修改，请重新加载后重试", request_id: id, data: null }), { status: 409, headers: { "Content-Type": "application/json" } })
      : currentFetch(url, init)));
    renderEditor();
    const input = await screen.findByRole("textbox", { name: "站点名称" });
    await userEvent.clear(input);
    await userEvent.type(input, "我的修改");
    await userEvent.click(screen.getByRole("button", { name: "保存设置" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("站点设置已被其他人修改");
    expect(input).toHaveValue("我的修改");
  });

  it("lets ordinary members read settings while mutation controls stay unavailable", async () => {
    authStore.setState((state) => ({ workspace: state.workspace ? { ...state.workspace, role: "normal" } : null }));
    renderEditor();
    expect(await screen.findByRole("textbox", { name: "站点名称" })).toBeDisabled();
    expect(screen.queryByRole("button", { name: "发布站点" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "保存设置" })).not.toBeInTheDocument();
  });
});

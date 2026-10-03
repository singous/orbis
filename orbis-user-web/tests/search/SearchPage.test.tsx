import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { authStore } from "../../src/shared/auth/auth-store";
import { SearchPage } from "../../src/features/search/SearchPage";
import { LegacyDocumentSearchRedirect } from "../../src/features/search/LegacyDocumentSearchRedirect";

const workspaceId = "018ff7c4-a5b6-7000-8000-000000000002";
const noteId = "018ff7c4-a5b6-7000-8000-000000000003";
const workspace = { id: workspaceId, name: "当前空间", workspace_type: "private", role: "owner" as const, is_current: true, created_at_ms: 1, updated_at_ms: 1 };
const user = { id: "018ff7c4-a5b6-7000-8000-000000000001", email: "owner@orbis.test", display_name: "Owner", tenant_id: null, current_workspace_id: workspaceId, status: "active", created_at_ms: 1, updated_at_ms: 1 };
const result = { id: noteId, type: "document", workspace_id: workspaceId, workspace_name: "当前空间", title: "设计规范", location: "设计笔记本", snippet: "统一导航和字体", match: "body", matched_comment_id: null, status: "active", updated_at_ms: 1, notebook_id: null, group_id: null };
function data(items: unknown[] = [], page = 1, total = items.length) {
  return { items, pagination: { page, page_size: 20, total, total_pages: Math.ceil(total / 20), has_next: page * 20 < total, has_previous: page > 1 }, scope: { workspace_ids: [workspaceId], current_workspace_id: workspaceId }, workspaces: [{ id: workspaceId, name: "当前空间", is_current: true }] };
}
function response(payload: unknown, status = 200) { return new Response(JSON.stringify({ code: status === 200 ? "OK" : "FORBIDDEN", message: status === 200 ? "成功" : "无权访问该工作空间", request_id: "search-test", data: payload }), { status, headers: { "Content-Type": "application/json" } }); }
function CurrentPath() { const location = useLocation(); return <output aria-label="当前地址">{location.pathname}{location.search}</output>; }
function renderSearch(entry = "/search") {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  const rendered = render(<QueryClientProvider client={client}><MemoryRouter initialEntries={[entry]}><Routes><Route path="/search" element={<SearchPage />} /><Route path="/documents/search" element={<LegacyDocumentSearchRedirect />} /></Routes><CurrentPath /></MemoryRouter></QueryClientProvider>);
  return { ...rendered, client };
}
beforeEach(() => { act(() => authStore.setState({ accessToken: "search-token", refreshToken: "refresh", user, workspace })); });
afterEach(() => { cleanup(); act(() => authStore.getState().clearSession()); vi.unstubAllGlobals(); });

describe("global search", () => {
  it("makes no blank search request and debounces Chinese composition", async () => {
    const requests: URL[] = [];
    vi.stubGlobal("fetch", vi.fn(async (input: string, options: RequestInit) => {
      const url = new URL(input, "http://orbis.test"); requests.push(url);
      expect(new Headers(options.headers).get("Authorization")).toBe("Bearer search-token");
      return response(data(url.searchParams.get("q") ? [result] : []));
    }));
    renderSearch();
    await screen.findByText("输入关键词，查找文档、评论或文件。");
    const input = screen.getByRole("searchbox", { name: "搜索内容" });
    fireEvent.compositionStart(input);
    fireEvent.change(input, { target: { value: "设" } });
    await act(() => new Promise(resolve => setTimeout(resolve, 300)));
    expect(requests.filter(url => url.searchParams.get("q"))).toHaveLength(0);
    fireEvent.change(input, { target: { value: "设计" } });
    fireEvent.compositionEnd(input, { data: "设计" });
    expect(await screen.findByRole("link", { name: /设计规范/ })).toHaveAttribute("href", `/documents/${noteId}`);
    expect(requests.filter(url => url.searchParams.get("q")).map(url => url.searchParams.get("q"))).toEqual(["设计"]);
  });

  it("uses server totals and pagination while preserving type and status", async () => {
    const requests: URL[] = [];
    vi.stubGlobal("fetch", vi.fn(async (input: string) => {
      const url = new URL(input, "http://orbis.test"); requests.push(url);
      return response(data(url.searchParams.get("q") ? [result] : [], Number(url.searchParams.get("page")), url.searchParams.get("q") ? 21 : 0));
    }));
    renderSearch("/search?q=设计&type=document&status=all");
    expect(await screen.findByText("找到 21 条结果")).toBeVisible();
    await userEvent.click(screen.getByRole("button", { name: "下一页" }));
    expect(await screen.findByText("第 2 / 2 页")).toBeVisible();
    const secondPage = requests.find(url => url.searchParams.get("page") === "2");
    expect(secondPage?.searchParams.get("type")).toBe("document");
    expect(secondPage?.searchParams.get("status")).toBe("all");
  });

  it("ignores legacy scope URLs and sends only the application workspace header", async () => {
    const requests: URL[] = [];
    vi.stubGlobal("fetch", vi.fn(async (input: string, options: RequestInit) => {
      const url = new URL(input, "http://orbis.test"); requests.push(url);
      expect(options.method).toBe("GET");
      expect(new Headers(options.headers).get("X-Workspace-ID")).toBe(workspaceId);
      return response(data([result]));
    }));
    renderSearch("/search?q=设计&scope=all&workspace_id=018ff7c4-a5b6-7000-8000-000000000009");
    await screen.findByRole("link", { name: /设计规范/ });
    expect(screen.queryByRole("button", { name: /搜索范围/ })).not.toBeInTheDocument();
    expect(screen.queryByText("当前空间")).not.toBeInTheDocument();
    expect(requests.every(url => !url.searchParams.has("scope") && !url.searchParams.has("workspace_id"))).toBe(true);
    expect(authStore.getState().workspace?.id).toBe(workspaceId);
  });

  it("cancels superseded requests and never displays their stale result", async () => {
    let oldSignal: AbortSignal | null | undefined;
    vi.stubGlobal("fetch", vi.fn((input: string, options: RequestInit) => {
      const url = new URL(input, "http://orbis.test");
      if (url.searchParams.get("q") === "old") {
        oldSignal = options.signal;
        return new Promise<Response>((_resolve, reject) => options.signal?.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError"))));
      }
      return Promise.resolve(response(data(url.searchParams.get("q") ? [result] : [])));
    }));
    renderSearch("/search?q=old");
    await waitFor(() => expect(oldSignal).toBeDefined());
    fireEvent.change(screen.getByRole("searchbox", { name: "搜索内容" }), { target: { value: "new" } });
    await waitFor(() => expect(oldSignal?.aborted).toBe(true));
    expect(await screen.findByRole("link", { name: /设计规范/ })).toBeVisible();
    expect(screen.queryByText("搜索失败")).not.toBeInTheDocument();
  });

  it("preserves legacy query/filter bookmarks and distinguishes permission failures from no matches", async () => {
    vi.stubGlobal("fetch", vi.fn(async (input: string) => new URL(input, "http://orbis.test").searchParams.get("q") ? response(null, 403) : response(data())));
    renderSearch("/documents/search?q=设计&status=archived");
    expect(await screen.findByText("无权搜索内容")).toBeVisible();
    expect(screen.getByRole("status", { name: "当前地址" })).toHaveTextContent("/search?q=%E8%AE%BE%E8%AE%A1&status=archived&type=document");
    expect(screen.queryByText(/没有匹配的内容/)).not.toBeInTheDocument();
  });
  it("clears the query while preserving its content type and avoiding an empty request", async () => {
    const requests: URL[] = [];
    vi.stubGlobal("fetch", vi.fn(async (input: string) => {
      const url = new URL(input, "http://orbis.test"); requests.push(url);
      return response(data(url.searchParams.get("q") ? [result] : []));
    }));
    renderSearch("/search?q=设计&type=document&scope=all");
    await screen.findByRole("link", { name: /设计规范/ });
    await userEvent.click(screen.getByRole("button", { name: "清空搜索" }));
    expect(screen.getByRole("searchbox", { name: "搜索内容" })).toHaveValue("");
    expect(screen.getByRole("status", { name: "当前地址" })).toHaveTextContent("/search?type=document");
    expect(screen.getByText("输入关键词，查找文档、评论或文件。")).toBeVisible();
    expect(requests.filter(url => url.searchParams.get("q") === "")).toHaveLength(0);
  });
});

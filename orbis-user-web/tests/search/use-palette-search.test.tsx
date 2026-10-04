import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { authStore, getAuthSessionKey } from "../../src/shared/auth/auth-store";
import type { SearchFilters } from "../../src/features/search/api";
import { usePaletteSearch } from "../../src/features/search/use-palette-search";

const WORKSPACE_ID = "018ff7c4-a5b6-7000-8000-000000000001";
const OTHER_WORKSPACE_ID = "018ff7c4-a5b6-7000-8000-000000000002";
const RESOURCE_ID = "018ff7c4-a5b6-7000-8000-000000000003";
const user = { id: RESOURCE_ID, tenant_id: null, email: "owner@orbis.test", display_name: "Owner", current_workspace_id: WORKSPACE_ID, status: "active", created_at_ms: 1, updated_at_ms: 1 };
const workspace = { id: WORKSPACE_ID, name: "当前空间", workspace_type: "team", role: "owner" as const, is_current: true, created_at_ms: 1, updated_at_ms: 1 };
const filters: SearchFilters = { q: "", type: "all", status: "active", page: 1 };
type Props = { filters: SearchFilters; enabled: boolean; composing: boolean };
const clients = new Set<QueryClient>();

function response(title = "", workspaceId = WORKSPACE_ID) {
  return new Response(JSON.stringify({ code: "OK", message: "成功", request_id: "palette-test", data: {
    items: title ? [{ id: RESOURCE_ID, type: "document", workspace_id: workspaceId, workspace_name: "搜索空间", title, location: "笔记本", snippet: title, match: "title", matched_comment_id: null, status: "active", updated_at_ms: 1, notebook_id: null, group_id: null }] : [],
    pagination: { page: 1, page_size: 20, total: title ? 1 : 0, total_pages: title ? 1 : 0, has_next: false, has_previous: false },
    scope: { workspace_ids: [workspaceId], current_workspace_id: workspaceId }, workspaces: [{ id: workspaceId, name: "搜索空间", is_current: true }],
  } }), { headers: { "Content-Type": "application/json" } });
}
function mount(props: Partial<Props> = {}) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  clients.add(client);
  return { client, ...renderHook((next: Props) => usePaletteSearch(next.filters, next), {
    initialProps: { filters, enabled: true, composing: false, ...props },
    wrapper: ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>,
  }) };
}
beforeEach(() => { act(() => authStore.setState({ accessToken: "palette-token", refreshToken: "refresh", user, workspace })); });
afterEach(() => {
  cleanup();
  for (const client of clients) client.clear();
  clients.clear();
  act(() => authStore.getState().clearSession());
  vi.unstubAllGlobals();
});

describe("palette search requests", () => {
  it("makes no requests while closed or unauthenticated", async () => {
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    const view = mount({ filters: { ...filters, q: "设计" }, enabled: false });
    await act(() => new Promise(resolve => setTimeout(resolve, 300)));
    expect(fetch).not.toHaveBeenCalled();
    act(() => authStore.getState().clearSession());
    view.rerender({ filters: { ...filters, q: "设计" }, enabled: true, composing: false });
    expect(view.result.current.searchedFilters).toBeNull();
    expect(fetch).not.toHaveBeenCalled();
  });

  it("makes no empty-state request and defers IME text until composition ends", async () => {
    const requests: URL[] = [];
    vi.stubGlobal("fetch", vi.fn(async (input: string, options: RequestInit) => {
      const url = new URL(input, "http://orbis.test"); requests.push(url);
      expect(new Headers(options.headers).get("Authorization")).toBe("Bearer palette-token");
      expect(options.signal).toBeInstanceOf(AbortSignal);
      return response(url.searchParams.get("q") ?? "");
    }));
    const view = mount();
    expect(requests).toHaveLength(0);
    expect(view.result.current.results.data).toBeUndefined();
    view.rerender({ filters: { ...filters, q: "设" }, enabled: true, composing: true });
    await act(() => new Promise(resolve => setTimeout(resolve, 300)));
    expect(requests).toHaveLength(0);
    expect(view.result.current.pendingInput).toBe(true);
    view.rerender({ filters: { ...filters, q: "设计规范" }, enabled: true, composing: false });
    expect(view.result.current.searchedFilters).toBeNull();
    await waitFor(() => expect(view.result.current.results.data?.items[0].title).toBe("设计规范"));
    expect(requests.filter(url => url.searchParams.get("q")).map(url => url.searchParams.get("q"))).toEqual(["设计规范"]);
    expect(view.result.current.searchedFilters).toEqual({ ...filters, q: "设计规范" });
  });

  it("cancels superseded palette input without cancelling a background document lookup", async () => {
    let oldSignal: AbortSignal | null | undefined;
    let finishOld!: (response: Response) => void;
    vi.stubGlobal("fetch", vi.fn((input: string, options: RequestInit) => {
      const q = new URL(input, "http://orbis.test").searchParams.get("q") ?? "";
      if (q === "old") {
        oldSignal = options.signal;
        return new Promise<Response>(resolve => { finishOld = resolve; });
      }
      return Promise.resolve(response(q));
    }));
    const view = mount({ filters: { ...filters, q: "old" } });
    const sessionKey = getAuthSessionKey(authStore.getState());
    let backgroundSignal!: AbortSignal;
    void view.client.fetchQuery({ queryKey: ["global-search", sessionKey, "resource", "document", RESOURCE_ID], queryFn: ({ signal }) => {
      backgroundSignal = signal;
      return new Promise(() => {});
    } }).catch(() => undefined);
    await waitFor(() => expect(oldSignal).toBeDefined());
    view.rerender({ filters: { ...filters, q: "new" }, enabled: true, composing: false });
    await waitFor(() => expect(oldSignal?.aborted).toBe(true));
    expect(view.result.current.results.data).toBeUndefined();
    expect(backgroundSignal.aborted).toBe(false);
    await waitFor(() => expect(view.result.current.results.data?.items[0].title).toBe("new"));
    await act(async () => { finishOld(response("stale old result")); });
    expect(view.result.current.results.data?.items[0].title).toBe("new");
    expect(backgroundSignal.aborted).toBe(false);
  });

  it("refines type, status and page without introducing a separate workspace scope", async () => {
    const requests: URL[] = [];
    let staleSignal: AbortSignal | null | undefined;
    let finishStale!: (response: Response) => void;
    vi.stubGlobal("fetch", vi.fn((input: string, options: RequestInit) => {
      const url = new URL(input, "http://orbis.test"); requests.push(url);
      expect(url.searchParams.has("scope")).toBe(false);
      expect(url.searchParams.has("workspace_id")).toBe(false);
      if (url.searchParams.get("type") === "file") {
        staleSignal = options.signal;
        return new Promise<Response>(resolve => { finishStale = resolve; });
      }
      return Promise.resolve(response("文档结果"));
    }));
    const view = mount({ filters: { ...filters, q: "设计" } });
    await waitFor(() => expect(view.result.current.results.isSuccess).toBe(true));
    const narrowed: SearchFilters = { q: "设计", type: "file", status: "archived", page: 2 };
    view.rerender({ filters: narrowed, enabled: true, composing: false });
    expect(view.result.current.pendingInput).toBe(false);
    expect(view.result.current.results.data).toBeUndefined();
    const request = requests.find(url => url.searchParams.get("type") === "file");
    expect(request?.searchParams.get("status")).toBe("archived");
    expect(request?.searchParams.get("page")).toBe("2");
    view.rerender({ filters: { ...filters, q: "设计", type: "document" }, enabled: true, composing: false });
    await waitFor(() => expect(view.result.current.results.data?.items[0].title).toBe("文档结果"));
    expect(staleSignal?.aborted).toBe(true);
    await act(async () => { finishStale(response("过期文件结果")); });
    expect(view.result.current.results.data?.items[0].title).toBe("文档结果");
  });

  it("cancels results when composition resumes or the palette closes", async () => {
    const signals = new Map<string, AbortSignal>();
    vi.stubGlobal("fetch", vi.fn((input: string, options: RequestInit) => {
      signals.set(new URL(input, "http://orbis.test").searchParams.get("q") ?? "", options.signal as AbortSignal);
      return new Promise<Response>(() => {});
    }));
    const currentFilters = { ...filters, q: "设计" };
    const view = mount({ filters: currentFilters });
    await waitFor(() => expect(signals.size).toBe(1));
    view.rerender({ filters: currentFilters, enabled: true, composing: true });
    await waitFor(() => expect(signals.get("设计")?.aborted).toBe(true));
    view.rerender({ filters: currentFilters, enabled: false, composing: true });
    expect(signals.has("")).toBe(false);
    expect(view.result.current.searchedFilters).toBeNull();
  });

  it("uses a new session cache and credentials when the active workspace changes", async () => {
    let oldSignal: AbortSignal | null | undefined;
    let finishOld!: (response: Response) => void;
    vi.stubGlobal("fetch", vi.fn((input: string, options: RequestInit) => {
      const q = new URL(input, "http://orbis.test").searchParams.get("q") ?? "";
      const changed = new Headers(options.headers).get("X-Workspace-ID") === OTHER_WORKSPACE_ID;
      if (q && !changed) {
        oldSignal = options.signal;
        return new Promise<Response>(resolve => { finishOld = resolve; });
      }
      return Promise.resolve(response(q ? "新会话结果" : "", changed ? OTHER_WORKSPACE_ID : WORKSPACE_ID));
    }));
    const view = mount({ filters: { ...filters, q: "设计" } });
    await waitFor(() => expect(oldSignal).toBeDefined());
    act(() => authStore.getState().setSession({ accessToken: "palette-token", refreshToken: "refresh", user: { ...user, current_workspace_id: OTHER_WORKSPACE_ID }, workspace: { ...workspace, id: OTHER_WORKSPACE_ID } }));
    expect(view.result.current.results.data).toBeUndefined();
    await waitFor(() => expect(view.result.current.results.data?.items[0].title).toBe("新会话结果"));
    expect(view.result.current.results.data?.items[0].workspace_id).toBe(OTHER_WORKSPACE_ID);
    expect(oldSignal?.aborted).toBe(true);
    await act(async () => { finishOld(response("旧会话结果")); });
    expect(view.result.current.results.data?.items[0].title).toBe("新会话结果");
  });
});

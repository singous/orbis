import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { Link, MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { StrictMode } from "react";
import { AppProviders } from "../../src/app/providers";
import { authStore } from "../../src/shared/auth/auth-store";
import { SearchOpenPage } from "../../src/features/search/SearchOpenPage";

const current = "018ff7c4-a5b6-7000-8000-000000000001";
const other = "018ff7c4-a5b6-7000-8000-000000000002";
const resource = "018ff7c4-a5b6-7000-8000-000000000003";
const user = { id: resource, email: "owner@orbis.test", display_name: "Owner", tenant_id: null, current_workspace_id: current, status: "active", created_at_ms: 1, updated_at_ms: 1 };
const workspace = { id: current, name: "当前空间", workspace_type: "team", role: "owner" as const, is_current: true, created_at_ms: 1, updated_at_ms: 1 };
function envelope(data: unknown, status = 200) {
  return new Response(JSON.stringify({ code: status === 200 ? "OK" : "FORBIDDEN", message: status === 200 ? "成功" : "内容访问权限已失效", request_id: "resource", data }), { status, headers: { "Content-Type": "application/json" } });
}
function result(type = "site", id = resource) {
  return envelope({ items: [{ id, type, workspace_id: current, workspace_name: workspace.name, title: "报告.txt", location: "笔记本", snippet: "", match: "title", matched_comment_id: null, status: "active", updated_at_ms: 1, notebook_id: null, group_id: null }], pagination: { page: 1, page_size: 20, total: 1, total_pages: 1, has_next: false, has_previous: false } });
}
function CurrentPath() { const location = useLocation(); return <output aria-label="当前地址">{location.pathname}</output>; }
function renderOpen({ strict = false, type = "site", workspaceId }: { strict?: boolean; type?: string; workspaceId?: string } = {}) {
  act(() => authStore.getState().setSession({ accessToken: "token", refreshToken: "refresh", user, workspace }));
  const context = workspaceId ? `&workspace_id=${workspaceId}` : "";
  const content = <AppProviders><MemoryRouter initialEntries={[`/search/open?type=${type}&id=${resource}${context}`]}><Link to="/elsewhere">离开</Link><Link to={`/search/open?type=site&id=${other}`}>另一个结果</Link><Routes><Route path="/search/open" element={<SearchOpenPage />} /><Route path="/sites/:id" element={<p>目标站点</p>} /><Route path="/elsewhere" element={<p>其他页面</p>} /></Routes><CurrentPath /></MemoryRouter></AppProviders>;
  return render(strict ? <StrictMode>{content}</StrictMode> : content);
}
afterEach(() => { cleanup(); act(() => authStore.getState().clearSession()); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe("opening search resources within the application workspace", () => {
  it("does not switch spaces when opening a legacy link that names another workspace", async () => {
    const fetch = vi.fn(); vi.stubGlobal("fetch", fetch);
    renderOpen({ workspaceId: other });
    expect(await screen.findByText("该内容不在当前工作空间，请通过空间菜单切换后再打开。")).toBeVisible();
    expect(fetch).not.toHaveBeenCalled();
    expect(authStore.getState().workspace?.id).toBe(current);
    expect(screen.queryByText("目标站点")).not.toBeInTheDocument();
  });

  it.each([undefined, current])("authorizes the result using the current header with legacy context %s", async workspaceId => {
    const fetch = vi.fn(async (input: string, options: RequestInit) => {
      const url = new URL(input, "http://orbis.test");
      expect(url.pathname).toBe("/api/search");
      expect(url.searchParams.get("resource_id")).toBe(resource);
      expect(url.searchParams.has("workspace_id")).toBe(false);
      expect(options.method).toBe("GET");
      expect(new Headers(options.headers).get("X-Workspace-ID")).toBe(current);
      return result();
    }); vi.stubGlobal("fetch", fetch);
    renderOpen({ workspaceId });
    expect(await screen.findByText("目标站点")).toBeVisible();
    expect(authStore.getState().workspace?.id).toBe(current);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("stays on the lookup page after authorization fails", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => envelope(null, 403)));
    renderOpen();
    expect(await screen.findByText("内容访问权限已失效")).toBeVisible();
    expect(authStore.getState().workspace?.id).toBe(current);
    expect(screen.queryByText("目标站点")).not.toBeInTheDocument();
  });

  it("retries a lookup cancelled by StrictMode without issuing any switch", async () => {
    const signals: Array<AbortSignal | null | undefined> = [];
    vi.stubGlobal("fetch", vi.fn(async (_input: string, options: RequestInit) => { signals.push(options.signal); expect(options.method).toBe("GET"); return result(); }));
    renderOpen({ strict: true });
    expect(await screen.findByText("目标站点")).toBeVisible();
    expect(signals[0]?.aborted).toBe(true);
    expect(authStore.getState().workspace?.id).toBe(current);
  });

  it("retains the workspace header during an authenticated download and token retry", async () => {
    const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => undefined);
    vi.stubGlobal("URL", class extends URL { static createObjectURL() { return "blob:download"; } static revokeObjectURL() {} });
    vi.stubGlobal("fetch", vi.fn(async (input: string, options: RequestInit) => {
      if (input.endsWith("/auth/refresh")) return envelope({ access_token: "renewed-token" });
      expect(new Headers(options.headers).get("X-Workspace-ID")).toBe(current);
      if (input.startsWith("/api/search?")) return result("file");
      expect(input).toBe(`/api/files/${resource}/content`);
      if (new Headers(options.headers).get("Authorization") !== "Bearer renewed-token") return envelope(null, 401);
      expect(options.signal?.aborted).toBe(false);
      return new Response(new Blob(["content"], { type: "text/plain" }));
    }));
    renderOpen({ type: "file" });
    await userEvent.click(await screen.findByRole("button", { name: "下载文件" }));
    expect(await screen.findByText("已开始下载。")).toBeVisible();
    expect(authStore.getState().accessToken).toBe("renewed-token");
    expect(click).toHaveBeenCalledTimes(1);
  });

  it.each(["离开", "另一个结果"])("ignores a late resource lookup after opening %s", async link => {
    let complete!: (response: Response) => void;
    let signal: AbortSignal | null | undefined;
    vi.stubGlobal("fetch", vi.fn((input: string, options: RequestInit) => {
      if (new URL(input, "http://orbis.test").searchParams.get("resource_id") === other) return Promise.resolve(result("site", other));
      signal = options.signal;
      return new Promise<Response>(resolve => { complete = resolve; });
    }));
    renderOpen();
    await waitFor(() => expect(signal).toBeDefined());
    await userEvent.click(screen.getByRole("link", { name: link }));
    expect(signal?.aborted).toBe(true);
    await act(async () => { complete(result()); });
    expect(authStore.getState().workspace?.id).toBe(current);
    await waitFor(() => expect(screen.getByRole("status", { name: "当前地址" })).toHaveTextContent(link === "离开" ? "/elsewhere" : `/sites/${other}`));
  });
});

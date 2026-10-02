import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { Link, MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { StrictMode } from "react";
import { AppProviders } from "../../src/app/providers";
import { authStore } from "../../src/shared/auth/auth-store";
import { SearchOpenPage } from "../../src/features/search/SearchOpenPage";

const current = "018ff7c4-a5b6-7000-8000-000000000001";
const destination = "018ff7c4-a5b6-7000-8000-000000000002";
const resource = "018ff7c4-a5b6-7000-8000-000000000003";
const user = { id: resource, email: "owner@orbis.test", display_name: "Owner", tenant_id: null, current_workspace_id: current, status: "active", created_at_ms: 1, updated_at_ms: 1 };
const workspace = { id: current, name: "原空间", workspace_type: "team", role: "owner" as const, is_current: true, created_at_ms: 1, updated_at_ms: 1 };
function CurrentPath() { const location = useLocation(); return <output aria-label="当前地址">{location.pathname}</output>; }
function renderOpen(strict = false, type = "site") {
  act(() => authStore.getState().setSession({ accessToken: "token", refreshToken: "refresh", user, workspace }));
  const content = <AppProviders><MemoryRouter initialEntries={[`/search/open?type=${type}&id=${resource}&workspace_id=${destination}`]}><Link to="/elsewhere">离开</Link><Link to={`/search/open?type=site&id=${destination}&workspace_id=${current}`}>另一个结果</Link><Routes><Route path="/search/open" element={<SearchOpenPage />} /><Route path="/sites/:id" element={<p>目标站点</p>} /><Route path="/elsewhere" element={<p>其他页面</p>} /></Routes><CurrentPath /></MemoryRouter></AppProviders>;
  return render(strict ? <StrictMode>{content}</StrictMode> : content);
}
afterEach(() => { cleanup(); act(() => authStore.getState().clearSession()); vi.unstubAllGlobals(); vi.restoreAllMocks(); });
describe("opening another workspace's search result", () => {
  it("checks the server, replaces the auth workspace and then navigates through a session remount", async () => {
    const fetch = vi.fn(async (input: string, options: RequestInit) => {
      expect(input).toBe("/api/workspace/switch");
      expect(options.method).toBe("POST");
      expect(JSON.parse(options.body as string)).toEqual({ workspace_id: destination });
      return new Response(JSON.stringify({ code: "OK", message: "成功", request_id: "switch", data: { user: { ...user, current_workspace_id: destination }, workspace: { ...workspace, id: destination, name: "目标空间" } } }), { headers: { "Content-Type": "application/json" } });
    });
    vi.stubGlobal("fetch", fetch);
    renderOpen();
    expect(await screen.findByText("目标站点")).toBeVisible();
    expect(authStore.getState().workspace?.id).toBe(destination);
    expect(screen.getByRole("status", { name: "当前地址" })).toHaveTextContent(`/sites/${resource}`);
    expect(fetch).toHaveBeenCalledTimes(1);
  });
  it("keeps the current workspace and stays on the result when membership was revoked", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ code: "FORBIDDEN", message: "工作空间访问权限已失效", request_id: "switch", data: null }), { status: 403, headers: { "Content-Type": "application/json" } })));
    renderOpen();
    await waitFor(() => expect(screen.getByText("工作空间访问权限已失效")).toBeVisible());
    expect(authStore.getState().workspace?.id).toBe(current);
    expect(screen.queryByText("目标站点")).not.toBeInTheDocument();
  });
  it("retries an effect cancelled by StrictMode and still opens the authorized result", async () => {
    const signals: Array<AbortSignal | null | undefined> = [];
    vi.stubGlobal("fetch", vi.fn(async (_input: string, options: RequestInit) => {
      signals.push(options.signal);
      return new Response(JSON.stringify({ code: "OK", message: "成功", request_id: "strict-switch", data: { user: { ...user, current_workspace_id: destination }, workspace: { ...workspace, id: destination } } }), { headers: { "Content-Type": "application/json" } });
    }));
    renderOpen(true);
    expect(await screen.findByText("目标站点")).toBeVisible();
    expect(signals[0]?.aborted).toBe(true);
    expect(authStore.getState().workspace?.id).toBe(destination);
  });
  it("keeps an authenticated file download alive while its access token refreshes", async () => {
    const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => undefined);
    vi.stubGlobal("URL", class extends URL { static createObjectURL() { return "blob:download"; } static revokeObjectURL() {} });
    const envelope = (data: unknown, status = 200) => new Response(JSON.stringify({ code: "OK", message: "成功", request_id: "file-refresh", data }), { status, headers: { "Content-Type": "application/json" } });
    vi.stubGlobal("fetch", vi.fn(async (input: string, options: RequestInit) => {
      if (input.endsWith("/workspace/switch")) return envelope({ user: { ...user, current_workspace_id: destination }, workspace: { ...workspace, id: destination } });
      if (input.endsWith("/auth/refresh")) return envelope({ access_token: "renewed-token" });
      if (new Headers(options.headers).get("Authorization") !== "Bearer renewed-token") return envelope(null, 401);
      expect(options.signal?.aborted).toBe(false);
      return new Response(new Blob(["content"], { type: "text/plain" }));
    }));
    renderOpen(false, "file");
    await userEvent.click(await screen.findByRole("button", { name: "下载文件" }));
    expect(await screen.findByText("已开始下载。")).toBeVisible();
    expect(authStore.getState().accessToken).toBe("renewed-token");
    expect(click).toHaveBeenCalledTimes(1);
  });
  it.each(["离开", "另一个结果"])("ignores a delayed workspace switch after opening %s", async (link) => {
    let complete!: (response: Response) => void;
    let signal: AbortSignal | null | undefined;
    vi.stubGlobal("fetch", vi.fn((_input: string, options: RequestInit) => {
      signal = options.signal;
      return new Promise<Response>(resolve => { complete = resolve; });
    }));
    renderOpen();
    await waitFor(() => expect(signal).toBeDefined());
    await userEvent.click(screen.getByRole("link", { name: link }));
    expect(signal?.aborted).toBe(true);
    await act(async () => {
      complete(new Response(JSON.stringify({ code: "OK", message: "成功", request_id: "late-switch", data: { user: { ...user, current_workspace_id: destination }, workspace: { ...workspace, id: destination } } }), { headers: { "Content-Type": "application/json" } }));
    });
    expect(authStore.getState().workspace?.id).toBe(current);
    expect(screen.getByRole("status", { name: "当前地址" })).toHaveTextContent(link === "离开" ? "/elsewhere" : `/sites/${destination}`);
  });
});

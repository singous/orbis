import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { apiBlobRequest, apiRequest, type ApiRequestOptions } from "../../src/shared/api/api-client";
import { authStore, getAuthSessionKey } from "../../src/shared/auth/auth-store";
import { authRequestOptions, useAuthRequest } from "../../src/shared/auth/use-auth-request";
import { getProfile } from "../../src/shared/auth/profile-api";
import { getNote } from "../../src/features/documents/api";
import { listMembers } from "../../src/features/members/api";
import { listWorkspaces, switchWorkspace } from "../../src/features/workspace/api";

const WORKSPACE_A = "018ff7c4-a5b6-7000-8000-000000000001";
const WORKSPACE_B = "018ff7c4-a5b6-7000-8000-000000000002";
const USER_ID = "018ff7c4-a5b6-7000-8000-000000000003";
const user = { id: USER_ID, tenant_id: null, email: "owner@orbis.test", display_name: "Owner", current_workspace_id: WORKSPACE_A, status: "active", created_at_ms: 1, updated_at_ms: 1 };
const workspace = { id: WORKSPACE_A, name: "工作空间 A", workspace_type: "team", role: "owner" as const, is_current: true, created_at_ms: 1, updated_at_ms: 1 };
const session = { accessToken: "token-a", refreshToken: "refresh-a", user, workspace };
function response(data: unknown, status = 200) { return new Response(JSON.stringify({ code: status === 200 ? "OK" : "AUTH_REQUIRED", message: "请求结果", request_id: "workspace-context-test", data }), { status, headers: { "Content-Type": "application/json" } }); }
beforeEach(() => { act(() => authStore.getState().setSession(session)); });
afterEach(() => { cleanup(); act(() => authStore.getState().clearSession()); vi.unstubAllGlobals(); });

describe("captured request workspace", () => {
  it("captures the selected workspace independently of subsequent selection or token updates", () => {
    const { result } = renderHook(useAuthRequest);
    const original = result.current;
    expect(original.workspaceId).toBe(WORKSPACE_A);
    act(() => authStore.getState().setSession({ ...session, workspace: { ...workspace, id: WORKSPACE_B }, user: { ...user, current_workspace_id: WORKSPACE_B }, accessToken: "token-b" }));
    expect(result.current.workspaceId).toBe(WORKSPACE_B);
    expect(authRequestOptions(original).workspaceId).toBe(WORKSPACE_A);
    act(() => original.onTokenRefresh("late-token-a"));
    act(() => original.onUnauthorized());
    expect(authStore.getState().accessToken).toBe("token-b");
  });

  it("falls back to the authenticated user's selected workspace for an older session without Workspace data", () => {
    act(() => authStore.setState({ workspace: null }));
    const { result } = renderHook(useAuthRequest);
    expect(result.current.workspaceId).toBe(WORKSPACE_A);
  });

  it.each(["json", "blob", "upload"])("attaches exactly one workspace header to %s requests", async (kind) => {
    const fetch = vi.fn(async (_url: string, init: RequestInit) => {
      const headers = new Headers(init.headers);
      expect(headers.get("X-Workspace-ID")).toBe(WORKSPACE_A);
      expect(headers.get("Authorization")).toBe("Bearer token-a");
      if (kind === "upload") expect(headers.has("Content-Type")).toBe(false);
      return kind === "blob" ? new Response(new Blob(["content"])) : response({ ok: true });
    });
    vi.stubGlobal("fetch", fetch);
    const options = { token: "token-a", workspaceId: WORKSPACE_A, headers: { "x-workspace-id": WORKSPACE_B } };
    if (kind === "blob") await apiBlobRequest("/files/file/content", options);
    else if (kind === "upload") {
      const body = new FormData(); body.append("file", new Blob(["upload"]), "asset.txt");
      await apiRequest("/files", { ...options, method: "POST", body });
    } else await apiRequest("/notes", { ...options, method: "POST", body: { title: "文档" } });
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("uses the original context after refresh even if the options and active session change meanwhile", async () => {
    let finishRefresh!: (response: Response) => void;
    const requests: Array<{ url: string; headers: Headers }> = [];
    vi.stubGlobal("fetch", vi.fn((url: string, init: RequestInit) => {
      requests.push({ url, headers: new Headers(init.headers) });
      if (url.endsWith("/auth/refresh")) return new Promise<Response>(resolve => { finishRefresh = resolve; });
      return Promise.resolve(requests.length === 1 ? response(null, 401) : response({ ok: true }));
    }));
    const { result } = renderHook(useAuthRequest);
    const options: ApiRequestOptions = authRequestOptions(result.current);
    const pending = apiRequest("/notes/current", options);
    await waitFor(() => expect(finishRefresh).toBeDefined());
    options.workspaceId = WORKSPACE_B;
    act(() => authStore.getState().setSession({ ...session, accessToken: "token-b", workspace: { ...workspace, id: WORKSPACE_B }, user: { ...user, current_workspace_id: WORKSPACE_B } }));
    await act(async () => { finishRefresh(response({ access_token: "refreshed-a" })); await pending; });
    expect(requests.map(item => item.headers.get("X-Workspace-ID"))).toEqual([WORKSPACE_A, null, WORKSPACE_A]);
    expect(requests[2].headers.get("Authorization")).toBe("Bearer refreshed-a");
    expect(authStore.getState().accessToken).toBe("token-b");
    expect(authStore.getState().workspace?.id).toBe(WORKSPACE_B);
  });

  it("clears a caller-supplied workspace header when explicit null selects a global operation", async () => {
    vi.stubGlobal("fetch", vi.fn(async (_url: string, init: RequestInit) => {
      expect(new Headers(init.headers).has("X-Workspace-ID")).toBe(false);
      return response({ ok: true });
    }));
    await apiRequest("/workspaces", { token: "token-a", workspaceId: null, headers: { "X-Workspace-ID": WORKSPACE_A } });
  });

  it("keeps document and membership wrappers on the common captured-context path", async () => {
    vi.stubGlobal("fetch", vi.fn(async (url: string, init: RequestInit) => {
      expect(new Headers(init.headers).get("X-Workspace-ID")).toBe(WORKSPACE_A);
      return response(url.includes("/members") ? { items: [], pagination: { page: 1, page_size: 100, total: 0, total_pages: 0, has_next: false, has_previous: false } } : { id: USER_ID, tenant_id: null, workspace_id: WORKSPACE_A, owner_id: USER_ID, notebook_id: WORKSPACE_A, parent_id: null, sort_order: 0, title: "文档", note_type: "document", status: "active", created_at_ms: 1, updated_at_ms: 1 });
    }));
    const { result } = renderHook(useAuthRequest);
    await getNote(USER_ID, result.current);
    await listMembers(result.current);
  });

  it("uses global authentication for workspace discovery, switching and profile reads", async () => {
    vi.stubGlobal("fetch", vi.fn(async (url: string, init: RequestInit) => {
      expect(new Headers(init.headers).has("X-Workspace-ID")).toBe(false);
      expect(new Headers(init.headers).get("Authorization")).toBe("Bearer token-a");
      return response(url.endsWith("/workspaces") ? { items: [workspace] } : url.endsWith("/switch") ? { user, workspace } : user);
    }));
    const { result } = renderHook(useAuthRequest);
    await listWorkspaces(result.current);
    await switchWorkspace(WORKSPACE_A, result.current);
    await getProfile(result.current);
  });

  it("does not import another tab's persisted default through a global profile response", () => {
    const before = getAuthSessionKey(authStore.getState());
    act(() => authStore.getState().updateUser({ ...user, display_name: "新名称", current_workspace_id: WORKSPACE_B, updated_at_ms: 2 }, before));
    expect(getAuthSessionKey(authStore.getState())).toBe(before);
    expect(authStore.getState().user).toMatchObject({ display_name: "新名称", current_workspace_id: WORKSPACE_A });
    expect(JSON.parse(localStorage.getItem("orbis.auth")!).workspace.id).toBe(WORKSPACE_A);
  });
});

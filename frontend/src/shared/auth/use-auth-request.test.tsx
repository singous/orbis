import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useDocumentAuth } from "../../features/documents/queries";
import { apiRequest } from "../api/api-client";
import { authStore, type AuthSession } from "./auth-store";
import { authRequestOptions, useAuthRequest, useOptionalAuthRequest } from "./use-auth-request";

const session: AuthSession = {
  accessToken: "account-a-access", refreshToken: "account-a-refresh",
  user: {bio: null, avatar_asset_id: null, profile_version: 1,  id: "account-a", email: "a@example.com", display_name: "A", preferred_workspace_id: "workspace-a", created_at_ms: 1, updated_at_ms: 1 },
  workspace: { id: "workspace-a", name: "A workspace", role: "owner", created_at_ms: 1, updated_at_ms: 1 },
};
const nextSession: AuthSession = {
  ...session, accessToken: "account-b-access", refreshToken: "account-b-refresh",
  user: { ...session.user, id: "account-b", email: "b@example.com" },
};

beforeEach(() => authStore.getState().setSession(session));
afterEach(() => { cleanup(); authStore.getState().clearSession(); vi.unstubAllGlobals(); });

describe.each([
  ["shared auth", useAuthRequest],
  ["document auth", useDocumentAuth],
] as const)("%s", (_name, useRequest) => {
  it.each([
    ["account", () => authStore.getState().setSession(nextSession)],
    ["same-account relogin", () => authStore.getState().setSession({ ...session, accessToken: "new-login-access", refreshToken: "new-login-refresh" })],
  ] as const)("ignores old token and unauthorized callbacks after %s changes", (_label, switchSession) => {
    const { result } = renderHook(useRequest);
    const previousRequest = result.current;
    act(switchSession);
    const currentSession = authStore.getState();

    act(() => previousRequest.onTokenRefresh("previous-session-refreshed-token", "previous-session-refresh"));
    expect(authStore.getState()).toBe(currentSession);
    act(() => previousRequest.onUnauthorized());
    expect(authStore.getState()).toBe(currentSession);
  });

  it("refreshes and persists the current session without expiring its callbacks", () => {
    const { result } = renderHook(useRequest);
    const request = result.current;
    act(() => request.onTokenRefresh("refreshed-access", "rotated-refresh-token"));
    expect(authStore.getState().accessToken).toBe("refreshed-access");
    expect(JSON.parse(localStorage.getItem("orbis.auth.v2")!)).toMatchObject({ accessToken: "refreshed-access", refreshToken: "rotated-refresh-token" });
    cleanup();
    request.onUnauthorized();
    expect(authStore.getState().user).toBeNull();
    expect(JSON.parse(localStorage.getItem("orbis.auth.v2")!)).toMatchObject({ revoked: true });
  });
});

function response(status: number, data: unknown) {
  return new Response(JSON.stringify({ code: status === 200 ? "OK" : "UNAUTHORIZED", message: "Request result", request_id: "session-test", data }), { status, headers: { "Content-Type": "application/json" } });
}

it("allows guest invitation access and follows login and logout", () => {
  authStore.getState().clearSession();
  const { result } = renderHook(useOptionalAuthRequest);
  expect(result.current).toBeNull();
  act(() => authStore.getState().setSession(session));
  expect(result.current?.accessToken).toBe("account-a-access");
  act(() => authStore.getState().clearSession());
  expect(result.current).toBeNull();
});

it.each([200, 401])("keeps a newer login intact when an old HTTP refresh returns %s", async (refreshStatus) => {
  let finishRefresh!: (value: Response) => void;
  let refreshStarted = false;
  const fetchMock = vi.fn<typeof fetch>().mockResolvedValueOnce(response(401, null)).mockImplementationOnce(() => {
    refreshStarted = true;
    return new Promise<Response>((resolve) => { finishRefresh = resolve; });
  }).mockResolvedValueOnce(response(200, { body: "Account A content" }));
  vi.stubGlobal("fetch", fetchMock);
  const { result } = renderHook(useAuthRequest);
  const pending = apiRequest("/v1/workspaces/workspace-a/documents/private-note", authRequestOptions(result.current)).catch((error: unknown) => error);
  await waitFor(() => expect(refreshStarted).toBe(true));
  act(() => authStore.getState().setSession(nextSession));
  cleanup();
  await act(async () => {
    finishRefresh(response(refreshStatus, refreshStatus === 200 ? { access_token: "account-a-refreshed", refresh_token: "account-a-rotated" } : null));
    await pending;
  });

  expect(authStore.getState()).toMatchObject(nextSession);
  expect(JSON.parse(localStorage.getItem("orbis.auth.v2")!)).toMatchObject(nextSession);
});


it("accepts account token rotation across workspace selection while ignoring the old scope unauthorized callback", () => {
  const { result } = renderHook(useAuthRequest);
  const request = result.current;
  act(() => authStore.getState().setSession({ ...session, workspace: { ...session.workspace!, id: "workspace-b" } }));
  act(() => request.onTokenRefresh("rotated-access", "rotated-refresh"));
  expect(authStore.getState().refreshToken).toBe("rotated-refresh");
  act(() => request.onUnauthorized());
  expect(authStore.getState().workspace?.id).toBe("workspace-b");
});

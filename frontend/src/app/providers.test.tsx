import { MutationObserver, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { StrictMode, useState } from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { authStore, type AuthSession } from "../shared/auth/auth-store";
import { AppProviders } from "./providers";
import { z } from "zod";
import { reportError } from "../shared/api/request-feedback";
const notify = vi.hoisted(() => vi.fn());
vi.mock("../shared/ui/Toast", async original => ({ ...await original<typeof import("../shared/ui/Toast")>(), showToast: notify }));

const session: AuthSession = {
  accessToken: "account-a-access", refreshToken: "account-a-refresh",
  user: {bio: null, avatar_asset_id: null, profile_version: 1,  id: "account-a", email: "a@example.com", display_name: "A", preferred_workspace_id: "workspace-a", created_at_ms: 1, updated_at_ms: 1 },
  workspace: { id: "workspace-a", name: "A workspace", role: "owner", created_at_ms: 1, updated_at_ms: 1 },
};
const privateKey = ["note-content", "private-note"];

beforeEach(() => { notify.mockClear(); authStore.getState().setSession(session); });
afterEach(() => { cleanup(); authStore.getState().clearSession(); });

it.each([
  ["account", () => authStore.setState({ user: { ...session.user, id: "account-b" } })],
  ["workspace", () => authStore.setState({ workspace: { ...session.workspace!, id: "workspace-b" } })],
  ["role", () => authStore.setState({ workspace: { ...session.workspace!, role: "viewer" } })],
  ["same-account login", () => authStore.getState().setSession(session)],
  ["logout", () => authStore.getState().clearSession()],
] as const)("isolates a late mutation after %s changes", async (_label, switchSession) => {
  const { result } = renderHook(() => useQueryClient(), { wrapper: AppProviders });
  const previousClient = result.current;
  previousClient.setQueryData(privateKey, { body: "Existing private content" });
  let finish!: (data: { body: string }) => void;
  const observer = new MutationObserver(previousClient, {
    mutationFn: () => new Promise<{ body: string }>((resolve) => { finish = resolve; }),
    onSuccess: (data) => previousClient.setQueryData(privateKey, data),
  });
  let pending!: Promise<{ body: string }>;
  await act(async () => { pending = observer.mutate(); });

  act(switchSession);
  const activeClient = result.current;
  await act(async () => { finish({ body: "Previous session private content" }); await pending; });

  expect(activeClient.getQueryData(privateKey)).toBeUndefined();
  expect(activeClient).not.toBe(previousClient);
  // The completed callback really ran, but only its abandoned client received data.
  expect(previousClient.getQueryData(privateKey)).toEqual({ body: "Previous session private content" });
});

it("remounts mutation observers and local drafts at the session boundary", async () => {
  let finish!: (data: string) => void;
  const { result } = renderHook(() => {
    const client = useQueryClient();
    const [draft, setDraft] = useState("");
    const mutation = useMutation({
      mutationFn: () => new Promise<string>((resolve) => { finish = resolve; }),
      onSuccess: (data) => { client.setQueryData(privateKey, data); setDraft(data); },
    });
    return { client, draft, setDraft, mutation };
  }, { wrapper: AppProviders });
  act(() => result.current.setDraft("Previous session draft"));
  let pending!: Promise<string>;
  await act(async () => { pending = result.current.mutation.mutateAsync(); });
  act(() => authStore.getState().setSession(session));
  await act(async () => { finish("Previous session saved content"); await pending; });

  expect(result.current.client.getQueryData(privateKey)).toBeUndefined();
  expect(result.current.draft).toBe("");
  expect(result.current.mutation.status).toBe("idle");
});

it("preserves the client and local draft during an access token refresh", () => {
  const { result } = renderHook(() => {
    const client = useQueryClient();
    const [draft, setDraft] = useState("");
    return { client, draft, setDraft };
  }, { wrapper: AppProviders });
  const client = result.current.client;
  client.setQueryData(privateKey, { body: "Current session content" });
  act(() => result.current.setDraft("Unsaved draft"));
  act(() => authStore.getState().setTokens("refreshed-token", "rotated-refresh-token"));

  expect(result.current.client).toBe(client);
  expect(result.current.client.getQueryData(privateKey)).toEqual({ body: "Current session content" });
  expect(result.current.draft).toBe("Unsaved draft");
});

it("keeps successful queries in the active cache under StrictMode", async () => {
  const { result } = renderHook(() => ({
    client: useQueryClient(),
    query: useQuery({ queryKey: privateKey, queryFn: async () => "Current session content" }),
  }), { wrapper: ({ children }) => <StrictMode><AppProviders>{children}</AppProviders></StrictMode> });
  await waitFor(() => expect(result.current.query.data).toBe("Current session content"));
  expect(result.current.client.getQueryData(privateKey)).toBe("Current session content");
});

it.each([
  ["workspace", () => authStore.setState({ workspace: { ...session.workspace!, id: "workspace-b" } })],
  ["account", () => authStore.setState({ user: { ...session.user, id: "account-b" } })],
  ["logout", () => authStore.getState().clearSession()],
] as const)("does not announce a late response-validation failure after %s changes", async (_label, switchSession) => {
  const { result } = renderHook(() => useQueryClient(), { wrapper: AppProviders });
  let finish!: () => void;
  const response = new Promise<void>(resolve => { finish = resolve; });
  const observer = new MutationObserver(result.current, { mutationFn: async () => { await response; return z.object({ id: z.string() }).parse({ id: 17 }); } });
  let pending!: Promise<unknown>;
  await act(async () => { pending = observer.mutate().catch(reportError); });
  act(switchSession);
  await act(async () => { finish(); await pending; });
  expect(notify).not.toHaveBeenCalled();
});

it("reports current-session validation errors once across cache and caller fallbacks", async () => {
  const { result } = renderHook(() => useQueryClient(), { wrapper: AppProviders });
  const observer = new MutationObserver(result.current, { mutationFn: async () => z.object({ id: z.string() }).parse({ id: 17 }) });
  await act(async () => { await observer.mutate().catch(reportError); });
  expect(notify).toHaveBeenCalledExactlyOnceWith({ title: "服务返回的数据不完整，请刷新重试", tone: "danger" });
});

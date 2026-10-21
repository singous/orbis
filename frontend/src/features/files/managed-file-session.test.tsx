import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { StrictMode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { useManagedFiles } from "./use-managed-files";
import { authStore, type AuthSession } from "../../shared/auth/auth-store";

const session: AuthSession = {
  accessToken: "account-a-access", refreshToken: "account-a-refresh",
  user: {bio:null,avatar_asset_id:null,profile_version:1,id: "0190a111-1111-7111-8111-111111111110", email: "a@example.com", display_name: "A", preferred_workspace_id: "0190a111-1111-7111-8111-111111111112", created_at_ms: 1, updated_at_ms: 1 },
  workspace: { id: "0190a111-1111-7111-8111-111111111112", name: "Workspace A", role: "owner", created_at_ms: 1, updated_at_ms: 1 },
};
const ref = "orbis-file:0190a111-1111-7111-8111-111111111111";
beforeEach(() => {
  authStore.getState().setSession(session);
  vi.stubGlobal("URL", class extends URL {
    static createObjectURL = vi.fn().mockReturnValueOnce("blob:workspace-a").mockReturnValue("blob:workspace-b");
    static revokeObjectURL = vi.fn();
  });
});
afterEach(async () => { cleanup(); await Promise.resolve(); authStore.getState().clearSession(); vi.unstubAllGlobals(); });

it("survives StrictMode effect replay and revokes URLs on real unmount", async () => {
  vi.stubGlobal("fetch", vi.fn().mockImplementation(() => Promise.resolve(new Response("image", { headers: { "Content-Type": "image/png" } }))));
  const { result, unmount } = renderHook(useManagedFiles, { wrapper: StrictMode });
  expect(await result.current.resolve(ref)).toBe("blob:workspace-a");
  expect(URL.revokeObjectURL).not.toHaveBeenCalled();
  unmount();
  await waitFor(() => expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:workspace-a"));
  await expect(result.current.resolve(ref)).rejects.toMatchObject({ name: "AbortError" });
});

it("stable editor callbacks switch to the new workspace and discard the old cache", async () => {
  const fetcher = vi.fn().mockImplementation(() => Promise.resolve(new Response("image", { headers: { "Content-Type": "image/png" } })));
  vi.stubGlobal("fetch", fetcher);
  const { result } = renderHook(useManagedFiles);
  const editorCallback = result.current.resolve;
  expect(await editorCallback(ref)).toBe("blob:workspace-a");
  expect(fetcher).toHaveBeenLastCalledWith(expect.any(String), expect.objectContaining({ headers: { authorization: "Bearer account-a-access" } }));
  act(() => authStore.getState().setSession({ ...session, accessToken: "workspace-b-access", workspace: { ...session.workspace!, id: "0190a111-1111-7111-8111-111111111113" } }));
  expect(result.current.resolve).toBe(editorCallback);
  expect(await editorCallback(ref)).toBe("blob:workspace-b");
  expect(fetcher).toHaveBeenLastCalledWith(expect.any(String), expect.objectContaining({ headers: { authorization: "Bearer workspace-b-access" } }));
  expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:workspace-a");
  act(() => authStore.getState().clearSession());
  await expect(editorCallback(ref)).rejects.toThrow("请先登录");
});

it("invalidates file search results after a successful upload in the same session", async () => {
  const client = new QueryClient();
  const invalidate = vi.spyOn(client, "invalidateQueries");
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ code: "OK", message: "ok", request_id: "test", data: { id: ref.slice("orbis-file:".length), size_bytes:7,sha256:"a".repeat(64) } }), { headers: { "Content-Type": "application/json" } })));
  const { result } = renderHook(useManagedFiles, { wrapper: ({ children }) => <QueryClientProvider client={client}>{children}</QueryClientProvider> });
  expect(await result.current.upload(new File(["content"], "upload.txt"))).toBe(ref);
  expect(invalidate).toHaveBeenCalledWith({ queryKey: ["global-search"] });
});

import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { StrictMode } from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { useManagedFiles } from "../../src/features/files/use-managed-files";
import { authStore, type AuthSession } from "../../src/shared/auth/auth-store";

const session: AuthSession = {
  accessToken: "account-a-access", refreshToken: "account-a-refresh",
  user: { id: "account-a", tenant_id: null, email: "a@example.com", display_name: "A", current_workspace_id: "workspace-a", status: "active", created_at_ms: 1, updated_at_ms: 1 },
  workspace: { id: "workspace-a", name: "Workspace A", workspace_type: "private", role: "owner", is_current: true, created_at_ms: 1, updated_at_ms: 1 },
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
  act(() => authStore.getState().setSession({ ...session, accessToken: "workspace-b-access", workspace: { ...session.workspace!, id: "workspace-b" } }));
  expect(result.current.resolve).toBe(editorCallback);
  expect(await editorCallback(ref)).toBe("blob:workspace-b");
  expect(fetcher).toHaveBeenLastCalledWith(expect.any(String), expect.objectContaining({ headers: { Authorization: "Bearer workspace-b-access" } }));
  expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:workspace-a");
  act(() => authStore.getState().clearSession());
  await expect(editorCallback(ref)).rejects.toThrow("请先登录");
});

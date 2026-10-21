import { afterEach, expect, it, vi } from "vitest";
import { login, setup } from "./auth-api";
const firstID = "00000000-0000-4000-8000-000000000001", preferredID = "00000000-0000-4000-8000-000000000002";
const user = { id: "00000000-0000-4000-8000-000000000003", email: "owner@example.test", display_name: "所有者", bio: null, avatar_asset_id: null, preferred_workspace_id: preferredID, profile_version: 1, created_at_ms: 1, updated_at_ms: 1 };
const space = (id: string) => ({ id, name: "工作空间", role: "owner", created_at_ms: 1, updated_at_ms: 1 });
const tokens = { access_token: "access", refresh_token: "refresh", token_type: "Bearer", expires_at_ms: 100, user };
function response(data: unknown) { return new Response(JSON.stringify({ code: "OK", message: "成功", request_id: "req", data }), { headers: { "Content-Type": "application/json" } }); }
afterEach(() => vi.unstubAllGlobals());
it("selects the preferred available workspace after a native login", async () => {
  const fetchMock = vi.fn().mockResolvedValueOnce(response(tokens)).mockResolvedValueOnce(response({ items: [space(firstID), space(preferredID)], pagination: { page: 1, page_size: 100, total: 2 } }));
  vi.stubGlobal("fetch", fetchMock);
  const session = await login({ email: user.email, password: "synthetic-password" });
  expect(session.workspace?.id).toBe(preferredID);
  expect(fetchMock.mock.calls.map(call => call[0])).toEqual(["/api/v1/auth/login", "/api/v1/workspaces?page=1&page_size=100"]);
});
it("performs explicit login after setup without expecting setup to create a session", async () => {
  const fetchMock = vi.fn().mockResolvedValueOnce(response({ user, workspace: space(firstID) })).mockResolvedValueOnce(response(tokens)).mockResolvedValueOnce(response({ items: [space(firstID)], pagination: { page: 1, page_size: 100, total: 1 } }));
  vi.stubGlobal("fetch", fetchMock);
  const session = await setup({ email: user.email, password: "synthetic-password", display_name: "所有者" });
  expect(session.access_token).toBe("access");
  expect(session.workspace?.id).toBe(firstID);
  expect(JSON.parse(fetchMock.mock.calls[0][1].body).workspace_name).toBe("我的工作空间");
  expect(fetchMock.mock.calls[1][0]).toBe("/api/v1/auth/login");
});

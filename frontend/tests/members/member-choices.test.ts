import { afterEach, expect, it, vi } from "vitest";
import { listMemberChoices } from "../../src/features/members/api";
import type { AuthRequestOptions } from "../../src/shared/auth/use-auth-request";

const workspaceId = "00000000-0000-4000-8000-000000000001";
const member = { workspace_id: workspaceId, user_id: "00000000-0000-4000-8000-000000000002", email: "member@example.com", display_name: "", role: "editor", version: 1, created_at_ms: 1, updated_at_ms: 1 };
const auth: AuthRequestOptions = { accessToken: "access", refreshToken: null, workspaceId, onTokenRefresh: () => {}, onUnauthorized: () => {} };
function response(data: unknown) { return new Response(JSON.stringify({ code: "OK", message: "成功", request_id: "member-choices", data }), { headers: { "Content-Type": "application/json" } }); }
afterEach(() => vi.unstubAllGlobals());
it("loads the member choices beyond page one and forwards cancellation", async () => {
  const fetchMock = vi.fn().mockResolvedValueOnce(response({ items: Array.from({ length: 100 }, () => member), pagination: { page: 1, page_size: 100, total: 101 } })).mockResolvedValueOnce(response({ items: [{ ...member, display_name: "第二页成员" }], pagination: { page: 2, page_size: 100, total: 101 } }));
  vi.stubGlobal("fetch", fetchMock);
  const signal = new AbortController().signal;
  const result = await listMemberChoices(auth, signal);
  expect(result.items).toHaveLength(101);
  expect(result.items[100].display_name).toBe("第二页成员");
  expect(fetchMock.mock.calls.map(call => call[0])).toEqual([`/api/v1/workspaces/${workspaceId}/members?page=1&page_size=100`, `/api/v1/workspaces/${workspaceId}/members?page=2&page_size=100`]);
  expect(fetchMock.mock.calls.every(call => call[1].signal === signal)).toBe(true);
});

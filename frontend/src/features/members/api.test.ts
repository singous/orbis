import { afterEach, expect, it, vi } from "vitest";
import { acceptInvitation, cancelOwnership, listInvitations, listMembers, removeMember, resendOwnership, revokeInvitation, startOwnershipTransfer, updateMemberRole, type MemberAuth } from "./api";
const wid = "00000000-0000-4000-8000-000000000001", uid = "00000000-0000-4000-8000-000000000002", action = "00000000-0000-4000-8000-000000000003";
const auth: MemberAuth = { accessToken: "access-token", refreshToken: null, workspaceId: wid, onTokenRefresh: vi.fn(), onUnauthorized: vi.fn() };
function response(data: unknown) { return new Response(JSON.stringify({ code: "OK", message: "成功", request_id: "request", data }), { headers: { "Content-Type": "application/json" } }); }
const member = { workspace_id: wid, user_id: uid, email: "member@example.test", display_name: "成员", role: "viewer", version: 4, created_at_ms: 1, updated_at_ms: 1 };
const ownership = { id: action, from_user_id: uid, target_user_id: uid, status: "pending", expires_at_ms: 100, email_sent: false, email_error_summary: null, confirmed_at_ms: null, cancelled_at_ms: null, created_at_ms: 1, updated_at_ms: 1 };
afterEach(() => vi.unstubAllGlobals());
it("uses explicit workspace paths and native page numbers", async () => {
  const fetchMock = vi.fn().mockResolvedValueOnce(response({ items: [member], pagination: { page: 2, page_size: 20, total: 24 } })).mockResolvedValueOnce(response({ items: [], pagination: { page: 1, page_size: 20, total: 0 } }));
  vi.stubGlobal("fetch", fetchMock);
  expect((await listMembers(auth, 2)).items[0].version).toBe(4);
  await listInvitations(auth);
  expect(fetchMock.mock.calls.map(call => call[0])).toEqual([`/api/v1/workspaces/${wid}/members?page=2&page_size=20`, `/api/v1/workspaces/${wid}/invitations?page=1&page_size=20`]);
});
it("sends the observed member version for role changes and removal", async () => {
  const fetchMock = vi.fn().mockResolvedValueOnce(response({ ...member, role: "editor", version: 5 })).mockResolvedValueOnce(response(null));
  vi.stubGlobal("fetch", fetchMock);
  await updateMemberRole(uid, "editor", 4, auth);
  await removeMember(uid, 5, auth);
  expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ role: "editor", expected_version: 4 });
  expect(JSON.parse(fetchMock.mock.calls[1][1].body)).toEqual({ expected_version: 5 });
  expect(fetchMock.mock.calls[1][1].method).toBe("DELETE");
});
it("uses explicit invitation revoke and ownership lifecycle endpoints", async () => {
  const fetchMock = vi.fn().mockImplementation(() => Promise.resolve(response(ownership)));
  vi.stubGlobal("fetch", fetchMock);
  await revokeInvitation(action, auth);
  await startOwnershipTransfer(uid, auth);
  await resendOwnership(action, auth);
  await cancelOwnership(action, auth);
  expect(fetchMock.mock.calls.map(call => call[0])).toEqual([`/api/v1/workspaces/${wid}/invitations/${action}/revoke`, `/api/v1/workspaces/${wid}/ownership-transfers`, `/api/v1/workspaces/${wid}/ownership-transfers/${action}/resend`, `/api/v1/workspaces/${wid}/ownership-transfers/${action}/cancel`]);
  expect(JSON.parse(fetchMock.mock.calls[1][1].body)).toEqual({ target_user_id: uid });
});
it("accepts the nullable native session returned for an already authenticated invitee", async () => {
  const user = { id: uid, email: member.email, display_name: null, bio: null, avatar_asset_id: null, preferred_workspace_id: null, profile_version: 1, created_at_ms: 1, updated_at_ms: 1 };
  const fetchMock = vi.fn().mockResolvedValue(response({ user, member, session: null }));
  vi.stubGlobal("fetch", fetchMock);
  expect((await acceptInvitation({ token: "synthetic-capability" }, auth)).session).toBeNull();
  expect(fetchMock.mock.calls[0][0]).toBe("/api/v1/invitations/accept");
  expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ token: "synthetic-capability" });
});

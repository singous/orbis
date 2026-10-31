import { withRequestFeedback } from "../../shared/api/request-feedback";
import { z } from "zod";

import { ApiError, apiRequest, workspacePath } from "../../shared/api/api-client";
import { authTokensSchema, pageDataSchema, userSchema } from "../../shared/api/schemas";
import { authRequestOptions as authOptions, type AuthRequestOptions } from "../../shared/auth/use-auth-request";
import type { ToastInput } from "../../shared/ui/Toast";

export type MemberAuth = AuthRequestOptions;

const memberSchema = z.object({
  workspace_id: z.string().uuid(), version: z.number().int().positive(), user_id: z.string().uuid(), email: z.string().email(), display_name: z.string(),
  role: z.enum(["owner", "admin", "editor", "viewer"]), created_at_ms: z.number(), updated_at_ms: z.number(),
});
const invitationSchema = z.object({
  id: z.string().uuid(), email: z.string().email(), role: z.enum(["admin", "editor", "viewer"]), status: z.string(), expires_at_ms: z.number(),
  email_sent: z.boolean(), email_error_summary: z.string().nullable(), created_at_ms: z.number(), updated_at_ms: z.number(),
});
const ownershipSchema = z.object({
  id: z.string().uuid(), from_user_id: z.string().uuid(), target_user_id: z.string().uuid(),
  status: z.string(), expires_at_ms: z.number(), email_sent: z.boolean(), email_error_summary: z.string().nullable(),
  confirmed_at_ms: z.number().nullable(), cancelled_at_ms: z.number().nullable(), created_at_ms: z.number(), updated_at_ms: z.number(),
});
const mailStatusSchema = z.object({ enabled: z.boolean() });

export type Member = z.infer<typeof memberSchema>;
export type Invitation = z.infer<typeof invitationSchema>;
export type OwnershipTransfer = z.infer<typeof ownershipSchema>;

// 操作创建成功不等于邮件已投递，按后端投递结果选择本次唯一的提示。
function mailFeedback(result: Pick<Invitation, "email_sent" | "email_error_summary">, message: string): ToastInput {
  return result.email_sent
    ? { title: message, tone: "success" }
    : { title: result.email_error_summary || "邮件尚未发送，请稍后重试", tone: "warning" };
}

const MEMBER_CHOICES_PAGE_SIZE = 100;

async function memberPage(auth: MemberAuth, page: number, pageSize: number, signal?: AbortSignal) {
  return pageDataSchema(memberSchema).parse(await apiRequest(workspacePath(auth, `/members?page=${page}&page_size=${pageSize}`), { ...authOptions(auth), signal }));
}

export async function listMembers(auth: MemberAuth, page = 1) {
  return memberPage(auth, page, 20);
}

/** 人员字段加载完整成员列表，避免遗漏成员管理分页之外的选项。 */
export async function listMemberChoices(auth: MemberAuth, signal?: AbortSignal) {
  const items: Member[] = [];
  for (let page = 1; ; page += 1) {
    const result = await memberPage(auth, page, MEMBER_CHOICES_PAGE_SIZE, signal);
    items.push(...result.items);
    if (!result.pagination.has_next) return { items };
  }
}

export async function listInvitations(auth: MemberAuth, page = 1) {
  return pageDataSchema(invitationSchema).parse(await apiRequest(workspacePath(auth, `/invitations?page=${page}&page_size=20`), authOptions(auth)));
}

export async function getMailStatus(auth: MemberAuth) {
  return mailStatusSchema.parse(await apiRequest(workspacePath(auth, "/mail-status"), authOptions(auth)));
}

export async function inviteMember(payload: { email: string; role: "admin" | "editor" | "viewer" }, auth: MemberAuth) {
  return withRequestFeedback({ ...auth, feedback: { ...auth.feedback, success: true } }, async auth => {

  return invitationSchema.parse(await apiRequest(workspacePath(auth, "/invitations"), { method: "POST", body: payload, ...authOptions(auth) }));

  }, mailFeedback);
}

export async function revokeInvitation(id: string, auth: MemberAuth) {
  return withRequestFeedback({ ...auth, feedback: { ...auth.feedback, success: true } }, async auth => {

  await apiRequest(workspacePath(auth, `/invitations/${id}/revoke`), { method: "POST", ...authOptions(auth) });

  });
}

export async function resendInvitation(id: string, auth: MemberAuth) {
  return withRequestFeedback({ ...auth, feedback: { ...auth.feedback, success: true } }, async auth => {

  return invitationSchema.parse(await apiRequest(workspacePath(auth, `/invitations/${id}/resend`), { method: "POST", ...authOptions(auth) }));

  }, mailFeedback);
}

export async function updateMemberRole(id: string, role: "admin" | "editor" | "viewer", expectedVersion: number, auth: MemberAuth) {
  return withRequestFeedback({ ...auth, feedback: { ...auth.feedback, success: true } }, async auth => {

  return memberSchema.parse(await apiRequest(workspacePath(auth, `/members/${id}`), { method: "PATCH", body: { role, expected_version: expectedVersion }, ...authOptions(auth) }));

  });
}

export async function removeMember(id: string, expectedVersion: number, auth: MemberAuth) {
  return withRequestFeedback({ ...auth, feedback: { ...auth.feedback, success: true } }, async auth => {

  await apiRequest(workspacePath(auth, `/members/${id}`), { method: "DELETE", body: { expected_version: expectedVersion }, ...authOptions(auth) });

  });
}

export async function acceptInvitation(payload: { token: string; password?: string; display_name?: string }, auth?: MemberAuth | null) {
  return z.object({ user: userSchema, member: memberSchema, session: authTokensSchema.nullable() }).parse(await apiRequest("/v1/invitations/accept", { method: "POST", body: payload, ...(auth ? authOptions(auth) : {}) }));
}

export async function startOwnershipTransfer(targetUserId: string, auth: MemberAuth) {
  return withRequestFeedback({ ...auth, feedback: { ...auth.feedback, success: true } }, async auth => {

  return ownershipSchema.parse(await apiRequest(workspacePath(auth, "/ownership-transfers"), { method: "POST", body: { target_user_id: targetUserId }, ...authOptions(auth) }));

  }, mailFeedback);
}

export async function confirmOwnershipTransfer(token: string) {
  return ownershipSchema.parse(await apiRequest("/v1/ownership-transfers/confirm", { method: "POST", body: { token } }));
}

export async function inspectInvitation(token: string) {
  return z.object({ workspace_name: z.string(), email: z.string(), role: z.string(), account_exists: z.boolean(), expires_at_ms: z.number().int() }).parse(await apiRequest("/v1/invitations/inspect", { method: "POST", body: { token } }));
}
export async function currentOwnership(auth: MemberAuth) {
  try { return ownershipSchema.parse(await apiRequest(workspacePath(auth, "/ownership-transfers/current"), authOptions({ ...auth, feedback: { ...auth.feedback, error: error => !(error instanceof ApiError && error.status === 404) } }))); }
  catch (error) { if (error instanceof ApiError && error.status === 404) return null; throw error; }
}
export async function resendOwnership(id: string, auth: MemberAuth) {
  return withRequestFeedback({ ...auth, feedback: { ...auth.feedback, success: true } }, async auth => {

  return ownershipSchema.parse(await apiRequest(workspacePath(auth, `/ownership-transfers/${id}/resend`), { ...authOptions(auth), method: "POST" }));

  }, mailFeedback);
}
export async function cancelOwnership(id: string, auth: MemberAuth) {
  return withRequestFeedback({ ...auth, feedback: { ...auth.feedback, success: true } }, async auth => {

  return ownershipSchema.parse(await apiRequest(workspacePath(auth, `/ownership-transfers/${id}/cancel`), { ...authOptions(auth), method: "POST" }));

  });
}

import { z } from "zod";

import { apiRequest } from "../../shared/api/api-client";
import { pageDataSchema } from "../../shared/api/schemas";

export type MemberAuth = {
  accessToken: string;
  refreshToken: string | null;
  onTokenRefresh: (accessToken: string) => void;
  onUnauthorized: () => void;
};

const memberSchema = z.object({
  id: z.string().uuid(), user_id: z.string().uuid(), email: z.string().email(), display_name: z.string().nullable(),
  role: z.enum(["owner", "admin", "editor", "normal"]), status: z.string(), created_at_ms: z.number(), updated_at_ms: z.number(),
});
const invitationSchema = z.object({
  id: z.string().uuid(), email: z.string().email(), role: z.enum(["admin", "editor", "normal"]), status: z.string(), expires_at_ms: z.number(),
  email_sent: z.boolean(), email_error_summary: z.string().nullable(), created_at_ms: z.number(), updated_at_ms: z.number(),
});
const ownershipSchema = z.object({
  id: z.string().uuid(), from_user_id: z.string().uuid(), target_member_id: z.string().uuid(), target_user_id: z.string().uuid(),
  status: z.string(), expires_at_ms: z.number(), email_sent: z.boolean(), email_error_summary: z.string().nullable(),
  confirmed_at_ms: z.number().nullable(), cancelled_at_ms: z.number().nullable(), created_at_ms: z.number(), updated_at_ms: z.number(),
});
const mailStatusSchema = z.object({ available: z.boolean(), transport: z.enum(["disabled", "outbox", "smtp"]) });

export type Member = z.infer<typeof memberSchema>;
export type Invitation = z.infer<typeof invitationSchema>;
export type OwnershipTransfer = z.infer<typeof ownershipSchema>;

function authOptions(auth: MemberAuth) {
  return { token: auth.accessToken, refreshToken: auth.refreshToken, onTokenRefresh: auth.onTokenRefresh, onUnauthorized: auth.onUnauthorized };
}

export async function listMembers(auth: MemberAuth) {
  return pageDataSchema(memberSchema).parse(await apiRequest("/workspace/members?page=1&page_size=100", authOptions(auth)));
}

export async function listInvitations(auth: MemberAuth) {
  return pageDataSchema(invitationSchema).parse(await apiRequest("/workspace/invitations?page=1&page_size=100", authOptions(auth)));
}

export async function getMailStatus(auth: MemberAuth) {
  return mailStatusSchema.parse(await apiRequest("/workspace/mail-status", authOptions(auth)));
}

export async function inviteMember(payload: { email: string; role: "admin" | "editor" | "normal" }, auth: MemberAuth) {
  return invitationSchema.parse(await apiRequest("/workspace/invitations", { method: "POST", body: payload, ...authOptions(auth) }));
}

export async function revokeInvitation(id: string, auth: MemberAuth) {
  await apiRequest(`/workspace/invitations/${id}`, { method: "DELETE", ...authOptions(auth) });
}

export async function resendInvitation(id: string, auth: MemberAuth) {
  return invitationSchema.parse(await apiRequest(`/workspace/invitations/${id}/resend`, { method: "POST", ...authOptions(auth) }));
}

export async function updateMemberRole(id: string, role: "admin" | "editor" | "normal", auth: MemberAuth) {
  return memberSchema.parse(await apiRequest(`/workspace/members/${id}`, { method: "PATCH", body: { role }, ...authOptions(auth) }));
}

export async function removeMember(id: string, auth: MemberAuth) {
  await apiRequest(`/workspace/members/${id}`, { method: "DELETE", ...authOptions(auth) });
}

export async function acceptInvitation(payload: { token: string; password?: string; display_name?: string }, auth?: MemberAuth | null) {
  return z.object({ user: z.object({ id: z.string().uuid(), email: z.string().email() }), membership: memberSchema, access_token: z.string().nullable(), refresh_token: z.string().nullable(), token_type: z.string() }).parse(await apiRequest("/workspace/invitations/accept", { method: "POST", body: payload, ...(auth ? authOptions(auth) : {}) }));
}

export async function startOwnershipTransfer(targetMemberId: string, auth: MemberAuth) {
  return ownershipSchema.parse(await apiRequest("/workspace/ownership-transfers", { method: "POST", body: { target_member_id: targetMemberId }, ...authOptions(auth) }));
}

export async function confirmOwnershipTransfer(token: string) {
  return ownershipSchema.parse(await apiRequest("/workspace/ownership-transfers/confirm", { method: "POST", body: { token } }));
}

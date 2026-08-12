import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Crown, Mail, RefreshCw, Shield, Trash2, UserPlus, Users } from "lucide-react";
import { type FormEvent, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useStore } from "zustand";

import { ApiError } from "../../shared/api/api-client";
import { authStore } from "../../shared/auth/auth-store";
import { Button } from "../../shared/ui/Button";
import { StatusMessage } from "../../shared/ui/StatusMessage";
import { TextInput } from "../../shared/ui/TextInput";
import { DocumentShell } from "../documents/DocumentShell";
import {
  getMailStatus,
  inviteMember,
  listInvitations,
  listMembers,
  removeMember,
  resendInvitation,
  revokeInvitation,
  startOwnershipTransfer,
  updateMemberRole,
  type MemberAuth,
} from "./api";

export function MemberSettingsPage() {
  const queryClient = useQueryClient();
  const accessToken = useStore(authStore, (state) => state.accessToken);
  const refreshToken = useStore(authStore, (state) => state.refreshToken);
  const workspace = useStore(authStore, (state) => state.workspace);
  const onTokenRefresh = useStore(authStore, (state) => state.setAccessToken);
  const onUnauthorized = useStore(authStore, (state) => state.clearSession);
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<"admin" | "editor" | "normal">("editor");
  const auth = useMemo<MemberAuth>(
    () => ({ accessToken: accessToken as string, refreshToken, onTokenRefresh, onUnauthorized }),
    [accessToken, refreshToken, onTokenRefresh, onUnauthorized],
  );
  const canManage = workspace?.role === "owner" || workspace?.role === "admin";
  const membersQuery = useQuery({ queryKey: ["members"], queryFn: () => listMembers(auth) });
  const invitesQuery = useQuery({
    queryKey: ["invitations"],
    queryFn: () => listInvitations(auth),
    enabled: canManage,
  });
  const mailQuery = useQuery({ queryKey: ["mail-status"], queryFn: () => getMailStatus(auth) });
  const refresh = () => Promise.all([
    queryClient.invalidateQueries({ queryKey: ["members"] }),
    queryClient.invalidateQueries({ queryKey: ["invitations"] }),
  ]);
  const invite = useMutation({
    mutationFn: () => inviteMember({ email, role }, auth),
    onSuccess: async () => { setEmail(""); await refresh(); },
  });
  const roleMutation = useMutation({
    mutationFn: ({ id, nextRole }: { id: string; nextRole: "admin" | "editor" | "normal" }) => updateMemberRole(id, nextRole, auth),
    onSuccess: refresh,
  });
  const removeMutation = useMutation({ mutationFn: (id: string) => removeMember(id, auth), onSuccess: refresh });
  const revokeMutation = useMutation({ mutationFn: (id: string) => revokeInvitation(id, auth), onSuccess: refresh });
  const resendMutation = useMutation({ mutationFn: (id: string) => resendInvitation(id, auth), onSuccess: refresh });
  const transferMutation = useMutation({ mutationFn: (id: string) => startOwnershipTransfer(id, auth) });
  const pendingInvitations = invitesQuery.data?.items.filter((item) => item.status === "pending") ?? [];
  const operationError = (invite.error || roleMutation.error || removeMutation.error || transferMutation.error) as ApiError | null;

  function submitInvite(event: FormEvent) {
    event.preventDefault();
    if (email.trim()) invite.mutate();
  }

  function confirmRemove(memberId: string, emailAddress: string) {
    if (window.confirm(`确认移除 ${emailAddress}？该成员将立即失去工作空间访问权限。`)) {
      removeMutation.mutate(memberId);
    }
  }

  function confirmTransfer(memberId: string) {
    if (window.confirm("确认发起所有权转让？目标管理员需要通过邮件确认。")) {
      transferMutation.mutate(memberId);
    }
  }

  return (
    <DocumentShell>
      <div className="mx-auto max-w-5xl px-5 py-8 lg:px-10 lg:py-10">
        <Link to="/documents" className="mb-8 inline-flex items-center gap-2 text-xs font-medium text-[var(--muted)] hover:text-black">
          <ArrowLeft aria-hidden="true" size={14} />返回文档中心
        </Link>
        <div className="mb-9">
          <div className="mb-2 text-xs font-semibold uppercase tracking-[0.18em] text-[var(--muted-light)]">Workspace settings</div>
          <h1 className="text-4xl font-semibold tracking-[-0.045em]">成员与权限</h1>
          <p className="mt-3 text-sm text-[var(--muted)]">管理默认私人工作空间中的协作者。普通成员只能阅读，编辑者可以维护云文档。</p>
        </div>

        {!canManage ? <StatusMessage tone="info" title="只读成员列表">你的角色不能邀请、移除或调整其他成员。</StatusMessage> : null}
        {membersQuery.isError ? <div className="mb-5"><StatusMessage tone="error" title="成员列表加载失败">请刷新页面后重试。</StatusMessage></div> : null}
        {operationError ? (
          <div className="mb-5"><StatusMessage tone="error" title="操作未完成">{operationError.code === "MAIL_SERVICE_UNAVAILABLE" ? "邮件服务不可用，暂时无法发送邀请或转让确认。" : operationError.message}</StatusMessage></div>
        ) : null}

        {canManage ? (
          <section className="mb-10 rounded-2xl border border-[var(--border)] bg-[var(--surface-content)] p-5">
            <div className="mb-5 flex items-center gap-3">
              <div className="document-icon"><UserPlus aria-hidden="true" size={17} /></div>
              <div><h2 className="text-base font-semibold">邀请成员</h2><p className="mt-1 text-xs text-[var(--muted)]">{mailQuery.data?.available ? "邀请链接会通过邮件发送。" : "当前邮件服务未启用，邀请发送不可用。"}</p></div>
            </div>
            <form className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_150px_auto] sm:items-end" onSubmit={submitInvite}>
              <TextInput label="邮箱" type="email" placeholder="member@example.com" value={email} onChange={(event) => setEmail(event.target.value)} />
              <label className="grid gap-1.5 text-sm font-medium">
                <span>角色</span>
                <select className="h-11 rounded-xl border border-[var(--border)] bg-[var(--surface-content)] px-3 text-sm" value={role} onChange={(event) => setRole(event.target.value as typeof role)}>
                  {workspace?.role === "owner" ? <option value="admin">管理员</option> : null}
                  <option value="editor">编辑者</option><option value="normal">普通成员</option>
                </select>
              </label>
              <Button type="submit" variant="primary" className="h-11" disabled={!mailQuery.data?.available || !email.trim() || invite.isPending} icon={<Mail aria-hidden="true" size={14} />}>发送邀请</Button>
            </form>
          </section>
        ) : null}

        <section className="mb-10">
          <div className="section-heading"><div><h2>工作空间成员</h2><p>{membersQuery.data?.items.length ?? 0} 位活跃成员</p></div></div>
          {membersQuery.isLoading ? <div className="empty-panel">正在加载成员…</div> : null}
          <div className="overflow-hidden rounded-2xl border border-[var(--border)] bg-[var(--surface-content)]">
            {membersQuery.data?.items.map((member) => {
              const actorCanChange = canManage && (workspace?.role === "owner" || member.role !== "admin");
              return (
                <div key={member.id} className="flex flex-wrap items-center gap-4 border-b border-[var(--border)] px-4 py-4 last:border-b-0">
                  <div className="grid h-9 w-9 place-items-center rounded-full bg-[var(--surface-inverse)] text-xs font-semibold text-[var(--text-oninverse)]">{(member.display_name || member.email).slice(0, 1).toUpperCase()}</div>
                  <div className="min-w-[180px] flex-1"><div className="text-sm font-semibold">{member.display_name || member.email}</div><div className="mt-1 text-xs text-[var(--muted)]">{member.email}</div></div>
                  <div className="flex items-center gap-2">
                    {member.role === "owner" ? <span className="tag"><Crown aria-hidden="true" className="mr-1" size={11} />所有者</span> : actorCanChange ? (
                      <select aria-label={`调整 ${member.email} 的角色`} className="h-9 rounded-lg border border-[var(--border)] bg-[var(--surface-content)] px-2 text-xs" value={member.role} onChange={(event) => roleMutation.mutate({ id: member.id, nextRole: event.target.value as "admin" | "editor" | "normal" })}>
                        {workspace?.role === "owner" ? <option value="admin">管理员</option> : null}<option value="editor">编辑者</option><option value="normal">普通成员</option>
                      </select>
                    ) : <span className="tag"><Shield aria-hidden="true" className="mr-1" size={11} />{member.role}</span>}
                    {workspace?.role === "owner" && member.role === "admin" ? <Button variant="secondary" className="h-9" onClick={() => confirmTransfer(member.id)} disabled={!mailQuery.data?.available || transferMutation.isPending}>转让所有权</Button> : null}
                    {member.role !== "owner" && actorCanChange ? <button type="button" className="icon-button danger-hover" aria-label={`移除 ${member.email}`} onClick={() => confirmRemove(member.id, member.email)}><Trash2 aria-hidden="true" size={14} /></button> : null}
                  </div>
                </div>
              );
            })}
          </div>
        </section>

        {canManage && pendingInvitations.length ? (
          <section>
            <div className="section-heading"><div><h2>待处理邀请</h2><p>过期后需要重新发送</p></div></div>
            <div className="overflow-hidden rounded-2xl border border-[var(--border)] bg-[var(--surface-content)]">
              {pendingInvitations.map((item) => (
                <div key={item.id} className="flex flex-wrap items-center gap-4 border-b border-[var(--border)] px-4 py-4 last:border-b-0">
                  <Users aria-hidden="true" size={17} className="text-[var(--muted)]" />
                  <div className="min-w-[200px] flex-1"><div className="text-sm font-semibold">{item.email}</div><div className="mt-1 text-xs text-[var(--muted)]">{item.role} · {item.email_sent ? "已发送" : "发送失败"}</div></div>
                  <button type="button" className="icon-button" aria-label={`重发 ${item.email}`} onClick={() => resendMutation.mutate(item.id)}><RefreshCw aria-hidden="true" size={14} /></button>
                  <button type="button" className="icon-button danger-hover" aria-label={`撤销 ${item.email} 的邀请`} onClick={() => revokeMutation.mutate(item.id)}><Trash2 aria-hidden="true" size={14} /></button>
                </div>
              ))}
            </div>
          </section>
        ) : null}

        {transferMutation.data ? <div className="toast"><div><div className="text-sm font-semibold">所有权转让已发起</div><div className="mt-0.5 text-xs text-[var(--text-oninverse)] opacity-60">等待目标管理员通过邮件确认</div></div><Crown aria-hidden="true" size={17} /></div> : null}
      </div>
    </DocumentShell>
  );
}

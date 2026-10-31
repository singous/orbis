import { reportError } from "../../shared/api/request-feedback";
import { LoadingState } from "../../shared/ui/LoadingState";
import { Avatar } from "@heroui/react/avatar";
import { Tag } from "../../shared/ui/Tag";
import { ActionButton } from "../../shared/ui/ActionButton";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Crown, Mail, RefreshCw, Shield, Trash2, UserPlus, Users } from "../../shared/ui/icons";
import { type FormEvent, useState } from "react";
import { useStore } from "zustand";

import { authStore } from "../../shared/auth/auth-store";
import { useAuthRequest } from "../../shared/auth/use-auth-request";
import { Button } from "../../shared/ui/Button";
import { TextInput } from "../../shared/ui/TextInput";
import { SelectField } from "../../shared/ui/SelectField";

import { WorkspaceShell } from "../workspace/WorkspaceShell";
import { PageContainer } from "../../shared/ui/PageContainer";
import {
  getMailStatus,
  currentOwnership,
  resendOwnership,
  cancelOwnership,
  inviteMember,
  listInvitations,
  listMembers,
  removeMember,
  resendInvitation,
  revokeInvitation,
  startOwnershipTransfer,
  updateMemberRole,
} from "./api";

export function MemberSettingsPage() {
  const queryClient = useQueryClient();
  const auth = useAuthRequest();
  const workspace = useStore(authStore, (state) => state.workspace);
  const [memberPage, setMemberPage] = useState(1);
  const [invitationPage, setInvitationPage] = useState(1);
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<"admin" | "editor" | "viewer">("editor");
  const canManage = workspace?.role === "owner" || workspace?.role === "admin";
  const membersQuery = useQuery({ queryKey: ["members", memberPage], queryFn: () => listMembers(auth, memberPage) });
  const invitesQuery = useQuery({
    queryKey: ["invitations", invitationPage],
    queryFn: () => listInvitations(auth, invitationPage),
    enabled: canManage,
  });
  const mailQuery = useQuery({ queryKey: ["mail-status"], queryFn: () => getMailStatus(auth) });
  const ownershipQuery = useQuery({ queryKey: ["ownership-transfer"], queryFn: () => currentOwnership(auth), enabled: workspace?.role === "owner", retry: false });
  const refresh = () => Promise.all([
    queryClient.invalidateQueries({ queryKey: ["members"] }),
    queryClient.invalidateQueries({ queryKey: ["ownership-transfer"] }),
    queryClient.invalidateQueries({ queryKey: ["invitations"] }),
  ]);
  const notifyFailure = (error: unknown) => reportError(error);
  const invite = useMutation({
    mutationFn: () => inviteMember({ email, role }, auth),
    onSuccess: async () => { setEmail(""); await refresh();  },
    onError: notifyFailure,
  });
  const roleMutation = useMutation({
    mutationFn: ({ id, version, nextRole }: { id: string; version: number; nextRole: "admin" | "editor" | "viewer" }) => updateMemberRole(id, nextRole, version, auth),
    onSuccess: async () => { await refresh();  },
    onError: notifyFailure,
  });
  const removeMutation = useMutation({ mutationFn: ({ id, version }: { id: string; version: number }) => removeMember(id, version, auth), onSuccess: async () => { await refresh();  }, onError: notifyFailure });
  const revokeMutation = useMutation({ mutationFn: (id: string) => revokeInvitation(id, auth), onSuccess: async () => { await refresh();  }, onError: notifyFailure });
  const resendMutation = useMutation({ mutationFn: (id: string) => resendInvitation(id, auth), onSuccess: async () => { await refresh();  }, onError: notifyFailure });
  const transferMutation = useMutation({ mutationFn: (id: string) => startOwnershipTransfer(id, auth), onSuccess: async () => { await refresh();  }, onError: notifyFailure });
  const resendTransfer = useMutation({ mutationFn: (id: string) => resendOwnership(id, auth), onSuccess: refresh, onError: notifyFailure });
  const cancelTransfer = useMutation({ mutationFn: (id: string) => cancelOwnership(id, auth), onSuccess: refresh, onError: notifyFailure });
  const pendingInvitations = invitesQuery.data?.items.filter((item) => item.status === "pending") ?? [];

  function submitInvite(event: FormEvent) {
    event.preventDefault();
    if (email.trim()) invite.mutate();
  }

  function confirmRemove(memberId: string, version: number, emailAddress: string) {
    if (window.confirm(`确认移除 ${emailAddress}？该成员将立即失去工作空间访问权限。`)) {
      removeMutation.mutate({ id: memberId, version });
    }
  }

  function confirmTransfer(memberId: string) {
    if (window.confirm("确认发起所有权转让？你需要通过发送给当前所有者的邮件确认。")) {
      transferMutation.mutate(memberId);
    }
  }

  return (
    <WorkspaceShell>
      <PageContainer title="成员与权限" description="管理工作空间中的协作者与访问权限。">

        {canManage ? (
          <section className="workbench-member-invite">
            <div className="mb-5 flex items-center gap-3">
              <div className="document-icon"><UserPlus aria-hidden="true" size={18} /></div>
              <div><h2 className="text-base font-semibold">邀请成员</h2><p className="mt-1 text-xs text-[var(--muted)]">{mailQuery.data?.enabled ? "邀请链接会通过邮件发送。" : "当前邮件服务未启用，邀请发送不可用。"}</p></div>
            </div>
            <form className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_150px_auto] sm:items-end" onSubmit={submitInvite}>
              <TextInput label="邮箱" type="email" placeholder="member@example.com" value={email} onChange={(event) => setEmail(event.target.value)} />
              <SelectField label="角色" value={role} onChange={(next) => setRole(next as typeof role)} options={[...(workspace?.role === "owner" ? [{ value: "admin", label: "管理员" }] : []), { value: "editor", label: "编辑者" }, { value: "viewer", label: "只读成员" }]} />
              <Button type="submit" variant="primary" disabled={!mailQuery.data?.enabled || !email.trim() || invite.isPending} icon={<Mail aria-hidden="true" size={14} />}>发送邀请</Button>
            </form>
          </section>
        ) : null}

        <section className="mb-10">
          <div className="section-heading"><div><h2>工作空间成员</h2><p>{membersQuery.data?.pagination.total ?? 0} 位活跃成员</p></div></div>
          {membersQuery.isLoading ? <LoadingState label="正在加载成员…" /> : null}
          <div className="workbench-member-list">
            {membersQuery.data?.items.map((member) => {
              const actorCanChange = canManage && (workspace?.role === "owner" || member.role !== "admin");
              return (
                <div key={member.user_id} className="workbench-member-row">
                  <Avatar size="sm" className="h-9 w-9"><Avatar.Fallback>{(member.display_name || member.email).slice(0, 1).toUpperCase()}</Avatar.Fallback></Avatar>
                  <div className="min-w-[180px] flex-1"><div className="text-sm font-semibold">{member.display_name || member.email}</div><div className="mt-1 text-xs text-[var(--muted)]">{member.email}</div></div>
                  <div className="flex items-center gap-2">
                    {member.role === "owner" ? <Tag><Crown aria-hidden="true" className="mr-1" size={12} />所有者</Tag> : actorCanChange ? (
                      <SelectField aria-label={`调整 ${member.email} 的角色`} className="member-role-select" value={member.role} disabled={roleMutation.isPending} onChange={(nextRole) => roleMutation.mutate({ id: member.user_id, version: member.version, nextRole: nextRole as "admin" | "editor" | "viewer" })} options={[...(workspace?.role === "owner" ? [{ value: "admin", label: "管理员" }] : []), { value: "editor", label: "编辑者" }, { value: "viewer", label: "只读成员" }]} />
                    ) : <Tag><Shield aria-hidden="true" className="mr-1" size={12} />{member.role}</Tag>}
                    {workspace?.role === "owner" && member.role === "admin" ? <Button variant="secondary" onClick={() => confirmTransfer(member.user_id)} disabled={!mailQuery.data?.enabled || transferMutation.isPending}>转让所有权</Button> : null}
                    {member.role !== "owner" && actorCanChange ? <ActionButton type="button" className="icon-button danger-hover" aria-label={`移除 ${member.email}`} onClick={() => confirmRemove(member.user_id, member.version, member.email)}><Trash2 aria-hidden="true" size={14} /></ActionButton> : null}
                  </div>
                </div>
              );
            })}
          </div>
          <div className="collaboration-actions"><Button size="sm" disabled={memberPage <= 1 || membersQuery.isFetching} onClick={() => setMemberPage(value => value - 1)}>上一页成员</Button><span>第 {memberPage} 页</span><Button size="sm" disabled={!membersQuery.data?.pagination.has_next || membersQuery.isFetching} onClick={() => setMemberPage(value => value + 1)}>下一页成员</Button></div>
        </section>
        {workspace?.role === "owner" && ownershipQuery.data?.status === "pending" ? <section aria-label="待确认所有权转让"><h2>所有权转让待确认</h2><p>当前所有者通过邮件确认后，目标管理员成为所有者。</p><dl><dt>确认邮件</dt><dd>{ownershipQuery.data.email_sent ? "已发送" : "未发送"}</dd></dl><Button disabled={resendTransfer.isPending} onClick={() => resendTransfer.mutate(ownershipQuery.data!.id)}>重发所有权确认邮件</Button><Button disabled={cancelTransfer.isPending} onClick={() => cancelTransfer.mutate(ownershipQuery.data!.id)}>取消所有权转让</Button></section> : null}
        {canManage && (pendingInvitations.length || (invitesQuery.data?.pagination.total ?? 0) > 0) ? (
          <section>
            <div className="section-heading"><div><h2>待处理邀请</h2><p>过期后需要重新发送</p></div></div>
            <div className="workbench-member-list">
              {pendingInvitations.map((item) => (
                <div key={item.id} className="workbench-member-row">
                  <Users aria-hidden="true" size={18} className="text-[var(--muted)]" />
                  <div className="min-w-[200px] flex-1"><div className="text-sm font-semibold">{item.email}</div><div className="mt-1 text-xs text-[var(--muted)]">{item.role} · {item.email_sent ? "已发送" : "发送失败"}</div></div>
                  <ActionButton type="button" className="icon-button" aria-label={`重发 ${item.email}`} onClick={() => resendMutation.mutate(item.id)}><RefreshCw aria-hidden="true" size={14} /></ActionButton>
                  <ActionButton type="button" className="icon-button danger-hover" aria-label={`撤销 ${item.email} 的邀请`} onClick={() => revokeMutation.mutate(item.id)}><Trash2 aria-hidden="true" size={14} /></ActionButton>
                </div>
              ))}
            </div>
            <div className="collaboration-actions"><Button size="sm" disabled={invitationPage <= 1 || invitesQuery.isFetching} onClick={() => setInvitationPage(value => value - 1)}>上一页邀请</Button><span>第 {invitationPage} 页</span><Button size="sm" disabled={!invitesQuery.data?.pagination.has_next || invitesQuery.isFetching} onClick={() => setInvitationPage(value => value + 1)}>下一页邀请</Button></div>
          </section>
        ) : null}

      </PageContainer>
    </WorkspaceShell>
  );
}

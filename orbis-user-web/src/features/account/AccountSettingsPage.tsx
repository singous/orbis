import { UserRound } from "lucide-react";
import { useStore } from "zustand";

import { authStore } from "../../shared/auth/auth-store";
import { PageContainer } from "../../shared/ui/PageContainer";
import { WorkspaceShell } from "../workspace/WorkspaceShell";
import { workspaceRoleLabel } from "../workspace/capabilities";

export function AccountSettingsPage() {
  const user = useStore(authStore, (state) => state.user);
  const workspace = useStore(authStore, (state) => state.workspace);
  const values = [
    ["名称", user?.display_name || "未设置"],
    ["邮箱", user?.email || "未设置"],
    ["工作空间", workspace?.name || "私人工作空间"],
    ["角色", workspaceRoleLabel(workspace?.role)],
  ] as const;

  return (
    <WorkspaceShell>
      <PageContainer title="账号" description="当前登录账号与工作空间信息。">
        <section className="workbench-settings-section" aria-label="个人资料">
          <div className="workbench-profile">
            <span className="workbench-profile-avatar">{user?.display_name?.slice(0, 1) || <UserRound aria-hidden="true" size={24} />}</span>
            <div><h2>{user?.display_name || "我的账号"}</h2><p>{user?.email || "尚未设置邮箱"}</p></div>
          </div>
          <dl className="workbench-settings-list">
            {values.map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}
          </dl>
        </section>
      </PageContainer>
    </WorkspaceShell>
  );
}

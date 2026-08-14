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
      <PageContainer
        eyebrow="设置"
        title="账号"
        description="当前登录账号与工作空间信息。"
      >
        <dl className="overflow-hidden rounded-2xl border border-[var(--border)] bg-[var(--surface-content)]">
          {values.map(([label, value]) => (
            <div
              key={label}
              className="flex items-center justify-between gap-6 border-b border-[var(--border)] px-5 py-4 last:border-b-0"
            >
              <dt className="text-sm text-[var(--muted)]">{label}</dt>
              <dd className="text-right text-sm font-semibold">{value}</dd>
            </div>
          ))}
        </dl>
      </PageContainer>
    </WorkspaceShell>
  );
}

import { useStore } from "zustand";

import { DocumentShell } from "../documents/DocumentShell";
import { authStore } from "../../shared/auth/auth-store";

export function AccountSettingsPage() {
  const user = useStore(authStore, (state) => state.user);
  const workspace = useStore(authStore, (state) => state.workspace);
  const values = [
    ["名称", user?.display_name || "未设置"],
    ["邮箱", user?.email || "未设置"],
    ["工作空间", workspace?.name || "私人工作空间"],
    ["角色", workspace?.role || "member"],
  ] as const;
  return (
    <DocumentShell>
      <div className="mx-auto max-w-3xl px-5 py-8 lg:px-10 lg:py-10">
        <header className="mb-9">
          <div className="mb-2 text-xs font-semibold uppercase tracking-[0.18em] text-[var(--muted-light)]">
            Settings
          </div>
          <h1 className="text-4xl font-semibold tracking-[-0.045em] lg:text-5xl">
            账号
          </h1>
          <p className="mt-3 text-sm leading-6 text-[var(--muted)]">
            当前登录账号与工作空间信息。
          </p>
        </header>
        <dl className="overflow-hidden rounded-2xl border border-[var(--border)] bg-white">
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
      </div>
    </DocumentShell>
  );
}

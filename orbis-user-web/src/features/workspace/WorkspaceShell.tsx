import type { ReactNode } from "react";
import { PanelRightOpen } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { useStore } from "zustand";

import { authStore } from "../../shared/auth/auth-store";
import { BusinessRail } from "./BusinessRail";
import { DocumentFunctionMenu } from "./DocumentFunctionMenu";
import { UserMenu } from "./UserMenu";

export type WorkspaceShellProps = {
  children: ReactNode;
  toolbar?: ReactNode;
  contextPanel?: ReactNode;
  contextOpen?: boolean;
  onOpenContext?: () => void;
};

export function WorkspaceShell({ children, toolbar, contextPanel, contextOpen = true, onOpenContext }: WorkspaceShellProps) {
  const navigate = useNavigate();
  const user = useStore(authStore, (state) => state.user);
  const workspace = useStore(authStore, (state) => state.workspace);
  const clearSession = useStore(authStore, (state) => state.clearSession);

  function logout() {
    clearSession();
    navigate("/login", { replace: true });
  }

  return (
    <main className="workspace-shell">
      <div className="workspace-shell-grid">
        <BusinessRail />
        <DocumentFunctionMenu />
        <section className={`workspace-main-area ${contextPanel && contextOpen ? "has-context" : ""}`} aria-label="主工作区">
          <section className="workspace-content">
            <header className="workspace-toolbar">
              <div className="min-w-0 flex-1 text-sm text-[var(--muted)]">在线云文档</div>
              {contextPanel && onOpenContext ? <button type="button" aria-label="打开上下文面板" className="icon-button" onClick={onOpenContext}><PanelRightOpen aria-hidden="true" size={16} /></button> : null}
              {toolbar}
            </header>
            {children}
          </section>
          {contextPanel ? <aside className="workspace-context-panel" aria-label="上下文面板" hidden={!contextOpen}>{contextPanel}</aside> : null}
        </section>
      </div>
      <UserMenu user={user} workspace={workspace} onLogout={logout} />
    </main>
  );
}

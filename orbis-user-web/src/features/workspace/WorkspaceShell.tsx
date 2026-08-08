import type { ReactNode } from "react";
import { Menu, PanelRightOpen } from "lucide-react";
import { useEffect, useState } from "react";
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
  const [mainNavigationOpen, setMainNavigationOpen] = useState(false);
  const [documentContextOpen, setDocumentContextOpen] = useState(false);
  const [compact, setCompact] = useState(() => window.innerWidth < 1024);

  useEffect(() => {
    function updateCompact() {
      setCompact(window.innerWidth < 1024);
    }

    window.addEventListener("resize", updateCompact);
    return () => window.removeEventListener("resize", updateCompact);
  }, []);

  function logout() {
    clearSession();
    navigate("/login", { replace: true });
  }

  function openMainNavigation() {
    setMainNavigationOpen(true);
    setDocumentContextOpen(false);
  }

  function openDocumentContext() {
    onOpenContext?.();
    setDocumentContextOpen(true);
    setMainNavigationOpen(false);
  }

  function closeMainNavigationAfterLink(event: React.MouseEvent<HTMLDivElement>) {
    if (event.target instanceof Element && event.target.closest("a")) {
      setMainNavigationOpen(false);
    }
  }

  function closeDocumentContextAfterLink(event: React.MouseEvent<HTMLElement>) {
    if (event.target instanceof Element && event.target.closest("a")) {
      setDocumentContextOpen(false);
    }
  }

  return (
    <main className={`workspace-shell${mainNavigationOpen ? " main-navigation-open" : ""}${documentContextOpen ? " document-context-drawer-open" : ""}`}>
      <div className="workspace-shell-grid">
        <div className="workspace-main-navigation" onClick={closeMainNavigationAfterLink}>
          <BusinessRail />
          <DocumentFunctionMenu />
        </div>
        <section className={`workspace-main-area ${contextPanel && contextOpen ? "has-context" : ""}`} aria-label="主工作区">
          <section className="workspace-content">
            <header className="workspace-toolbar">
              <div className="flex min-w-0 flex-1 items-center gap-2 text-sm text-[var(--muted)]">
                <button type="button" aria-label="打开主导航" aria-expanded={mainNavigationOpen} className="workspace-mobile-drawer-control" onClick={openMainNavigation}><Menu aria-hidden="true" size={16} /></button>
                <span>在线云文档</span>
              </div>
              {contextPanel ? <button type="button" aria-label="打开文档目录" aria-expanded={documentContextOpen} className="workspace-mobile-drawer-control" onClick={openDocumentContext}><PanelRightOpen aria-hidden="true" size={16} /></button> : null}
              {contextPanel && onOpenContext ? <button type="button" aria-label="打开上下文面板" className="icon-button workspace-context-open-control" onClick={onOpenContext}><PanelRightOpen aria-hidden="true" size={16} /></button> : null}
              {toolbar}
            </header>
            {children}
          </section>
          {contextPanel ? <aside className="workspace-context-panel" aria-label="上下文面板" aria-hidden={compact ? !documentContextOpen : undefined} hidden={!contextOpen} onClick={closeDocumentContextAfterLink}>{contextPanel}</aside> : null}
        </section>
      </div>
      <UserMenu user={user} workspace={workspace} onLogout={logout} />
    </main>
  );
}

import type { ReactNode } from "react";
import { Menu, PanelRightOpen } from "lucide-react";
import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useStore } from "zustand";

import { authStore } from "../../shared/auth/auth-store";
import { BusinessRail } from "./BusinessRail";
import { UserMenu } from "./UserMenu";

export type WorkspaceShellProps = {
  children: ReactNode;
  sectionTitle?: ReactNode;
  sectionMenu?: ReactNode;
  toolbar?: ReactNode;
  contextPanel?: ReactNode;
  contextOpen?: boolean;
  onOpenContext?: () => void;
};

const compactNavigationQuery = "(max-width: 1023px)";

function useCompactNavigation(): boolean {
  const [compact, setCompact] = useState(() =>
    typeof window !== "undefined" && typeof window.matchMedia === "function"
      ? window.matchMedia(compactNavigationQuery).matches
      : false,
  );

  useEffect(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") return;

    const media = window.matchMedia(compactNavigationQuery);
    const updateCompact = () => setCompact(media.matches);
    updateCompact();
    media.addEventListener("change", updateCompact);
    return () => media.removeEventListener("change", updateCompact);
  }, []);

  return compact;
}

export function WorkspaceShell({ children, sectionTitle, sectionMenu, toolbar, contextPanel, contextOpen = true, onOpenContext }: WorkspaceShellProps) {
  const navigate = useNavigate();
  const user = useStore(authStore, (state) => state.user);
  const workspace = useStore(authStore, (state) => state.workspace);
  const clearSession = useStore(authStore, (state) => state.clearSession);
  const [mainNavigationOpen, setMainNavigationOpen] = useState(false);
  const [documentContextOpen, setDocumentContextOpen] = useState(false);
  const compact = useCompactNavigation();

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
    <main className={`workspace-shell${sectionMenu ? " has-section-menu" : ""}${mainNavigationOpen ? " main-navigation-open" : ""}${documentContextOpen ? " document-context-drawer-open" : ""}`}>
      <div className="workspace-shell-grid">
        <div className="workspace-main-navigation" aria-hidden={compact && !mainNavigationOpen ? true : undefined} inert={compact && !mainNavigationOpen ? true : undefined} onClick={closeMainNavigationAfterLink}>
          <BusinessRail />
          {sectionMenu}
        </div>
        <section className={`workspace-main-area ${contextPanel && contextOpen ? "has-context" : ""}`} aria-label="主工作区">
          <section className="workspace-content">
            <header className="workspace-toolbar">
              <div className="flex min-w-0 flex-1 items-center gap-2 text-sm text-[var(--muted)]">
                <button type="button" aria-label="打开主导航" aria-expanded={mainNavigationOpen} className="workspace-mobile-drawer-control" onClick={openMainNavigation}><Menu aria-hidden="true" size={16} /></button>
                {sectionTitle ? <span>{sectionTitle}</span> : null}
              </div>
              {contextPanel ? <button type="button" aria-label="打开文档目录" aria-expanded={documentContextOpen} className="workspace-mobile-drawer-control" onClick={openDocumentContext}><PanelRightOpen aria-hidden="true" size={16} /></button> : null}
              {contextPanel && onOpenContext ? <button type="button" aria-label="打开上下文面板" className="icon-button workspace-context-open-control" onClick={onOpenContext}><PanelRightOpen aria-hidden="true" size={16} /></button> : null}
              {toolbar}
            </header>
            {children}
          </section>
          {contextPanel ? <aside className="workspace-context-panel" aria-label="上下文面板" aria-hidden={compact && !documentContextOpen ? true : undefined} inert={compact && !documentContextOpen ? true : undefined} hidden={!contextOpen} onClick={closeDocumentContextAfterLink}>{contextPanel}</aside> : null}
        </section>
      </div>
      <UserMenu user={user} workspace={workspace} onLogout={logout} />
    </main>
  );
}

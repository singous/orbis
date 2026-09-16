import type { ReactNode } from "react";
import { ChevronsLeft, Menu, PanelRightOpen, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useLocation } from "react-router-dom";
import { useStore } from "zustand";

import { authStore } from "../../shared/auth/auth-store";
import { BusinessRail } from "./BusinessRail";
import { RailCreateMenu } from "./RailCreateMenu";
import { WorkspaceNavigation } from "./WorkspaceNavigation";
import { resolveWorkspaceArea } from "./workspace-areas";
import { WorkspaceTopbar } from "./WorkspaceTopbar";
import { canMutateWorkspaceContent } from "./capabilities";

export type WorkspaceShellProps = {
  children: ReactNode;
  sectionTitle?: ReactNode;
  sectionMenu?: ReactNode;
  toolbar?: ReactNode;
  contextPanel?: ReactNode;
  contextOpen?: boolean;
  onOpenContext?: () => void;
};

const compactNavigationQuery = "(max-width: 767px)";
const sidebarStorageKey = "orbis.sidebarCollapsed";

function useCompactNavigation(): boolean {
  const [compact, setCompact] = useState(() => typeof window.matchMedia === "function" && window.matchMedia(compactNavigationQuery).matches);
  useEffect(() => {
    if (typeof window.matchMedia !== "function") return;
    const media = window.matchMedia(compactNavigationQuery);
    const updateCompact = () => setCompact(media.matches);
    updateCompact();
    media.addEventListener("change", updateCompact);
    return () => media.removeEventListener("change", updateCompact);
  }, []);
  return compact;
}

export function WorkspaceShell({ children, sectionTitle, sectionMenu, toolbar, contextPanel, contextOpen = true, onOpenContext }: WorkspaceShellProps) {
  const { pathname } = useLocation();
  const area = resolveWorkspaceArea(pathname);
  const workspace = useStore(authStore, (state) => state.workspace);
  const accessToken = useStore(authStore, (state) => state.accessToken);
  const [mainNavigationOpen, setMainNavigationOpen] = useState(false);
  const [documentContextOpen, setDocumentContextOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(() => {
    try { return localStorage.getItem(sidebarStorageKey) === "1"; } catch { return false; }
  });
  const sidebarToggleRequested = useRef(false);
  const navigationRef = useRef<HTMLDivElement>(null);
  const contextRef = useRef<HTMLElement>(null);
  const menuTriggerRef = useRef<HTMLButtonElement>(null);
  const contextTriggerRef = useRef<HTMLButtonElement>(null);
  const compact = useCompactNavigation();
  const documentContextExpanded = documentContextOpen && contextOpen;
  const drawerOpen = compact && (mainNavigationOpen || documentContextExpanded);
  const sidebarHidden = !compact && collapsed;
  const showToolbar = compact || Boolean(sectionTitle) || Boolean(toolbar) || Boolean(contextPanel && onOpenContext);

  function changeCollapsed(next: boolean) {
    sidebarToggleRequested.current = true;
    setCollapsed(next);
    try { localStorage.setItem(sidebarStorageKey, next ? "1" : "0"); } catch { /* Navigation remains usable without storage. */ }
  }

  useEffect(() => {
    if (!sidebarToggleRequested.current || compact) return;
    sidebarToggleRequested.current = false;
    const label = collapsed ? "展开侧栏" : "收起侧栏";
    navigationRef.current?.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`)?.focus();
  }, [collapsed, compact]);

  useEffect(() => {
    if (!drawerOpen) return;
    const region = mainNavigationOpen ? navigationRef.current : contextRef.current;
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const focusable = () => Array.from(region?.querySelectorAll<HTMLElement>('a[href], button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex="0"]') ?? []).filter((element) => !element.closest("[hidden], [inert]"));
    focusable()[0]?.focus();
    function handleKey(event: KeyboardEvent) {
      if (event.defaultPrevented || (event.target instanceof Element && event.target.closest('[role="dialog"], [role="menu"]'))) return;
      if (event.key === "Escape") {
        setMainNavigationOpen(false);
        setDocumentContextOpen(false);
        event.preventDefault();
      }
      if (event.key === "Tab") {
        const items = focusable();
        const first = items[0];
        const last = items.at(-1);
        if (event.shiftKey && (document.activeElement === first || !region?.contains(document.activeElement))) { last?.focus(); event.preventDefault(); }
        else if (!event.shiftKey && (document.activeElement === last || !region?.contains(document.activeElement))) { first?.focus(); event.preventDefault(); }
      }
    }
    document.addEventListener("keydown", handleKey);
    return () => { document.removeEventListener("keydown", handleKey); previousFocus?.focus(); };
  }, [drawerOpen, mainNavigationOpen]);

  function closeAfterLink(event: React.MouseEvent<HTMLElement>) {
    if (event.target instanceof Element && event.target.closest("a")) {
      setMainNavigationOpen(false);
      setDocumentContextOpen(false);
    }
  }

  return (
    <main className={`workspace-shell has-section-menu${sidebarHidden ? " sidebar-collapsed" : ""}${mainNavigationOpen ? " main-navigation-open" : ""}${documentContextExpanded ? " document-context-drawer-open" : ""}`}>
      <WorkspaceTopbar disabled={drawerOpen} />
      <div className="workspace-shell-grid">
        {drawerOpen ? <button type="button" className="workspace-drawer-backdrop" aria-label={mainNavigationOpen ? "关闭主导航" : "关闭文档目录"} onClick={() => { setMainNavigationOpen(false); setDocumentContextOpen(false); }} /> : null}
        <div ref={navigationRef} className="workspace-main-navigation" aria-hidden={compact && !mainNavigationOpen ? true : undefined} inert={compact && !mainNavigationOpen ? true : undefined} onClick={closeAfterLink}>
          <BusinessRail collapsed={sidebarHidden} onExpand={() => changeCollapsed(false)} />
          <section id="workspace-sidebar" className="workspace-sidebar" hidden={sidebarHidden} aria-label="侧栏">
            <header className="workspace-sidebar-header">
              <h2>{area.title}</h2>
              <button type="button" className="sidebar-collapse" aria-label="收起侧栏" aria-expanded="true" aria-controls="workspace-sidebar" onClick={() => changeCollapsed(true)}><ChevronsLeft size={18} /></button>
              {area.id === "documents" && accessToken && canMutateWorkspaceContent(workspace) ? <RailCreateMenu /> : null}
              <button type="button" className="sidebar-mobile-close" aria-label="关闭侧栏" onClick={() => setMainNavigationOpen(false)}><X size={18} /></button>
            </header>
            {sectionMenu ?? (accessToken ? <WorkspaceNavigation /> : null)}
          </section>
        </div>
        <section className={`workspace-main-area${contextPanel && contextOpen ? " has-context" : ""}`} aria-label="主工作区">
          <section className="workspace-content" inert={drawerOpen ? true : undefined}>
            {showToolbar ? (
              <header className="workspace-toolbar">
                <button ref={menuTriggerRef} type="button" aria-label="打开主导航" aria-expanded={mainNavigationOpen} className="workspace-mobile-drawer-control" onClick={() => { setMainNavigationOpen(true); setDocumentContextOpen(false); }}><Menu aria-hidden="true" size={18} /></button>
                {sectionTitle ? <span className="workspace-toolbar-title">{sectionTitle}</span> : <span className="workspace-toolbar-spacer" />}
                <div className="workspace-toolbar-actions">{toolbar}</div>
                {contextPanel ? <button ref={contextTriggerRef} type="button" aria-label="打开文档目录" aria-expanded={documentContextExpanded} className="workspace-mobile-drawer-control" onClick={() => { onOpenContext?.(); setDocumentContextOpen(true); setMainNavigationOpen(false); }}><PanelRightOpen aria-hidden="true" size={18} /></button> : null}
                {contextPanel && onOpenContext ? <button type="button" aria-label="打开上下文面板" className="icon-button workspace-context-open-control" onClick={onOpenContext}><PanelRightOpen aria-hidden="true" size={16} /></button> : null}
              </header>
            ) : null}
            {children}
          </section>
          {contextPanel ? <aside ref={contextRef} className="workspace-context-panel" aria-label="上下文面板" aria-hidden={compact && !documentContextExpanded ? true : undefined} inert={compact && !documentContextExpanded ? true : undefined} hidden={!contextOpen} onClick={closeAfterLink}>{contextPanel}</aside> : null}
        </section>
      </div>
    </main>
  );
}

import { ActionButton } from "../../shared/ui/ActionButton";
import type { CSSProperties, ReactNode } from "react";
import { Menu, PanelRightOpen } from "../../shared/ui/icons";
import { useEffect, useRef, useState } from "react";
import { useLocation } from "react-router-dom";
import { useStore } from "zustand";

import { authStore } from "../../shared/auth/auth-store";
import { getAppSurface } from "../../shared/platform/app-surface";
import { SearchPaletteProvider, useSearchPalette } from "../search/search-palette-context";
import { SidebarResizeHandle } from "./SidebarResizeHandle";
import { useSidebarResize } from "./use-sidebar-resize";
import { WorkspaceSidebar } from "./WorkspaceSidebar";
import { useWorkspaceSidebar } from "./use-workspace-sidebar";
import { DEFAULT_SIDEBAR_PREFERENCES, SIDEBAR_MOTION_DURATION_MS, SIDEBAR_MOTION_EASING, type WorkspaceSidebarConfig } from "./workspace-sidebar-config";
import { BusinessRail } from "./BusinessRail";
import { RailCreateMenu } from "./RailCreateMenu";
import { WorkspaceNavigation } from "./WorkspaceNavigation";
import { resolveWorkspaceArea } from "./workspace-areas";
import { WorkspaceTopbar } from "./WorkspaceTopbar";
import { canMutateWorkspaceContent } from "./capabilities";
import { useWorkspaceSearch } from "./use-workspace-search";

export type { WorkspaceSidebarConfig } from "./workspace-sidebar-config";

export type WorkspaceShellProps = {
  children: ReactNode;
  sectionTitle?: ReactNode;
  sidebar?: WorkspaceSidebarConfig | false;
  toolbar?: ReactNode;
  contentLayout?: "page" | "document";
  contextPanel?: ReactNode;
  contextOpen?: boolean;
  onOpenContext?: () => void;
};

const compactNavigationQuery = "(max-width: 767px)";

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

export function WorkspaceShell(props: WorkspaceShellProps) {
  return <SearchPaletteProvider><WorkspaceShellContent {...props} /></SearchPaletteProvider>;
}

function WorkspaceShellContent({ children, sectionTitle, sidebar, toolbar, contentLayout = "page", contextPanel, contextOpen = true, onOpenContext }: WorkspaceShellProps) {
  const { isOpen: searchOpen } = useSearchPalette();
  const searchOpenRef = useRef(searchOpen);
  searchOpenRef.current = searchOpen;
  const [surface] = useState(getAppSurface);
  const { pathname } = useLocation();
  const area = resolveWorkspaceArea(pathname);
  const workspace = useStore(authStore, (state) => state.workspace);
  const accessToken = useStore(authStore, (state) => state.accessToken);
  const canCreate = Boolean(accessToken && canMutateWorkspaceContent(workspace));
  const [mainNavigationOpen, setMainNavigationOpen] = useState(false);
  const [documentContextOpen, setDocumentContextOpen] = useState(false);
  const navigationRef = useRef<HTMLDivElement>(null);
  const gridRef = useRef<HTMLDivElement>(null);
  const contextRef = useRef<HTMLElement>(null);
  const menuTriggerRef = useRef<HTMLButtonElement>(null);
  const contextTriggerRef = useRef<HTMLButtonElement>(null);
  const compact = useCompactNavigation();
  const documentContextExpanded = documentContextOpen && contextOpen;
  const drawerOpen = compact && (mainNavigationOpen || documentContextExpanded);
  useWorkspaceSearch(drawerOpen);
  const sidebarConfig: WorkspaceSidebarConfig | false = sidebar ?? (area.showFunctionSidebar ? { title: <h2>{area.title}</h2>, content: accessToken ? <WorkspaceNavigation /> : null } : false);
  const showFunctionSidebar = Boolean(sidebarConfig && (compact || sidebarConfig.desktopVisible !== false));
  const preferences = sidebarConfig ? sidebarConfig.preferences ?? DEFAULT_SIDEBAR_PREFERENCES : DEFAULT_SIDEBAR_PREFERENCES;
  const sidebarScope = `${workspace?.id ?? ""}:${pathname}:${sidebarConfig ? sidebarConfig.id ?? "workspace-sidebar" : "rail"}`;
  const { collapsed, animating, changeCollapsed } = useWorkspaceSidebar(sidebarScope, compact, navigationRef);
  const sidebarHidden = !showFunctionSidebar || (!compact && collapsed);
  const sidebarResizeEnabled = showFunctionSidebar && !compact && !collapsed;
  const sidebarResize = useSidebarResize(gridRef, sidebarResizeEnabled, Boolean(contextPanel && contextOpen), preferences);
  const shellStyle: CSSProperties & { "--sidebar-transition-duration": string; "--sidebar-transition-easing": string } = {
    ...sidebarResize.style,
    "--sidebar-transition-duration": `${SIDEBAR_MOTION_DURATION_MS}ms`,
    "--sidebar-transition-easing": SIDEBAR_MOTION_EASING,
  };
  const showToolbar = compact || Boolean(sectionTitle) || Boolean(toolbar) || Boolean(contextPanel && onOpenContext);

  useEffect(() => {
    if (!drawerOpen) return;
    const region = mainNavigationOpen ? navigationRef.current : contextRef.current;
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const focusable = () => Array.from(region?.querySelectorAll<HTMLElement>('a[href], button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex="0"]') ?? []).filter((element) => !element.closest("[hidden], [inert]") && getComputedStyle(element).display !== "none" && getComputedStyle(element).visibility !== "hidden");
    focusable()[0]?.focus();
    const inNestedOverlay = (event: KeyboardEvent) => event.target instanceof Element && Boolean(event.target.closest('[role="dialog"], [role="alertdialog"], [role="menu"], [role="listbox"]'));
    // Tooltip/focusable controls stop React keyboard propagation. Capture only
    // drawer dismissal, yielding to functional overlays and input composition.
    function handleEscape(event: KeyboardEvent) {
      if (event.key !== "Escape" || searchOpenRef.current || event.defaultPrevented || event.isComposing || inNestedOverlay(event)) return;
      setMainNavigationOpen(false);
      setDocumentContextOpen(false);
      event.preventDefault();
    }
    function handleKey(event: KeyboardEvent) {
      if (searchOpenRef.current || event.defaultPrevented || inNestedOverlay(event)) return;
      if (event.key === "Tab") {
        const items = focusable();
        const first = items[0];
        const last = items.at(-1);
        if (event.shiftKey && (document.activeElement === first || !region?.contains(document.activeElement))) { last?.focus(); event.preventDefault(); }
        else if (!event.shiftKey && (document.activeElement === last || !region?.contains(document.activeElement))) { first?.focus(); event.preventDefault(); }
      }
    }
    document.addEventListener("keydown", handleEscape, true);
    document.addEventListener("keydown", handleKey);
    return () => { document.removeEventListener("keydown", handleEscape, true); document.removeEventListener("keydown", handleKey); if (previousFocus?.isConnected) previousFocus.focus({ preventScroll: true }); };
  }, [drawerOpen, mainNavigationOpen]);

  function closeAfterLink(event: React.MouseEvent<HTMLElement>) {
    if (event.target instanceof Element && event.target.closest("a")) {
      setMainNavigationOpen(false);
      setDocumentContextOpen(false);
    }
  }

  return (
    <main data-app-surface={surface} style={shellStyle} className={`workspace-shell${showFunctionSidebar ? " has-section-menu" : " sidebar-unavailable"}${sidebarHidden ? " sidebar-collapsed" : ""}${animating ? " sidebar-animating" : ""}${mainNavigationOpen ? " main-navigation-open" : ""}${documentContextExpanded ? " document-context-drawer-open" : ""}`}>
      {surface === "desktop" ? <WorkspaceTopbar disabled={drawerOpen} /> : null}
      <div ref={gridRef} className="workspace-shell-grid">
        {drawerOpen ? <ActionButton type="button" className="workspace-drawer-backdrop" aria-label={mainNavigationOpen ? "关闭主导航" : "关闭文档目录"} onClick={() => { setMainNavigationOpen(false); setDocumentContextOpen(false); }} /> : null}
        <div ref={navigationRef} className="workspace-main-navigation" aria-hidden={compact && !mainNavigationOpen ? true : undefined} inert={compact && !mainNavigationOpen ? true : undefined} onClick={closeAfterLink}>
          <BusinessRail surface={surface} createMenu={canCreate ? <RailCreateMenu /> : undefined} collapsed={showFunctionSidebar && sidebarHidden} expandLabel={sidebarConfig ? sidebarConfig.expandLabel : undefined} onExpand={() => changeCollapsed(false)} onClose={compact && !showFunctionSidebar ? () => setMainNavigationOpen(false) : undefined} />
          {showFunctionSidebar && sidebarConfig ? <WorkspaceSidebar config={sidebarConfig} hidden={sidebarHidden} onCollapse={() => changeCollapsed(true)} onClose={() => setMainNavigationOpen(false)} /> : null}
        </div>
        {sidebarResizeEnabled ? <SidebarResizeHandle {...sidebarResize} label={sidebarConfig ? sidebarConfig.resizeLabel : undefined} controls={sidebarConfig && sidebarConfig.id ? sidebarConfig.id : "workspace-sidebar"} /> : null}
        <section className={`workspace-main-area${contextPanel && contextOpen ? " has-context" : ""}`} aria-label="主工作区">
          <section className={`workspace-content${contentLayout === "document" ? " workspace-document-content" : ""}`} inert={drawerOpen ? true : undefined}>
            {showToolbar ? (
              <header className="workspace-toolbar">
                <ActionButton ref={menuTriggerRef} type="button" aria-label="打开主导航" aria-expanded={mainNavigationOpen} className="workspace-mobile-drawer-control" onClick={() => { setMainNavigationOpen(true); setDocumentContextOpen(false); }}><Menu aria-hidden="true" size={18} /></ActionButton>
                {sectionTitle ? <span className="workspace-toolbar-title">{sectionTitle}</span> : <span className="workspace-toolbar-spacer" />}
                <div className="workspace-toolbar-actions">{toolbar}</div>
                {contextPanel ? <ActionButton ref={contextTriggerRef} type="button" aria-label="打开文档目录" aria-expanded={documentContextExpanded} className="workspace-mobile-drawer-control" onClick={() => { onOpenContext?.(); setDocumentContextOpen(true); setMainNavigationOpen(false); }}><PanelRightOpen aria-hidden="true" size={18} /></ActionButton> : null}
                {contextPanel && onOpenContext ? <ActionButton type="button" aria-label="打开上下文面板" className="icon-button workspace-context-open-control" onClick={onOpenContext}><PanelRightOpen aria-hidden="true" size={16} /></ActionButton> : null}
              </header>
            ) : null}
            <div key={pathname} className="workspace-route-content">{children}</div>
          </section>
          {contextPanel ? <aside ref={contextRef} className="workspace-context-panel" aria-label="上下文面板" aria-hidden={compact && !documentContextExpanded ? true : undefined} inert={compact && !documentContextExpanded ? true : undefined} hidden={!contextOpen} onClick={closeAfterLink}>{contextPanel}</aside> : null}
        </section>
      </div>
    </main>
  );
}

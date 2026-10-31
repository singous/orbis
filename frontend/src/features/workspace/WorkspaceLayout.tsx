import { useRef, useState, type CSSProperties } from "react";
import type { WorkspaceShellProps } from "./workspace-layout";
import { ActionButton } from "../../shared/ui/ActionButton";
import { Menu, PanelRightOpen } from "../../shared/ui/icons";
import { useLocation } from "react-router-dom";
import { useStore } from "zustand";

import { authStore } from "../../shared/auth/auth-store";
import { getAppSurface } from "../../shared/platform/app-surface";
import { useCompactNavigation } from "../../shared/platform/use-compact-navigation";
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
import { useWorkspaceDrawers } from "./use-workspace-drawers";
import { useWorkspaceSearch } from "./use-workspace-search";

export function WorkspaceLayout({ children, sectionTitle, sidebar, toolbar, contentLayout = "page", contextPanel, contextOpen = true, onOpenContext }: WorkspaceShellProps) {
  const [surface] = useState(getAppSurface);
  const { pathname } = useLocation();
  const area = resolveWorkspaceArea(pathname);
  const workspace = useStore(authStore, (state) => state.workspace);
  const accessToken = useStore(authStore, (state) => state.accessToken);
  const canCreate = Boolean(accessToken && canMutateWorkspaceContent(workspace));
  const gridRef = useRef<HTMLDivElement>(null);
  const compact = useCompactNavigation();
  const { mainNavigationOpen, setMainNavigationOpen, setDocumentContextOpen, documentContextExpanded,
    drawerOpen, navigationRef, contextRef, contentScrollRef, closeAfterLink } = useWorkspaceDrawers(compact, contextOpen);
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


  return (
    <main data-app-surface={surface} style={shellStyle} className={`workspace-shell${showFunctionSidebar ? " has-section-menu" : " sidebar-unavailable"}${sidebarHidden ? " sidebar-collapsed" : ""}${animating ? " sidebar-animating" : ""}${mainNavigationOpen ? " main-navigation-open" : ""}${documentContextExpanded ? " document-context-drawer-open" : ""}`}>
      <a className="workspace-skip-link" href="#workspace-main-content" inert={drawerOpen ? true : undefined}>跳转到主内容</a>
      {surface === "desktop" ? <WorkspaceTopbar disabled={drawerOpen} /> : null}
      <div ref={gridRef} className="workspace-shell-grid">
        {drawerOpen ? <ActionButton type="button" className="workspace-drawer-backdrop" aria-label={mainNavigationOpen ? "关闭主导航" : "关闭文档目录"} onClick={() => { setMainNavigationOpen(false); setDocumentContextOpen(false); }} /> : null}
        <div ref={navigationRef} className="workspace-main-navigation" aria-hidden={compact && !mainNavigationOpen ? true : undefined} inert={compact && !mainNavigationOpen ? true : undefined} onClick={closeAfterLink}>
          <BusinessRail surface={surface} createMenu={canCreate ? <RailCreateMenu /> : undefined} collapsed={showFunctionSidebar && sidebarHidden} expandLabel={sidebarConfig ? sidebarConfig.expandLabel : undefined} onExpand={() => changeCollapsed(false)} onClose={compact && !showFunctionSidebar ? () => setMainNavigationOpen(false) : undefined} />
          {showFunctionSidebar && sidebarConfig ? <WorkspaceSidebar
            config={sidebarConfig}
            hidden={sidebarHidden}
            onCollapse={() => changeCollapsed(true)}
            onClose={() => setMainNavigationOpen(false)}
            resizeHandle={sidebarResizeEnabled ? <SidebarResizeHandle {...sidebarResize} label={sidebarConfig.resizeLabel} controls={sidebarConfig.id ?? "workspace-sidebar"} /> : undefined}
          /> : null}
        </div>
        <section className={`workspace-main-area${contentLayout === "document" ? " workspace-main-area-panel" : ""}${contextPanel && contextOpen ? " has-context" : ""}`} aria-label="主工作区">
          <section ref={contentScrollRef} className={`workspace-content${contentLayout === "document" ? " workspace-document-content" : ""}`} inert={drawerOpen ? true : undefined}>
            {showToolbar ? (
              <header className="workspace-toolbar">
                <ActionButton type="button" aria-label="打开主导航" aria-expanded={mainNavigationOpen} className="workspace-mobile-drawer-control" onClick={() => { setMainNavigationOpen(true); setDocumentContextOpen(false); }}><Menu aria-hidden="true" size={18} /></ActionButton>
                {sectionTitle ? <span className="workspace-toolbar-title">{sectionTitle}</span> : <span className="workspace-toolbar-spacer" />}
                <div className="workspace-toolbar-actions">{toolbar}</div>
                {contextPanel ? <ActionButton type="button" aria-label="打开文档目录" aria-expanded={documentContextExpanded} className="workspace-mobile-drawer-control" onClick={() => { onOpenContext?.(); setDocumentContextOpen(true); setMainNavigationOpen(false); }}><PanelRightOpen aria-hidden="true" size={18} /></ActionButton> : null}
                {contextPanel && onOpenContext ? <ActionButton type="button" aria-label="打开上下文面板" className="icon-button workspace-context-open-control" onClick={onOpenContext}><PanelRightOpen aria-hidden="true" size={16} /></ActionButton> : null}
              </header>
            ) : null}
            <div id="workspace-main-content" tabIndex={-1} className="workspace-route-content">{children}</div>
          </section>
          {contextPanel ? <aside ref={contextRef} className="workspace-context-panel" aria-label="上下文面板" aria-hidden={compact && !documentContextExpanded ? true : undefined} inert={compact && !documentContextExpanded ? true : undefined} hidden={!contextOpen} onClick={closeAfterLink}>{contextPanel}</aside> : null}
        </section>
      </div>
    </main>
  );
}

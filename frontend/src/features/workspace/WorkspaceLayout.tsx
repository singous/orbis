import { Button } from "@orbis/ui/button";
import { mobileDrawerControlClassName, workspaceContentClassName, workspaceGridClassName, workspaceMainAreaClassName, workspaceMainNavigationClassName, workspaceRouteClassName, workspaceShellClassName, workspaceToolbarClassName } from "./workspace-chrome";
import { useRef, useState, type CSSProperties } from "react";
import type { WorkspaceShellProps } from "./workspace-layout";
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
    <main data-app-surface={surface} style={shellStyle} className={`${workspaceShellClassName}${showFunctionSidebar ? " has-section-menu" : " sidebar-unavailable"}${sidebarHidden ? " sidebar-collapsed" : ""}${animating ? " sidebar-animating" : ""}${mainNavigationOpen ? " main-navigation-open" : ""}${documentContextExpanded ? " document-context-drawer-open" : ""}`}>
      <a className="workspace-skip-link focus-ring fixed top-3 left-3 z-(--ob-z-popover) flex min-h-(--ob-control-height-md) -translate-y-[calc(100%+16px)] items-center rounded-lg bg-primary px-4 py-2 text-primary-foreground focus-visible:translate-y-0" href="#workspace-main-content" inert={drawerOpen ? true : undefined}>跳转到主内容</a>
      {surface === "desktop" ? <WorkspaceTopbar disabled={drawerOpen} /> : null}
      <div ref={gridRef} className={workspaceGridClassName}>
        {drawerOpen ? <button type="button" className="workspace-drawer-backdrop hidden bg-black/10 max-[768px]:fixed max-[768px]:inset-x-0 max-[768px]:top-(--topbar-height) max-[768px]:bottom-0 max-[768px]:z-40 max-[768px]:block" aria-label={mainNavigationOpen ? "关闭主导航" : "关闭文档目录"} onClick={() => { setMainNavigationOpen(false); setDocumentContextOpen(false); }} /> : null}
        <div ref={navigationRef} className={workspaceMainNavigationClassName} aria-hidden={compact && !mainNavigationOpen ? true : undefined} inert={compact && !mainNavigationOpen ? true : undefined} onClick={closeAfterLink}>
          <BusinessRail surface={surface} createMenu={canCreate ? <RailCreateMenu /> : undefined} collapsed={showFunctionSidebar && sidebarHidden} expandLabel={sidebarConfig ? sidebarConfig.expandLabel : undefined} onExpand={() => changeCollapsed(false)} onClose={compact && !showFunctionSidebar ? () => setMainNavigationOpen(false) : undefined} />
          {showFunctionSidebar && sidebarConfig ? <WorkspaceSidebar
            config={sidebarConfig}
            hidden={sidebarHidden}
            onCollapse={() => changeCollapsed(true)}
            onClose={() => setMainNavigationOpen(false)}
            resizeHandle={sidebarResizeEnabled ? <SidebarResizeHandle {...sidebarResize} label={sidebarConfig.resizeLabel} controls={sidebarConfig.id ?? "workspace-sidebar"} /> : undefined}
          /> : null}
        </div>
        <section className={`${workspaceMainAreaClassName}${contentLayout === "document" ? " workspace-main-area-panel" : ""}${contextPanel && contextOpen ? " has-context" : ""}`} aria-label="主工作区">
          <section ref={contentScrollRef} className={`${workspaceContentClassName}${contentLayout === "document" ? " workspace-document-content" : ""}`} inert={drawerOpen ? true : undefined}>
            {showToolbar ? (
              <header className={workspaceToolbarClassName}>
                <Button type="button" aria-label="打开主导航" aria-expanded={mainNavigationOpen} size="icon" className={mobileDrawerControlClassName} onClick={() => { setMainNavigationOpen(true); setDocumentContextOpen(false); }} variant="ghost"><Menu aria-hidden="true" size={18} /></Button>
                {sectionTitle ? <span className="workspace-toolbar-title flex-1 text-xs text-(--muted-foreground) in-[.workspace-document-content]:min-w-0">{sectionTitle}</span> : <span className="workspace-toolbar-spacer flex-1" />}
                <div className="workspace-toolbar-actions flex min-w-0 flex-wrap items-center gap-2 max-[768px]:gap-[5px] in-[.workspace-document-content]:flex-none in-[.workspace-document-content]:flex-nowrap">{toolbar}</div>
                {contextPanel ? <Button type="button" aria-label="打开文档目录" aria-expanded={documentContextExpanded} size="icon" className={mobileDrawerControlClassName} onClick={() => { onOpenContext?.(); setDocumentContextOpen(true); setMainNavigationOpen(false); }} variant="ghost"><PanelRightOpen aria-hidden="true" size={18} /></Button> : null}
                {contextPanel && onOpenContext ? <Button type="button" aria-label="打开上下文面板" size="icon" className="workspace-context-open-control max-[768px]:hidden" onClick={onOpenContext} variant="ghost"><PanelRightOpen aria-hidden="true" size={16} /></Button> : null}
              </header>
            ) : null}
            <div id="workspace-main-content" tabIndex={-1} className={workspaceRouteClassName}>{children}</div>
          </section>
          {contextPanel ? <aside ref={contextRef} className="workspace-context-panel min-h-0 min-w-0 overflow-auto border-l border-border bg-card max-[768px]:hidden max-[768px]:in-[.document-context-drawer-open]:[&:not([hidden])]:fixed max-[768px]:in-[.document-context-drawer-open]:[&:not([hidden])]:top-(--topbar-height) max-[768px]:in-[.document-context-drawer-open]:[&:not([hidden])]:right-1.5 max-[768px]:in-[.document-context-drawer-open]:[&:not([hidden])]:bottom-1.5 max-[768px]:in-[.document-context-drawer-open]:[&:not([hidden])]:z-[45] max-[768px]:in-[.document-context-drawer-open]:[&:not([hidden])]:block max-[768px]:in-[.document-context-drawer-open]:[&:not([hidden])]:w-[min(310px,calc(100vw-35px))] max-[768px]:in-[.document-context-drawer-open]:[&:not([hidden])]:rounded-[10px] max-[768px]:in-[.document-context-drawer-open]:[&:not([hidden])]:border max-[768px]:in-[.document-context-drawer-open]:[&:not([hidden])]:border-ring max-[768px]:in-[.document-context-drawer-open]:[&:not([hidden])]:shadow-[-10px_0_40px_var(--ob-workspace-drawer-shadow-color)]" aria-label="上下文面板" aria-hidden={compact && !documentContextExpanded ? true : undefined} inert={compact && !documentContextExpanded ? true : undefined} hidden={!contextOpen} onClick={closeAfterLink}>{contextPanel}</aside> : null}
        </section>
      </div>
    </main>
  );
}

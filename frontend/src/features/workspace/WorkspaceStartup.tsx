import { cn } from "@orbis/ui/cn";
import { loadingLineClassName } from "../../shared/ui/LoadingState";
import { workspaceContentClassName, workspaceGridClassName, workspaceMainAreaClassName, workspaceMainNavigationClassName, workspaceRailClassName, workspaceRouteClassName, workspaceShellClassName, workspaceToolbarClassName, workspaceTopbarClassName } from "./workspace-chrome";
import { Skeleton } from "@orbis/ui/skeleton";
import { matchPath, useLocation } from "react-router-dom";
import { getAppSurface } from "../../shared/platform/app-surface";
import { resolveWorkspaceArea, usesDocumentPageLayout } from "./workspace-areas";
import { WorkspaceLoadingContent } from "./WorkspaceLoadingContent";

/** Lightweight chrome placeholder; keep workspace queries and actions lazy. */
export function WorkspaceStartup() {
  const { pathname } = useLocation();
  const area = resolveWorkspaceArea(pathname);
  const sidebar = area.showFunctionSidebar;
  const surface = getAppSurface();
  return <main data-app-surface={surface} data-document-navigation={area.id === "documents" || undefined} data-document-surface={usesDocumentPageLayout(pathname) || undefined} data-notebook-navigation={Boolean(matchPath("/collections/:collectionId", pathname)) || undefined} aria-busy="true" className={`${workspaceShellClassName} workspace-startup motion-reduce:[&_.skeleton]:animate-none${sidebar ? " has-section-menu" : " sidebar-unavailable sidebar-collapsed"}`}>
    {surface === "desktop" && <div className={workspaceTopbarClassName} aria-hidden="true"><Skeleton className={cn(loadingLineClassName, "loading-line--short w-[64%]")} /></div>}
    <div className={workspaceGridClassName}>
      <div className={workspaceMainNavigationClassName} aria-hidden="true">
        <div className={cn(workspaceRailClassName, "workspace-startup-rail gap-4 [&>.workspace-startup-icon:first-child]:mb-6")}>
          {[0, 1, 2, 3, 4].map(item => <Skeleton key={item} className="workspace-startup-icon size-(--ob-control-height-sm) flex-none rounded-sm" />)}
        </div>
        {sidebar && <div className="workspace-sidebar workspace-startup-sidebar relative flex min-h-0 min-w-0 flex-1 flex-col gap-6 px-3 py-4">
          <Skeleton className={cn(loadingLineClassName, "loading-line--short w-[64%]")} />
          {[0, 1, 2, 3, 4].map(item => <Skeleton key={item} className={loadingLineClassName} />)}
        </div>}
      </div>
      <section className={workspaceMainAreaClassName} aria-label="主工作区">
        <section className={workspaceContentClassName}>
          <div className={cn(workspaceToolbarClassName, "workspace-startup-toolbar hidden max-[768px]:flex")} aria-hidden="true"><Skeleton className="workspace-startup-icon size-(--ob-control-height-sm) flex-none rounded-sm" /></div>
          <div className={workspaceRouteClassName}><WorkspaceLoadingContent /></div>
        </section>
      </section>
    </div>
  </main>;
}

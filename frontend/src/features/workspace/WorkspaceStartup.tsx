import { cn } from "@orbis/ui/cn";
import { workspaceContentClassName, workspaceGridClassName, workspaceMainAreaClassName, workspaceMainNavigationClassName, workspaceRailClassName, workspaceRouteClassName, workspaceShellClassName, workspaceToolbarClassName } from "./workspace-chrome";
import { Button } from "@orbis/ui/button";
import { Menu } from "@orbis/ui/icons";
import { getAppSurface } from "../../shared/platform/app-surface";
import { WorkspaceLoadingContent, type WorkspaceLoadingKind } from "./WorkspaceLoadingContent";
import { documentPendingChrome } from "../documents/DocumentPending";

/** Lightweight chrome placeholder; keep workspace queries and actions lazy. */
export function WorkspaceStartup({ loadingKind }: { loadingKind?: WorkspaceLoadingKind }) {
  const surface = getAppSurface();
  const isDocument = loadingKind === "document";
  return <main data-app-surface={surface} data-notebook-navigation={loadingKind === "notebook" || undefined} aria-busy="true" className={`${workspaceShellClassName} workspace-startup has-section-menu motion-reduce:[&_.skeleton]:animate-none`}>
    <div className={workspaceGridClassName}>
      <div className={workspaceMainNavigationClassName} aria-hidden="true">
        <div className={workspaceRailClassName} />
        <div className="workspace-sidebar flex min-h-0 min-w-0 flex-1" />
      </div>
      <section className={workspaceMainAreaClassName} aria-label="主工作区">
        <section className={cn(workspaceContentClassName, isDocument && "workspace-document-content")}>
          <div className={cn(workspaceToolbarClassName, "workspace-startup-toolbar", !isDocument && "hidden max-[768px]:flex")} data-document-editor={isDocument || undefined}>
            <Button disabled size="icon" variant="ghost" aria-label="打开主导航" className={cn("flex-none", isDocument && "hidden max-[768px]:inline-flex")}><Menu aria-hidden="true" size={18} /></Button>
            {isDocument ? <><div className="min-w-0 flex-1">{documentPendingChrome.sectionTitle}</div>{documentPendingChrome.toolbar}</> : null}
          </div>
          <div className={workspaceRouteClassName}><WorkspaceLoadingContent loadingKind={loadingKind} /></div>
        </section>
      </section>
    </div>
  </main>;
}

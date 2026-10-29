import { Skeleton } from "@heroui/react/skeleton";
import { useLocation } from "react-router-dom";
import { getAppSurface } from "../../shared/platform/app-surface";
import { resolveWorkspaceArea } from "./workspace-areas";
import { WorkspaceLoadingContent } from "./WorkspaceLoadingContent";

/** Lightweight chrome placeholder; keep workspace queries and actions lazy. */
export function WorkspaceStartup() {
  const { pathname } = useLocation();
  const sidebar = resolveWorkspaceArea(pathname).showFunctionSidebar;
  const surface = getAppSurface();
  return <main data-app-surface={surface} aria-busy="true" className={`workspace-shell workspace-startup${sidebar ? " has-section-menu" : " sidebar-unavailable sidebar-collapsed"}`}>
    {surface === "desktop" && <div className="workspace-topbar" aria-hidden="true"><Skeleton animationType="pulse" className="loading-line loading-line--short" /></div>}
    <div className="workspace-shell-grid">
      <div className="workspace-main-navigation" aria-hidden="true">
        <div className="workspace-business-rail workspace-startup-rail">
          {[0, 1, 2, 3, 4].map(item => <Skeleton key={item} animationType="pulse" className="workspace-startup-icon" />)}
        </div>
        {sidebar && <div className="workspace-sidebar workspace-startup-sidebar">
          <Skeleton animationType="pulse" className="loading-line loading-line--short" />
          {[0, 1, 2, 3, 4].map(item => <Skeleton key={item} animationType="pulse" className="loading-line" />)}
        </div>}
      </div>
      <section className="workspace-main-area" aria-label="主工作区">
        <section className="workspace-content">
          <div className="workspace-toolbar workspace-startup-toolbar" aria-hidden="true"><Skeleton animationType="pulse" className="workspace-startup-icon" /></div>
          <div className="workspace-route-content"><WorkspaceLoadingContent /></div>
        </section>
      </section>
    </div>
  </main>;
}

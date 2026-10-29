import { Skeleton } from "@heroui/react/skeleton";
import { useLocation } from "react-router-dom";
import { LoadingState } from "../../shared/ui/LoadingState";
import { PageContainer } from "../../shared/ui/PageContainer";
import { resolveWorkspaceArea } from "./workspace-areas";
import "../home/home.css";

/** Startup and route loading reserve the destination's content geometry. */
export function WorkspaceLoadingContent() {
  const { pathname } = useLocation();
  const area = resolveWorkspaceArea(pathname);
  if (area.id === "home") return <div className="home-page workspace-loading-home">
    <header className="home-header"><h1>首页</h1><div className="home-search" aria-hidden="true"><Skeleton animationType="pulse" className="workspace-loading-search" /></div></header>
    <div role="status" aria-label="正在打开首页…" aria-busy="true" className="sr-only">正在打开首页…</div>
    <div className="home-grid" aria-hidden="true">
      {[0, 1].map(panel => <div className="home-card home-welcome workspace-loading-welcome" key={panel}>
        <Skeleton animationType="pulse" className="loading-line loading-line--short" />
        <Skeleton animationType="pulse" className="workspace-loading-title" />
        <Skeleton animationType="pulse" className="loading-line" />
        <Skeleton animationType="pulse" className="loading-line loading-line--short" />
        <div className="workspace-loading-stats">{[0, 1, 2].map(item => <Skeleton animationType="pulse" className="workspace-loading-stat" key={item} />)}</div>
      </div>)}
      {[0, 1].map(panel => <div className="home-card workspace-loading-panel" key={panel}>
          <Skeleton animationType="pulse" className="loading-line loading-line--short" />
          {[0, 1, 2].map(row => <Skeleton animationType="pulse" className="loading-line" key={row} />)}
      </div>)}
    </div>
  </div>;
  return <PageContainer title={area.title}><LoadingState label={`正在打开${area.title}…`} variant="cards" /></PageContainer>;
}

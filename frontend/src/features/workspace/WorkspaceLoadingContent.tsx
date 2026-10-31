import { Skeleton } from "@orbis/ui/skeleton";
import { useLocation } from "react-router-dom";
import { LoadingState } from "../../shared/ui/LoadingState";
import { PageContainer } from "../../shared/ui/PageContainer";
import { resolveWorkspaceArea } from "./workspace-areas";
import { HomeSurface, HomeHeader, HomeGrid, HomeCard } from "../home/HomeLayout";
import { HomeActivityCard } from "../home/HomeActivityCard";

/** Startup and route loading reserve the destination's content geometry. */
export function WorkspaceLoadingContent() {
  const { pathname } = useLocation();
  const area = resolveWorkspaceArea(pathname);
  if (area.id === "home") return <HomeSurface className="workspace-loading-home">
    <HomeHeader><div className="home-search w-full min-[541px]:w-[min(28rem,45%)]" aria-hidden="true"><Skeleton animationType="pulse" className="workspace-loading-search" /></div></HomeHeader>
    <div role="status" aria-label="正在打开首页…" aria-busy="true" className="sr-only">正在打开首页…</div>
    <HomeGrid aria-hidden="true">
      {[0, 1].map(panel => <HomeCard className="home-welcome workspace-loading-welcome flex flex-col" key={panel}>
        <Skeleton animationType="pulse" className="loading-line loading-line--short" />
        <Skeleton animationType="pulse" className="workspace-loading-title" />
        <Skeleton animationType="pulse" className="loading-line" />
        <Skeleton animationType="pulse" className="loading-line loading-line--short" />
        <div className="workspace-loading-stats">{[0, 1, 2].map(item => <Skeleton animationType="pulse" className="workspace-loading-stat" key={item} />)}</div>
      </HomeCard>)}
      <HomeCard className="workspace-loading-panel">
        <Skeleton animationType="pulse" className="loading-line loading-line--short" />
        {[0, 1, 2].map(row => <Skeleton animationType="pulse" className="loading-line" key={row} />)}
      </HomeCard>
      <HomeActivityCard state="skeleton" />
    </HomeGrid>
  </HomeSurface>;
  return <PageContainer title={area.title}><LoadingState label={`正在打开${area.title}…`} variant="cards" /></PageContainer>;
}

import { cn } from "@orbis/ui/cn";
import { Skeleton } from "@orbis/ui/skeleton";
import { useLocation } from "react-router-dom";
import { LoadingState, loadingLineClassName } from "../../shared/ui/LoadingState";
import { PageContainer } from "../../shared/ui/PageContainer";
import { resolveWorkspaceArea } from "./workspace-areas";
import { HomeSurface, HomeHeader, HomeGrid, HomeCard } from "../home/HomeLayout";
import { HomeActivityCard } from "../home/HomeActivityCard";

/** Startup and route loading reserve the destination's content geometry. */
export function WorkspaceLoadingContent() {
  const { pathname } = useLocation();
  const area = resolveWorkspaceArea(pathname);
  if (area.id === "home") return <HomeSurface className="workspace-loading-home motion-reduce:[&_.skeleton]:animate-none">
    <HomeHeader><div className="home-search w-full min-[541px]:w-[min(28rem,45%)]" aria-hidden="true"><Skeleton className="workspace-loading-search h-[46px] rounded-xl" /></div></HomeHeader>
    <div role="status" aria-label="正在打开首页…" aria-busy="true" className="sr-only">正在打开首页…</div>
    <HomeGrid aria-hidden="true">
      {[0, 1].map(panel => <HomeCard className="home-welcome workspace-loading-welcome flex flex-col gap-6" key={panel}>
        <Skeleton className={cn(loadingLineClassName, "loading-line--short w-[64%]")} />
        <Skeleton className="workspace-loading-title h-11 w-[70%] rounded-sm" />
        <Skeleton className={loadingLineClassName} />
        <Skeleton className={cn(loadingLineClassName, "loading-line--short w-[64%]")} />
        <div className="workspace-loading-stats mt-auto grid grid-cols-3 gap-6">{[0, 1, 2].map(item => <Skeleton className="workspace-loading-stat h-14 rounded-sm" key={item} />)}</div>
      </HomeCard>)}
      <HomeCard className="workspace-loading-panel grid min-h-60 gap-6">
        <Skeleton className={cn(loadingLineClassName, "loading-line--short w-[64%]")} />
        {[0, 1, 2].map(row => <Skeleton className={loadingLineClassName} key={row} />)}
      </HomeCard>
      <HomeActivityCard state="skeleton" />
    </HomeGrid>
  </HomeSurface>;
  return <PageContainer title={area.title}><LoadingState label={`正在打开${area.title}…`} variant="cards" /></PageContainer>;
}

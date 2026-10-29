import { Skeleton } from "@heroui/react/skeleton";
import { useLocation } from "react-router-dom";
import { LoadingState } from "../../shared/ui/LoadingState";
import { PageContainer } from "../../shared/ui/PageContainer";
import { resolveWorkspaceArea } from "./workspace-areas";

/** Startup and route loading reserve the destination's content geometry. */
export function WorkspaceLoadingContent() {
  const { pathname } = useLocation();
  const area = resolveWorkspaceArea(pathname);
  const home = area.id === "home";
  return <div className={home ? "workspace-loading-home" : undefined}>
    <PageContainer title={area.title}>
      <LoadingState label={`正在打开${area.title}…`} variant="cards" />
      {home && <div className="workspace-loading-home-panels" aria-hidden="true">
        {[0, 1].map(panel => <div className="workspace-loading-panel" key={panel}>
          <Skeleton animationType="pulse" className="loading-line loading-line--short" />
          {[0, 1, 2].map(row => <Skeleton animationType="pulse" className="loading-line" key={row} />)}
        </div>)}
      </div>}
    </PageContainer>
  </div>;
}

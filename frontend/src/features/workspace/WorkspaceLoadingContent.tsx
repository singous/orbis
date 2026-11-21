import { Input } from "@orbis/ui/input";
import { Button } from "@orbis/ui/button";
import { useLocation } from "react-router-dom";
import { useStore } from "zustand";
import { LoadingState } from "../../shared/ui/LoadingState";
import { PageContainer, pageColumnClassName } from "../../shared/ui/PageContainer";
import { ArrowRight } from "../../shared/ui/icons";
import { resolveWorkspaceArea } from "./workspace-areas";
import { HomeSurface, HomeHeader, HomeGrid, HomeCard, HomeCardHeading } from "../home/HomeLayout";
import { authStore } from "../../shared/auth/auth-store";
import { canMutateWorkspaceContent } from "./capabilities";
import { NotebookShelfActions, NotebookShelfCountPlaceholder, NotebookShelfLayout } from "../documents/NotebookShelfLayout";
import { NotebookHomeLayout, NotebookHomeViews } from "../documents/NotebookHomeLayout";
import { NotebookCoverPending } from "../documents/NotebookCoverIdentity";
import { DocumentPendingContent } from "../documents/DocumentPending";
import { EditorToolbarFrame } from "../documents/editor/EditorToolbarHost";

export type WorkspaceLoadingKind = "document" | "notebook-shelf" | "notebook";

function NotebookShelfPending() {
  const canEdit = canMutateWorkspaceContent(useStore(authStore, state => state.workspace));
  return <NotebookShelfLayout description={<NotebookShelfCountPlaceholder />} actions={canEdit ? <NotebookShelfActions /> : null}>
    <LoadingState label="正在加载笔记本…" variant="cards" bones="notebook-shelf" />
  </NotebookShelfLayout>;
}

/** Startup and route loading reserve the destination's content geometry. */
export function WorkspaceLoadingContent({ loadingKind }: { loadingKind?: WorkspaceLoadingKind }) {
  const { pathname } = useLocation();
  if (loadingKind === "document") return <EditorToolbarFrame><DocumentPendingContent /></EditorToolbarFrame>;
  if (loadingKind === "notebook-shelf") return <NotebookShelfPending />;
  if (loadingKind === "notebook") return (
    <NotebookHomeLayout identity={<NotebookCoverPending />}>
      <NotebookHomeViews directory={<LoadingState label="正在读取笔记本目录…" />} />
    </NotebookHomeLayout>
  );
  const area = resolveWorkspaceArea(pathname);
  if (area.id === "home") return <HomeSurface className="workspace-loading-home">
    <HomeHeader>
      <div className="home-search flex w-full gap-2 min-[541px]:w-[min(28rem,45%)]">
        <Input className="min-w-0" type="search" aria-label="搜索文档" placeholder="搜索你的知识…" disabled />
        <Button variant="outline" size="icon" aria-label="搜索" disabled><ArrowRight aria-hidden="true" /></Button>
      </div>
    </HomeHeader>
    <div role="status" aria-label="正在打开首页…" aria-busy="true" className="sr-only">正在打开首页…</div>
    <HomeGrid>
      <HomeCard className="home-welcome"><HomeCardHeading title="嗨，欢迎回来。" /></HomeCard>
      <HomeCard><HomeCardHeading title="突然想到…" /></HomeCard>
      <HomeCard className="workspace-loading-panel"><HomeCardHeading title="接着上次的灵感" /></HomeCard>
      <HomeCard className="workspace-loading-panel"><HomeCardHeading title="灵感足迹" /></HomeCard>
    </HomeGrid>
  </HomeSurface>;
  if (area.id === "documents") return <div className={pageColumnClassName}><LoadingState label="正在加载文档区…" /></div>;
  return <PageContainer title={area.title}><LoadingState label={`正在打开${area.title}…`} /></PageContainer>;
}

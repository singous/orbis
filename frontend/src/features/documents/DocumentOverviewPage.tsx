import { cn } from "@orbis/ui/cn";
import { workbenchStyles } from "@/shared/ui/workbench-styles";
import { releaseFeatures } from "../../shared/release-features";
import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useStore } from "zustand";
import { authStore } from "../../shared/auth/auth-store";
import { Button } from "@orbis/ui/button";

import { Tooltip, TooltipTrigger, TooltipContent } from "@orbis/ui/tooltip";
import { LoadingState } from "../../shared/ui/LoadingState";
import { PageContainer } from "../../shared/ui/PageContainer";

import { Pin, Plus, BookOpen } from "../../shared/ui/icons";
import type { Notebook } from "../../shared/api/schemas";
import { canMutateWorkspaceContent } from "../workspace/capabilities";
import { DocumentShell } from "./DocumentShell";
import { NotebookDialog } from "./NotebookDialog";
import { NotebookCard } from "./NotebookCard";
import { usePinnedNotebooks } from "./pinned-notebooks";
import { useCollapsedGroups } from "./collapsed-groups";
import { useCreateNotebook, useDocumentGroups, useNotebooks } from "./queries";
import { useNotebookDocumentCounts } from "./notebook-counts";

export function DocumentOverviewPage() {
  const navigate = useNavigate();
  const workspace = useStore(authStore, (state) => state.workspace);
  const canEdit = canMutateWorkspaceContent(workspace);
  const groupsQuery = useDocumentGroups();
  const notebooksQuery = useNotebooks();
  const { counts, isSuccess: countsReady } = useNotebookDocumentCounts();
  const createNotebook = useCreateNotebook();
  const [creating, setCreating] = useState(false);
  const { isPinned, togglePin } = usePinnedNotebooks(workspace?.id);
  const { isCollapsed, toggleGroup } = useCollapsedGroups(workspace?.id);
  const notebooks = notebooksQuery.data?.items ?? [];
  const groups = groupsQuery.data?.items ?? [];
  const common = notebooks.filter((notebook) => isPinned(notebook.id));
  const grouped = groups.map((group) => ({ id: group.id, title: group.name, notebooks: notebooks.filter((notebook) => notebook.group_id === group.id) })).filter((group) => group.notebooks.length > 0);
  const knownGroups = new Set(groups.map((group) => group.id));
  const ungrouped = notebooks.filter((notebook) => !knownGroups.has(notebook.group_id));
  if (ungrouped.length) grouped.push({ id: "ungrouped", title: "其他笔记本", notebooks: ungrouped });

  // 保留三个等宽卡片与 260px 可读宽度下限；窄屏改为单列。
  function card(notebook: Notebook, compact = false) {
    return <NotebookCard key={notebook.id} notebook={notebook} variant={compact ? "compact" : "overview"} noteCount={!compact && countsReady ? counts.get(notebook.id) ?? 0 : undefined} actions={releaseFeatures.documentFavorites && <Tooltip><TooltipTrigger render={<Button size="icon-sm" className={cn("notebook-overview-pin absolute end-2 top-3", isPinned(notebook.id) && "is-pinned")} aria-label={`${isPinned(notebook.id) ? "取消常用" : "设为常用"}：${notebook.title}`} aria-pressed={isPinned(notebook.id)} onClick={() => togglePin(notebook.id)} variant={isPinned(notebook.id) ? "secondary" : "ghost"}><Pin aria-hidden="true" /></Button>} /><TooltipContent>{isPinned(notebook.id) ? "取消常用" : "设为常用"}</TooltipContent></Tooltip>} />;
  }
  return <DocumentShell>
    <div className="notebook-overview">
      <PageContainer headerClassName="mb-6 pb-4 max-[641px]:pb-4" title="在线文档" description={`${notebooks.length} 个笔记本`} actions={<>{canEdit ? <Button variant="default"  onClick={() => setCreating(true)}><Plus size={16} />新建笔记本</Button> : null}<Link to="/documents/collections" className={workbenchStyles.more}>管理笔记本</Link></>}>

        {notebooksQuery.isLoading ? <LoadingState label="正在加载笔记本…" variant="cards" /> : null}
        {releaseFeatures.documentFavorites ? <section className="notebook-overview-common mb-8 rounded-lg bg-muted p-6" aria-label="常用">
          <header className={workbenchStyles.sectionHeading}><h2 className={workbenchStyles.sectionTitle}>常用</h2>{common.length ? <Button variant="ghost" size="sm" aria-label={isCollapsed("common") ? "展开常用区域" : "收起常用区域"} aria-expanded={!isCollapsed("common")} onClick={() => toggleGroup("common")}>{isCollapsed("common") ? "展开" : "收起"}</Button> : null}</header>
          {common.length ? (!isCollapsed("common") ? <div className="notebook-overview-grid grid grid-cols-[repeat(auto-fit,minmax(min(100%,max(260px,calc((100%_-_32px)/3))),1fr))] gap-4 max-[767px]:grid-cols-[minmax(0,1fr)]">{common.map((notebook) => card(notebook, true))}</div> : null) : !notebooksQuery.isLoading && !notebooksQuery.isError ? <p className="m-0 text-sm leading-5 text-foreground/65">将笔记本设为常用，便可在这里和左侧快速打开。</p> : null}
        </section> : null}
        {grouped.map((group) => <section key={group.id} className="notebook-overview-group mb-8" aria-label={group.title}><header className={workbenchStyles.sectionHeading}><h2 className={workbenchStyles.sectionTitle}>{group.title}</h2></header><div className="notebook-overview-grid grid grid-cols-[repeat(auto-fit,minmax(min(100%,max(260px,calc((100%_-_32px)/3))),1fr))] gap-4 max-[767px]:grid-cols-[minmax(0,1fr)]">{group.notebooks.map((notebook) => card(notebook))}</div></section>)}
        {!notebooksQuery.isLoading && !notebooksQuery.isError && !notebooks.length ? <div className={workbenchStyles.emptySection}><BookOpen size={28} /><h3 className={workbenchStyles.emptyTitle}>还没有笔记本</h3><p className={workbenchStyles.emptyDescription}>创建笔记本，开始整理你的文档。</p>{canEdit ? <Button variant="secondary" onClick={() => setCreating(true)}>新建笔记本</Button> : null}</div> : null}
      </PageContainer>
    </div>
    <NotebookDialog open={creating} pending={createNotebook.isPending} onClose={() => setCreating(false)} onSubmit={async ({ title, icon }) => { const notebook = await createNotebook.mutateAsync({ title, icon, sort_order: notebooks.length }); setCreating(false); navigate(`/collections/${notebook.id}`); }} />
  </DocumentShell>;
}

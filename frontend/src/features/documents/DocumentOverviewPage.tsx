import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useStore } from "zustand";
import { Button, buttonVariants } from "@orbis/ui/button";
import { cn } from "@orbis/ui/cn";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@orbis/ui/dropdown-menu";
import { Tooltip, TooltipContent, TooltipTrigger } from "@orbis/ui/tooltip";

import type { Notebook } from "../../shared/api/schemas";
import { authStore } from "../../shared/auth/auth-store";
import { releaseFeatures } from "../../shared/release-features";
import { BookOpen, ChevronDown, FolderPlus, MoreHorizontal, Pin, Plus, Settings2 } from "../../shared/ui/icons";
import { LoadingState } from "../../shared/ui/LoadingState";
import { PageHeader } from "../../shared/ui/PageHeader";
import { canMutateWorkspaceContent } from "../workspace/capabilities";
import { useCollapsedGroups } from "./collapsed-groups";
import { DocumentShell } from "./DocumentShell";
import { NotebookCard } from "./NotebookCard";
import { EditNotebookDialog, NotebookDialog } from "./NotebookDialog";
import { useNotebookDocumentCounts } from "./notebook-counts";
import { usePinnedNotebooks } from "./pinned-notebooks";
import { useCreateDocumentGroup, useCreateNotebook, useDocumentGroups, useNotebooks } from "./queries";
import { ResourceDialog } from "./ResourceDialog";

const shelfClassName = "notebook-overview-grid grid grid-cols-4 gap-[18px] @max-[839px]/notebook-shelf:grid-cols-3 @max-[620px]/notebook-shelf:grid-cols-2 @max-[400px]/notebook-shelf:grid-cols-1";
const countClassName = "inline-flex min-h-6 shrink-0 items-center rounded-md bg-sidebar-accent px-2 text-[11px] font-medium text-foreground";
const groupTitleClassName = "flex min-h-8 min-w-0 items-center gap-2 rounded-md text-left text-[15px] font-semibold hover:text-primary";

type OverviewDialog = { type: "group" } | { type: "notebook"; groupId?: string } | { type: "edit-notebook"; notebook: Notebook };

export function DocumentOverviewPage() {
  const navigate = useNavigate();
  const workspace = useStore(authStore, (state) => state.workspace);
  const canEdit = canMutateWorkspaceContent(workspace);
  const groupsQuery = useDocumentGroups();
  const notebooksQuery = useNotebooks();
  const { counts, recent, isSuccess: countsReady, isLoading: indexLoading } = useNotebookDocumentCounts();
  const createNotebook = useCreateNotebook();
  const createGroup = useCreateDocumentGroup();
  const [dialog, setDialog] = useState<OverviewDialog | null>(null);
  const { isPinned, togglePin } = usePinnedNotebooks(workspace?.id);
  const { isCollapsed, toggleGroup } = useCollapsedGroups(workspace?.id);
  const notebooks = notebooksQuery.data?.items ?? [];
  const groups = groupsQuery.data?.items ?? [];
  const common = notebooks.filter(notebook => isPinned(notebook.id));
  const grouped = groups.map(group => ({ id: group.id, title: group.name, isDefault: group.is_default, notebooks: notebooks.filter(notebook => notebook.group_id === group.id) })).filter(group => group.notebooks.length > 0);
  const knownGroups = new Set(groups.map(group => group.id));
  const ungrouped = notebooks.filter(notebook => !knownGroups.has(notebook.group_id));
  if (ungrouped.length) grouped.push({ id: "ungrouped", title: "其他笔记本", isDefault: false, notebooks: ungrouped });

  function card(notebook: Notebook) {
    const pinned = isPinned(notebook.id);
    const pinLabel = `${pinned ? "取消常用" : "设为常用"}：${notebook.title}`;
    return <NotebookCard key={notebook.id} notebook={notebook} variant="overview" noteCount={countsReady ? counts.get(notebook.id) ?? 0 : undefined} recent={recent.get(notebook.id)} indexLoading={indexLoading} actions={<>
      {releaseFeatures.documentFavorites ? <Tooltip><TooltipTrigger render={<Button size="icon-xs" className={cn("notebook-overview-pin", pinned && "is-pinned text-primary [&_svg]:fill-current")} aria-label={pinLabel} aria-pressed={pinned} onClick={() => togglePin(notebook.id)} variant="ghost"><Pin aria-hidden="true" /></Button>} /><TooltipContent>{pinLabel}</TooltipContent></Tooltip> : null}
      {canEdit ? <DropdownMenu>
        <DropdownMenuTrigger render={<Button variant="ghost" size="icon-xs" aria-label={`笔记本操作：${notebook.title}`}><MoreHorizontal aria-hidden="true" /></Button>} />
        <DropdownMenuContent align="end">
          <DropdownMenuItem onClick={() => setDialog({ type: "edit-notebook", notebook })}><Settings2 aria-hidden="true" />编辑笔记本</DropdownMenuItem>
          <DropdownMenuItem render={<Link to={`/documents/collections?group=${notebook.group_id}`} />}>管理笔记本</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu> : null}
    </>} />;
  }

  return <DocumentShell>
    <div className="notebook-overview min-h-full bg-card">
      <div className="mx-auto w-full max-w-[1440px] px-[clamp(20px,3.25vw,44px)] pt-[37px] pb-10 max-[640px]:pt-6">
        <PageHeader className="mb-8 border-0 pb-0 max-[641px]:pb-0 [&_.page-actions]:items-center" title="我的文档" description={`${notebooks.length} 个笔记本 · ${groups.length} 个分组`} actions={canEdit ? <>
          <Button variant="secondary" size="lg" className="gap-[7px] px-3.5 text-[13px] font-semibold" onClick={() => setDialog({ type: "group" })}><FolderPlus aria-hidden="true" />新建分组</Button>
          <Button size="lg" className="gap-[7px] px-3.5 text-[13px] font-semibold" onClick={() => setDialog({ type: "notebook" })}><Plus aria-hidden="true" />新建笔记本</Button>
        </> : null} />

        {notebooksQuery.isLoading ? <LoadingState label="正在加载笔记本…" variant="cards" /> : null}
        {notebooksQuery.isError && !notebooks.length ? <div role="alert" className="flex items-center gap-3 text-sm text-muted-foreground">无法加载笔记本。<Button variant="secondary" size="sm" onClick={() => void notebooksQuery.refetch()}>重试</Button></div> : null}
        <div className="@container/notebook-shelf grid gap-10">
          {releaseFeatures.documentFavorites ? <section className="notebook-overview-common" aria-label="置顶笔记本">
            <header className="mb-[18px] flex flex-wrap items-center justify-between gap-2">
              <h2>{common.length ? <button type="button" className={groupTitleClassName} aria-expanded={!isCollapsed("common")} onClick={() => toggleGroup("common")}><Pin size={16} aria-hidden="true" />置顶笔记本<span className={countClassName}>{common.length} 个笔记本</span></button> : <span className={groupTitleClassName}><Pin size={16} aria-hidden="true" />置顶笔记本</span>}</h2>
              {common.length ? <span className="text-xs text-muted-foreground">跨分组快捷访问</span> : null}
            </header>
            {common.length ? !isCollapsed("common") && <div className={shelfClassName}>{common.map(card)}</div> : !notebooksQuery.isLoading && !notebooksQuery.isError ? <p className="text-sm text-muted-foreground">将笔记本设为常用，即可在这里和左侧快速打开。</p> : null}
          </section> : null}
          {grouped.map(group => {
            const collapsed = isCollapsed(group.id);
            return <section key={group.id} className="notebook-overview-group" aria-label={group.title}>
              <header className="mb-[18px] flex flex-wrap items-center justify-between gap-2">
                <h2 className="min-w-0"><button type="button" className={groupTitleClassName} aria-expanded={!collapsed} onClick={() => toggleGroup(group.id)}>
                  <ChevronDown className={cn("shrink-0", collapsed && "-rotate-90")} size={16} aria-hidden="true" /><span className="truncate">{group.title}</span>
                  {group.isDefault ? <span className={countClassName}>默认</span> : null}<span className={countClassName}>{group.notebooks.length} 个笔记本</span>
                </button></h2>
                {canEdit && group.id !== "ungrouped" ? <div className="flex items-center gap-1">
                  <Button variant="ghost" size="sm" aria-label={`在 ${group.title} 新建笔记本`} onClick={() => setDialog({ type: "notebook", groupId: group.id })}><Plus aria-hidden="true" />笔记本</Button>
                  <Link to={`/documents/collections?group=${group.id}`} aria-label={`管理分组：${group.title}`} className={buttonVariants({ variant: "ghost", size: "icon-sm" })}><MoreHorizontal aria-hidden="true" /></Link>
                </div> : null}
              </header>
              {!collapsed ? <div className={shelfClassName}>{group.notebooks.map(card)}</div> : null}
            </section>;
          })}
        </div>
        {!notebooksQuery.isLoading && !notebooksQuery.isError && !notebooks.length ? <div className="mt-10 grid justify-items-start gap-3 rounded-xl bg-sidebar p-6"><BookOpen size={28} aria-hidden="true" /><h2 className="text-base font-semibold">还没有笔记本</h2><p className="text-sm text-muted-foreground">创建笔记本，开始整理你的文档。</p>{canEdit ? <Button variant="secondary" onClick={() => setDialog({ type: "notebook" })}>新建笔记本</Button> : null}</div> : null}
      </div>
    </div>
    {dialog?.type === "group" ? <ResourceDialog open title="新建分组" label="分组名称" placeholder="例如：产品研发" submitLabel="创建分组" pending={createGroup.isPending} onClose={() => setDialog(null)} onSubmit={async name => {
      const group = await createGroup.mutateAsync({ name, sort_order: groups.length });
      setDialog(null);
      navigate(`/documents/collections?group=${group.id}`);
    }} /> : null}
    {dialog?.type === "notebook" ? <NotebookDialog open pending={createNotebook.isPending} onClose={() => setDialog(null)} onSubmit={async ({ title, icon }) => {
      const notebook = await createNotebook.mutateAsync({ title, icon, ...(dialog.groupId ? { group_id: dialog.groupId } : {}), sort_order: notebooks.length });
      setDialog(null);
      navigate(`/collections/${notebook.id}`);
    }} /> : null}
    {dialog?.type === "edit-notebook" ? <EditNotebookDialog notebook={dialog.notebook} onClose={() => setDialog(null)} /> : null}
  </DocumentShell>;
}

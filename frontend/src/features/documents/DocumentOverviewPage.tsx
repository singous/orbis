import { useEffect, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { useStore } from "zustand";
import { z } from "zod";
import { Button } from "@orbis/ui/button";
import { cn } from "@orbis/ui/cn";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@orbis/ui/dropdown-menu";
import { Tooltip, TooltipContent, TooltipTrigger } from "@orbis/ui/tooltip";

import type { DocumentGroup, Notebook } from "../../shared/api/schemas";
import { reportError } from "../../shared/api/request-feedback";
import { authStore } from "../../shared/auth/auth-store";
import { releaseFeatures } from "../../shared/release-features";
import { Archive, BookOpen, ChevronDown, FolderPlus, MoreHorizontal, Pencil, Pin, Plus, Settings2 } from "../../shared/ui/icons";
import { LoadingState } from "../../shared/ui/LoadingState";
import { PageHeader } from "../../shared/ui/PageHeader";
import { canMutateWorkspaceContent } from "../workspace/capabilities";
import { useCollapsedGroups } from "./collapsed-groups";
import { DocumentShell } from "./DocumentShell";
import { NotebookCard } from "./NotebookCard";
import { EditNotebookDialog, NotebookDialog } from "./NotebookDialog";
import { useNotebookDocumentCounts } from "./notebook-counts";
import { usePinnedNotebooks } from "./pinned-notebooks";
import { useArchiveDocumentGroup, useArchiveNotebook, useCreateDocumentGroup, useCreateNote, useCreateNotebook, useDocumentGroup, useDocumentGroups, useNotebooks, useUpdateDocumentGroup } from "./queries";
import { ResourceDialog } from "./ResourceDialog";

const shelfClassName = "notebook-overview-grid grid grid-cols-4 gap-[18px] @max-[839px]/notebook-shelf:grid-cols-3 @max-[620px]/notebook-shelf:grid-cols-2 @max-[400px]/notebook-shelf:grid-cols-1";
const countClassName = "inline-flex min-h-6 shrink-0 items-center rounded-md bg-sidebar-accent px-2 text-[11px] font-medium text-foreground";
const groupTitleClassName = "flex min-h-8 min-w-0 items-center gap-2 rounded-md text-left text-[15px] font-semibold hover:text-primary";
const groupIdSchema = z.string().uuid();

type OverviewDialog =
  | { type: "group" }
  | { type: "rename-group"; group: DocumentGroup }
  | { type: "notebook"; groupId?: string }
  | { type: "edit-notebook"; notebook: Notebook };

export function DocumentOverviewPage() {
  const navigate = useNavigate();
  const { pathname, search, hash, state } = useLocation();
  const targetId = groupIdSchema.safeParse(new URLSearchParams(search).get("group")).data;
  const focusedGroup = useRef<string | undefined>(undefined);
  const shownError = useRef<string | undefined>(undefined);
  const workspace = useStore(authStore, (state) => state.workspace);
  const canEdit = canMutateWorkspaceContent(workspace);
  const groupsQuery = useDocumentGroups();
  const notebooksQuery = useNotebooks();
  const groups = groupsQuery.data?.items ?? [];
  const targetOutsideList = !groupsQuery.isLoading && !groups.some(group => group.id === targetId) ? targetId : undefined;
  const targetGroupQuery = useDocumentGroup(targetOutsideList);
  const targetGroup = targetOutsideList && targetGroupQuery.data?.is_archived === false ? targetGroupQuery.data : undefined;
  const targetNotebooks = useNotebooks(targetGroup?.id, "active", { enabled: Boolean(targetGroup) });
  const visibleGroups = targetGroup ? [...groups, targetGroup] : groups;
  const listedNotebooks = notebooksQuery.data?.items ?? [];
  const notebooks = targetGroup && targetNotebooks.data ? [
    ...listedNotebooks.filter(notebook => notebook.group_id !== targetGroup.id),
    ...targetNotebooks.data.items,
  ] : listedNotebooks;

  const { counts, recent, isSuccess: countsReady, isLoading: indexLoading } = useNotebookDocumentCounts();
  const createNotebook = useCreateNotebook();
  const createGroup = useCreateDocumentGroup();
  const renameGroup = useUpdateDocumentGroup();
  const archiveGroup = useArchiveDocumentGroup();
  const archiveNotebook = useArchiveNotebook();
  const createNote = useCreateNote();
  const [dialog, setDialog] = useState<OverviewDialog | null>(null);
  const { isPinned, togglePin } = usePinnedNotebooks(workspace?.id);
  const { isCollapsed, toggleGroup } = useCollapsedGroups(workspace?.id);
  const common = notebooks.filter(notebook => isPinned(notebook.id));
  const notebooksByGroup = new Map<string, Notebook[]>();
  for (const notebook of notebooks) {
    const group = notebooksByGroup.get(notebook.group_id);
    if (group) group.push(notebook);
    else notebooksByGroup.set(notebook.group_id, [notebook]);
  }
  const knownGroups = new Set(visibleGroups.map(group => group.id));
  const ungrouped = notebooks.filter(notebook => !knownGroups.has(notebook.group_id));

  useEffect(() => {
    if (!targetId) {
      focusedGroup.current = undefined;
      return;
    }
    if (focusedGroup.current === targetId) return;
    const target = document.getElementById(`group-${targetId}`);
    if (!target) return;
    if (isCollapsed(targetId)) toggleGroup(targetId);
    target.focus({ preventScroll: true });
    target.scrollIntoView?.({ block: "nearest" });
    focusedGroup.current = targetId;
  }, [targetId, isCollapsed, toggleGroup]);

  const resourceError = (state as { resourceError?: string } | null)?.resourceError;
  useEffect(() => {
    if (!resourceError || shownError.current === resourceError) return;
    shownError.current = resourceError;
    reportError(resourceError);
    navigate({ pathname, search, hash }, { replace: true, state: null });
  }, [resourceError, navigate, pathname, search, hash]);

  async function createFirstDocument(notebook: Notebook) {
    const note = await createNote.mutateAsync({ notebook_id: notebook.id, title: "未命名文档", parent_id: null, sort_order: 0 });
    navigate(`/documents/${note.id}`);
  }

  function card(notebook: Notebook) {
    const pinned = isPinned(notebook.id);
    const pinLabel = `${pinned ? "取消常用" : "设为常用"}：${notebook.title}`;
    const noteCount = countsReady ? counts.get(notebook.id) ?? 0 : undefined;
    return <NotebookCard key={notebook.id} notebook={notebook} noteCount={noteCount} recent={recent.get(notebook.id)} indexLoading={indexLoading} actions={<>
      {releaseFeatures.documentFavorites ? <Tooltip><TooltipTrigger render={<Button size="icon-xs" className={cn("notebook-overview-pin", pinned && "is-pinned text-primary [&_svg]:fill-current")} aria-label={pinLabel} aria-pressed={pinned} onClick={() => togglePin(notebook.id)} variant="ghost"><Pin aria-hidden="true" /></Button>} /><TooltipContent>{pinLabel}</TooltipContent></Tooltip> : null}
      {canEdit ? <DropdownMenu>
        <DropdownMenuTrigger render={<Button variant="ghost" size="icon-xs" aria-label={`笔记本操作：${notebook.title}`}><MoreHorizontal aria-hidden="true" /></Button>} />
        <DropdownMenuContent align="end">
          {noteCount === 0 ? <DropdownMenuItem disabled={createNote.isPending} onClick={() => void createFirstDocument(notebook).catch(reportError)}><Plus aria-hidden="true" />新建文档</DropdownMenuItem> : null}
          <DropdownMenuItem onClick={() => setDialog({ type: "edit-notebook", notebook })}><Settings2 aria-hidden="true" />编辑笔记本</DropdownMenuItem>
          <DropdownMenuItem variant="destructive" disabled={archiveNotebook.isPending} onClick={() => archiveNotebook.mutate({ id: notebook.id, archived: true, expected_directory_version: notebook.directory_version })}><Archive aria-hidden="true" />归档笔记本</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu> : null}
    </>} />;
  }

  function groupSection(group: DocumentGroup) {
    const items = notebooksByGroup.get(group.id) ?? [];
    const collapsed = isCollapsed(group.id);
    const contentId = `group-items-${group.id}`;
    const loading = notebooksQuery.isLoading || (targetGroup?.id === group.id && targetNotebooks.isLoading);
    return <section key={group.id} id={`group-${group.id}`} tabIndex={targetId === group.id ? -1 : undefined} className="notebook-overview-group" aria-label={group.name}>
      <header className="mb-[18px] flex flex-wrap items-center justify-between gap-2">
        <h2 className="min-w-0"><button type="button" className={groupTitleClassName} aria-controls={contentId} aria-expanded={!collapsed} onClick={() => toggleGroup(group.id)}>
          <ChevronDown className={cn("shrink-0", collapsed && "-rotate-90")} size={16} aria-hidden="true" /><span className="truncate">{group.name}</span>
          {group.is_default ? <span className={countClassName}>默认</span> : null}<span className={countClassName}>{items.length} 个笔记本</span>
        </button></h2>
        {canEdit ? <div className="flex items-center gap-1">
          <Button variant="ghost" size="sm" aria-label={`在 ${group.name} 新建笔记本`} onClick={() => setDialog({ type: "notebook", groupId: group.id })}><Plus aria-hidden="true" />笔记本</Button>
          <DropdownMenu>
            <DropdownMenuTrigger render={<Button variant="ghost" size="icon-sm" aria-label={`分组操作：${group.name}`}><MoreHorizontal aria-hidden="true" /></Button>} />
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={() => setDialog({ type: "rename-group", group })}><Pencil aria-hidden="true" />重命名分组</DropdownMenuItem>
              {!group.is_default ? <DropdownMenuItem variant="destructive" disabled={archiveGroup.isPending} onClick={() => archiveGroup.mutate({ id: group.id, archived: true, expected_version: group.version }, {
                onSuccess: () => { if (targetId === group.id) navigate("/documents", { replace: true }); },
              })}><Archive aria-hidden="true" />归档分组</DropdownMenuItem> : null}
            </DropdownMenuContent>
          </DropdownMenu>
        </div> : null}
      </header>
      <div id={contentId} hidden={collapsed}>
        {collapsed ? null : items.length ? <div className={shelfClassName}>{items.map(card)}</div> : loading ? <LoadingState label="正在读取分组笔记本…" /> : <p className="text-sm text-muted-foreground">此分组暂无笔记本。</p>}
      </div>
    </section>;
  }

  return <DocumentShell>
    <div className="notebook-overview min-h-full bg-card">
      <div className="mx-auto w-full max-w-[1440px] px-[clamp(20px,3.25vw,44px)] pt-[37px] pb-10 max-[640px]:pt-6">
        <PageHeader className="mb-8 border-0 pb-0 max-[641px]:pb-0 [&_.page-actions]:items-center" title="我的文档" description={`${notebooks.length} 个笔记本 · ${visibleGroups.length} 个分组`} actions={canEdit ? <>
          <Button variant="secondary" size="lg" className="gap-[7px] px-3.5 text-[13px] font-semibold" onClick={() => setDialog({ type: "group" })}><FolderPlus aria-hidden="true" />新建分组</Button>
          <Button size="lg" className="gap-[7px] px-3.5 text-[13px] font-semibold" onClick={() => setDialog({ type: "notebook" })}><Plus aria-hidden="true" />新建笔记本</Button>
        </> : null} />

        {notebooksQuery.isLoading ? <LoadingState label="正在加载笔记本…" variant="cards" /> : null}
        {targetOutsideList && targetGroupQuery.isLoading ? <LoadingState label="正在定位分组…" /> : null}
        {notebooksQuery.isError && !notebooks.length ? <div role="alert" className="flex items-center gap-3 text-sm text-muted-foreground">无法加载笔记本。<Button variant="secondary" size="sm" onClick={() => void notebooksQuery.refetch()}>重试</Button></div> : null}
        <div className="@container/notebook-shelf grid gap-10">
          {releaseFeatures.documentFavorites ? <section className="notebook-overview-common" aria-label="置顶笔记本">
            <header className="mb-[18px] flex flex-wrap items-center justify-between gap-2">
              <h2>{common.length ? <button type="button" className={groupTitleClassName} aria-expanded={!isCollapsed("common")} onClick={() => toggleGroup("common")}><Pin size={16} aria-hidden="true" />置顶笔记本<span className={countClassName}>{common.length} 个笔记本</span></button> : <span className={groupTitleClassName}><Pin size={16} aria-hidden="true" />置顶笔记本</span>}</h2>
              {common.length ? <span className="text-xs text-muted-foreground">跨分组快捷访问</span> : null}
            </header>
            {common.length ? !isCollapsed("common") && <div className={shelfClassName}>{common.map(card)}</div> : !notebooksQuery.isLoading && !notebooksQuery.isError ? <p className="text-sm text-muted-foreground">将笔记本设为常用，即可在这里和左侧快速打开。</p> : null}
          </section> : null}
          {visibleGroups.map(groupSection)}
          {ungrouped.length ? <section className="notebook-overview-group" aria-label="其他笔记本">
            <h2 className="mb-[18px]"><button type="button" className={groupTitleClassName} aria-expanded={!isCollapsed("ungrouped")} onClick={() => toggleGroup("ungrouped")}>
              <ChevronDown className={cn("shrink-0", isCollapsed("ungrouped") && "-rotate-90")} size={16} aria-hidden="true" />其他笔记本<span className={countClassName}>{ungrouped.length} 个笔记本</span>
            </button></h2>
            {!isCollapsed("ungrouped") ? <div className={shelfClassName}>{ungrouped.map(card)}</div> : null}
          </section> : null}
        </div>
        {!notebooksQuery.isLoading && !notebooksQuery.isError && !notebooks.length ? <div className="mt-10 grid justify-items-start gap-3 rounded-xl bg-sidebar p-6"><BookOpen size={28} aria-hidden="true" /><h2 className="text-base font-semibold">还没有笔记本</h2><p className="text-sm text-muted-foreground">创建笔记本，开始整理你的文档。</p>{canEdit ? <Button variant="secondary" onClick={() => setDialog({ type: "notebook" })}>新建笔记本</Button> : null}</div> : null}
      </div>
    </div>
    {dialog?.type === "group" ? <ResourceDialog open title="新建分组" label="分组名称" placeholder="例如：产品研发" submitLabel="创建分组" pending={createGroup.isPending} onClose={() => setDialog(null)} onSubmit={async name => {
      const group = await createGroup.mutateAsync({ name, sort_order: groups.length });
      setDialog(null);
      navigate(`/documents?group=${group.id}`);
    }} /> : null}
    {dialog?.type === "rename-group" ? <ResourceDialog open title="重命名分组" label="分组名称" placeholder="分组名称" initialValue={dialog.group.name} submitLabel="保存" pending={renameGroup.isPending} onClose={() => setDialog(null)} onSubmit={async name => {
      await renameGroup.mutateAsync({ id: dialog.group.id, expected_version: dialog.group.version, name });
      setDialog(null);
    }} /> : null}
    {dialog?.type === "notebook" ? <NotebookDialog open pending={createNotebook.isPending} onClose={() => setDialog(null)} onSubmit={async ({ title, icon }) => {
      const notebook = await createNotebook.mutateAsync({ title, icon, ...(dialog.groupId ? { group_id: dialog.groupId } : {}), sort_order: notebooks.length });
      setDialog(null);
      navigate(`/collections/${notebook.id}`);
    }} /> : null}
    {dialog?.type === "edit-notebook" ? <EditNotebookDialog notebook={dialog.notebook} onClose={() => setDialog(null)} /> : null}
  </DocumentShell>;
}


import { emptyPanelClassName } from "../../shared/ui/surface-styles";
import { cn } from "@orbis/ui/cn";
import { workbenchStyles } from "@/shared/ui/workbench-styles";
import { releaseFeatures } from "../../shared/release-features";
import { reportError } from "../../shared/api/request-feedback";
import { LoadingState } from "../../shared/ui/LoadingState";
import { Button } from "@orbis/ui/button";
import {
  Archive,
  BookOpen,
  ChevronDown,
  FolderPlus,
  MoreHorizontal,
  Pin,
  Plus,
} from "../../shared/ui/icons";
import { useEffect, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { useStore } from "zustand";
import { z } from "zod";

import type { DocumentGroup, Notebook } from "../../shared/api/schemas";
import { authStore } from "../../shared/auth/auth-store";

import { PageContainer } from "../../shared/ui/PageContainer";
import { DocumentShell } from "./DocumentShell";
import { canMutateWorkspaceContent } from "../workspace/capabilities";
import { usePinnedNotebooks } from "./pinned-notebooks";
import { useCollapsedGroups } from "./collapsed-groups";
import { NotebookDialog } from "./NotebookDialog";
import { NotebookCard } from "./NotebookCard";
import type { NotebookIconValue } from "./notebook-icons";
import { ResourceDialog } from "./ResourceDialog";
import { SearchGroupTarget } from "../search/SearchGroupTarget";
import { useNotebookDocumentCounts } from "./notebook-counts";
import {
  useArchiveDocumentGroup,
  useArchiveNotebook,
  useCreateDocumentGroup,
  useCreateNote,
  useCreateNotebook,
  useDocumentGroups,
  useNotebooks,
  useUpdateDocumentGroup,
  useUpdateNotebook,
} from "./queries";

type DialogState =
  | { kind: "group" }
  | { kind: "notebook"; groupId: string }
  | { kind: "rename-group"; resource: DocumentGroup }
  | { kind: "edit-notebook"; resource: Notebook }
  | null;

type CollectionLocationState = {
  resourceError?: string;
};

export function CollectionsPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const parsedGroup = z.string().uuid().safeParse(new URLSearchParams(location.search).get("group"));
  const targetGroupId = parsedGroup.success ? parsedGroup.data : null;
  const focusedGroup = useRef<string | null>(null);
  const workspace = useStore(authStore, (state) => state.workspace);
  const { isCollapsed, toggleGroup } = useCollapsedGroups(workspace?.id);
  const canEdit = canMutateWorkspaceContent(workspace);
  const { isPinned, togglePin } = usePinnedNotebooks(workspace?.id);
  const [dialog, setDialog] = useState<DialogState>(null);
  const groupsQuery = useDocumentGroups();
  const notebooksQuery = useNotebooks();
  const { counts: notebookCounts } = useNotebookDocumentCounts();
  const createGroup = useCreateDocumentGroup();
  const updateGroup = useUpdateDocumentGroup();
  const archiveGroup = useArchiveDocumentGroup();
  const createNotebook = useCreateNotebook();
  const updateNotebook = useUpdateNotebook();
  const archiveNotebook = useArchiveNotebook();
  const createNote = useCreateNote();
  const groups = groupsQuery.data?.items ?? [];
  const notebooks = notebooksQuery.data?.items ?? [];
  useEffect(() => {
    if (!targetGroupId) { focusedGroup.current = null; return; }
    if (focusedGroup.current === targetGroupId || !groups.some(group => group.id === targetGroupId)) return;
    if (isCollapsed(targetGroupId)) toggleGroup(targetGroupId);
    const target = document.getElementById(`group-${targetGroupId}`);
    if (!target) return;
    target.focus({ preventScroll: true });
    target.scrollIntoView?.({ block: "nearest" });
    focusedGroup.current = targetGroupId;
  }, [targetGroupId, groups, isCollapsed, toggleGroup]);
  const resourceError = (location.state as CollectionLocationState | null)
    ?.resourceError;
  const shownResourceError = useRef<string | null>(null);
  useEffect(() => {
    if (!resourceError || shownResourceError.current === resourceError) return;
    shownResourceError.current = resourceError;
    reportError(resourceError);
    navigate(location.pathname, { replace: true, state: null });
  }, [location.pathname, navigate, resourceError]);

  async function handleDialog(value: string, icon?: NotebookIconValue | null) {
    if (!dialog) return;
    if (dialog.kind === "group")
      await createGroup.mutateAsync({ name: value, sort_order: groups.length });
    else if (dialog.kind === "notebook") {
      const notebook = await createNotebook.mutateAsync({
        title: value,
        icon,
        group_id: dialog.groupId,
        sort_order: notebooks.length,
      });
      navigate(`/collections/${notebook.id}`);
    } else if (dialog.kind === "rename-group")
      await updateGroup.mutateAsync({ id: dialog.resource.id,expected_version:dialog.resource.version, name: value });
    else
      await updateNotebook.mutateAsync({
        id: dialog.resource.id,
        expected_version:dialog.resource.metadata_version,
        title: value,
        icon,
      });
    setDialog(null);
  }

  async function createFirstDocument(notebook: Notebook) {
    const note = await createNote.mutateAsync({
      notebook_id: notebook.id,
      title: "未命名文档",
      parent_id: null,
      sort_order: notebookCounts.get(notebook.id) ?? 0,
    });
    navigate(`/documents/${note.id}`);
  }

  const dialogCopy = dialog?.kind === "group"
    ? { title: "新建分组", label: "分组名称", placeholder: "例如：产品研发", initialValue: "", submitLabel: "创建分组" }
    : dialog?.kind === "rename-group"
      ? { title: "重命名分组", label: "分组名称", placeholder: "分组名称", initialValue: dialog.resource.name, submitLabel: "保存" }
      : null;

  return (
    <DocumentShell>
      <PageContainer
        title="我的笔记本"
        description={`${notebooks.length} 个笔记本 · ${groups.length} 个分组`}
        actions={
          canEdit ? (
            <>
              <Button
                variant="secondary"

                onClick={() => setDialog({ kind: "group" })}
              ><FolderPlus aria-hidden="true" size={16} />
                新建分组
              </Button>
              <Button
                variant="default"

                onClick={() =>
                  groups[0] &&
                  setDialog({ kind: "notebook", groupId: groups[0].id })
                }
                disabled={!groups.length}
              ><Plus aria-hidden="true" size={16} />
                新建笔记本
              </Button>
            </>
          ) : null
        }
      >

        <section className={workbenchStyles.section} aria-label="笔记本">
          {targetGroupId && !groupsQuery.isLoading && !groups.some(group => group.id === targetGroupId) ? <SearchGroupTarget id={targetGroupId} canCreate={canEdit} onCreate={() => setDialog({ kind: "notebook", groupId: targetGroupId })} /> : null}
          {groupsQuery.isLoading || notebooksQuery.isLoading ? (
            <LoadingState label="正在加载笔记本…" variant="cards" />
          ) : null}
          {!groupsQuery.isLoading && !notebooks.length ? (
            <div className={emptyPanelClassName}>
              <BookOpen aria-hidden="true" className="mx-auto mb-3" size={24} />
              <div className="font-semibold text-foreground">还没有笔记本</div>
              <p className="mt-1">先在默认分组下创建一个笔记本。</p>
              {canEdit && groups[0] ? (
                <Button
                  className="mt-4"
                  variant="default"
                  onClick={() =>
                    setDialog({ kind: "notebook", groupId: groups[0].id })
                  }
                >
                  创建第一个笔记本
                </Button>
              ) : null}
            </div>
          ) : null}
          <div className="workbench-collection-groups flex flex-col gap-9">
            {groups.map((group) => {
              const groupNotebooks = notebooks.filter(
                (notebook) => notebook.group_id === group.id,
              );
              const collapsed = isCollapsed(group.id);
              const contentId = `notebook-group-${group.id}`;
              return (
                <div key={group.id} id={`group-${group.id}`} tabIndex={targetGroupId === group.id ? -1 : undefined} className={`workbench-collection-group${collapsed ? " is-collapsed" : ""}`}>
                  <div className={cn(workbenchStyles.sectionHeading, collapsed && "mb-0")}>
                    <h2 className={`${workbenchStyles.sectionTitle} workbench-group-heading min-w-0 flex-1`}><Button type="button" className="workbench-group-toggle group/workbench-group flex min-h-(--ob-control-height-md) w-full min-w-0 flex-1 items-center gap-2 text-start [&>span:not(.workbench-group-name)]:shrink-0" aria-expanded={!collapsed} aria-controls={contentId} aria-label={`${collapsed ? "展开" : "收起"}分组 ${group.name}${group.is_default ? " 默认" : ""} ${groupNotebooks.length}`} onClick={() => toggleGroup(group.id)} variant="ghost">
                      <ChevronDown size={16} aria-hidden="true" className="workbench-group-chevron shrink-0 text-(--muted-foreground) transition-transform duration-(--ob-motion-feedback) group-aria-[expanded=false]/workbench-group:-rotate-90 motion-reduce:transition-none" />
                      <span className="workbench-group-name min-w-0 flex-[0_1_auto] truncate group-hover/workbench-group:text-foreground" title={group.name}>{group.name}</span>
                      {group.is_default ? (
                        <span className="workbench-group-default text-xs leading-[18px]">默认</span>
                      ) : null}
                      <span className="text-xs">
                        {groupNotebooks.length}
                      </span>
                    </Button></h2>
                    {canEdit ? (
                      <div className="flex items-center gap-1">
                        <Button

                          type="button"
                          aria-label="+ 笔记本"
                          onClick={() =>
                            setDialog({ kind: "notebook", groupId: group.id })
                          } variant="ghost"
                        >
                          <Plus aria-hidden="true" size={16} />笔记本
                        </Button>
                        <Button

                          type="button"
                          aria-label={`重命名 ${group.name}`}
                          onClick={() =>
                            setDialog({ kind: "rename-group", resource: group })
                          } variant="ghost" size="icon"
                        >
                          <MoreHorizontal aria-hidden="true" size={16} />
                        </Button>
                        {!group.is_default ? (
                          <Button

                            type="button"
                            aria-label={`归档 ${group.name}`}
                            onClick={() =>
                              archiveGroup.mutate({
                                id: group.id,
                                expected_version:group.version,
                                archived: true,
                              })
                            } variant="ghost" size="icon"
                          >
                            <Archive aria-hidden="true" size={14} />
                          </Button>
                        ) : null}
                      </div>
                    ) : null}
                  </div>
                  <div id={contentId} hidden={collapsed}>
                  {groupNotebooks.length ? (
                    <div className={workbenchStyles.resourceGrid}>
                      {groupNotebooks.map((notebook) => (
                        <NotebookCard key={notebook.id} notebook={notebook} variant="collection" noteCount={notebookCounts.get(notebook.id) ?? 0} actions={<>
                            {releaseFeatures.documentFavorites && <Button
                              type="button"
                              className={isPinned(notebook.id) ? "is-pinned" : undefined}
                              aria-label={isPinned(notebook.id) ? `取消常用 ${notebook.title}` : `设为常用 ${notebook.title}`}
                              aria-pressed={isPinned(notebook.id)}
                              onClick={() => togglePin(notebook.id)} variant="ghost" size="icon"
                            >
                              <Pin aria-hidden="true" size={14} />
                            </Button>}
                            {canEdit ? <>
                              <Button type="button"  aria-label={`编辑笔记本 ${notebook.title}`} title="编辑名称和图标" onClick={() => setDialog({ kind: "edit-notebook", resource: notebook })} variant="ghost" size="icon">
                                <MoreHorizontal aria-hidden="true" size={16} />
                              </Button>
                              <Button type="button"  aria-label={`归档 ${notebook.title}`} onClick={() => archiveNotebook.mutate({ id: notebook.id, expected_directory_version:notebook.directory_version, archived: true })} variant="ghost" size="icon">
                                <Archive aria-hidden="true" size={14} />
                              </Button>
                            </> : null}
                        </>} footer={canEdit && (notebookCounts.get(notebook.id) ?? 0) === 0 ? (
                            <Button variant="ghost" className="workbench-collection-create ms-[54px] enabled:hover:text-foreground"  onClick={() => createFirstDocument(notebook)}><Plus aria-hidden="true" size={16} />新建文档</Button>
                          ) : null} />
                      ))}
                    </div>
                  ) : (
                    <Button
                      type="button"
                      disabled={!canEdit}
                      onClick={() =>
                        setDialog({ kind: "notebook", groupId: group.id })
                      }
                      className="workbench-empty-group w-full border border-dashed border-border p-6 text-start text-sm leading-5 text-(--muted-foreground) enabled:hover:border-ring enabled:hover:bg-(--accent) disabled:cursor-default" variant="ghost"
                    >
                      此分组暂无笔记本{canEdit ? "，点击创建" : ""}
                    </Button>
                  )}
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      </PageContainer>
      {dialog?.kind === "notebook" || dialog?.kind === "edit-notebook" ? (
        <NotebookDialog
          open
          title={dialog.kind === "notebook" ? "新建笔记本" : "编辑笔记本"}
          initialValue={dialog.kind === "edit-notebook" ? dialog.resource.title : ""}
          initialIcon={dialog.kind === "edit-notebook" ? dialog.resource.icon : null}
          submitLabel={dialog.kind === "notebook" ? "创建笔记本" : "保存"}
          pending={createNotebook.isPending || updateNotebook.isPending}
          onClose={() => setDialog(null)}
          onSubmit={({ title, icon }) => handleDialog(title, icon)}
        />
      ) : dialogCopy ? (
        <ResourceDialog
          open
          title={dialogCopy.title}
          label={dialogCopy.label}
          placeholder={dialogCopy.placeholder}
          initialValue={dialogCopy.initialValue}
          submitLabel={dialogCopy.submitLabel}
          pending={
            createGroup.isPending ||
            createNotebook.isPending ||
            updateGroup.isPending ||
            updateNotebook.isPending
          }
          onClose={() => setDialog(null)}
          onSubmit={handleDialog}
        />
      ) : null}
    </DocumentShell>
  );
}

import { releaseFeatures } from "../../shared/release-features";
import { reportError } from "../../shared/api/request-feedback";
import { LoadingState } from "../../shared/ui/LoadingState";
import { ActionButton } from "../../shared/ui/ActionButton";
import {
  Archive,
  BookOpen,
  ChevronDown,
  FolderPlus,
  MoreHorizontal,
  Pin,
  Plus,
} from "../../shared/ui/icons";
import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { useStore } from "zustand";
import { z } from "zod";

import type { DocumentGroup, Notebook } from "../../shared/api/schemas";
import { authStore } from "../../shared/auth/auth-store";
import { formatDate } from "../../shared/format/date";
import { Button } from "../../shared/ui/Button";
import { PageContainer } from "../../shared/ui/PageContainer";
import { DocumentShell } from "./DocumentShell";
import { canMutateWorkspaceContent } from "../workspace/capabilities";
import { usePinnedNotebooks } from "./pinned-notebooks";
import { useCollapsedGroups } from "./collapsed-groups";
import { NotebookDialog } from "./NotebookDialog";
import { NotebookIcon } from "./NotebookIcon";
import type { NotebookIconValue } from "./notebook-icons";
import { ResourceDialog } from "./ResourceDialog";
import { SearchGroupTarget } from "../search/SearchGroupTarget";
import {
  useArchiveDocumentGroup,
  useArchiveNotebook,
  useCreateDocumentGroup,
  useCreateNote,
  useCreateNotebook,
  useDocumentGroups,
  useNotebooks,
  useDocumentIndex,
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
  const notesQuery = useDocumentIndex("active", { allPages:true });
  const createGroup = useCreateDocumentGroup();
  const updateGroup = useUpdateDocumentGroup();
  const archiveGroup = useArchiveDocumentGroup();
  const createNotebook = useCreateNotebook();
  const updateNotebook = useUpdateNotebook();
  const archiveNotebook = useArchiveNotebook();
  const createNote = useCreateNote();
  const groups = groupsQuery.data?.items ?? [];
  const notebooks = notebooksQuery.data?.items ?? [];
  const notes = notesQuery.data?.items ?? [];
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
  const notebookCounts = useMemo(
    () =>
      notes.reduce(
        (counts, note) =>
          counts.set(note.notebook_id, (counts.get(note.notebook_id) ?? 0) + 1),
        new Map<string, number>(),
      ),
    [notes],
  );

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
                icon={<FolderPlus aria-hidden="true" size={16} />}
                onClick={() => setDialog({ kind: "group" })}
              >
                新建分组
              </Button>
              <Button
                variant="primary"
                icon={<Plus aria-hidden="true" size={16} />}
                onClick={() =>
                  groups[0] &&
                  setDialog({ kind: "notebook", groupId: groups[0].id })
                }
                disabled={!groups.length}
              >
                新建笔记本
              </Button>
            </>
          ) : null
        }
      >

        <section className="workbench-section" aria-label="笔记本">
          {targetGroupId && !groupsQuery.isLoading && !groups.some(group => group.id === targetGroupId) ? <SearchGroupTarget id={targetGroupId} canCreate={canEdit} onCreate={() => setDialog({ kind: "notebook", groupId: targetGroupId })} /> : null}
          {groupsQuery.isLoading || notebooksQuery.isLoading ? (
            <LoadingState label="正在加载笔记本…" variant="cards" />
          ) : null}
          {!groupsQuery.isLoading && !notebooks.length ? (
            <div className="empty-panel">
              <BookOpen aria-hidden="true" className="mx-auto mb-3" size={24} />
              <div className="font-semibold text-[var(--text-primary)]">还没有笔记本</div>
              <p className="mt-1">先在默认分组下创建一个笔记本。</p>
              {canEdit && groups[0] ? (
                <Button
                  className="mt-4"
                  variant="primary"
                  onClick={() =>
                    setDialog({ kind: "notebook", groupId: groups[0].id })
                  }
                >
                  创建第一个笔记本
                </Button>
              ) : null}
            </div>
          ) : null}
          <div className="workbench-collection-groups">
            {groups.map((group) => {
              const groupNotebooks = notebooks.filter(
                (notebook) => notebook.group_id === group.id,
              );
              const collapsed = isCollapsed(group.id);
              const contentId = `notebook-group-${group.id}`;
              return (
                <div key={group.id} id={`group-${group.id}`} tabIndex={targetGroupId === group.id ? -1 : undefined} className={`workbench-collection-group${collapsed ? " is-collapsed" : ""}`}>
                  <div className="workbench-section-heading">
                    <h3 className="workbench-group-heading"><ActionButton type="button" className="workbench-group-toggle" aria-expanded={!collapsed} aria-controls={contentId} aria-label={`${collapsed ? "展开" : "收起"}分组 ${group.name}`} onClick={() => toggleGroup(group.id)}>
                      <ChevronDown size={16} aria-hidden="true" className="workbench-group-chevron" />
                      <span className="workbench-group-name" title={group.name}>{group.name}</span>
                      {group.is_default ? (
                        <span className="workbench-group-default">默认</span>
                      ) : null}
                      <span className="text-xs text-[var(--muted-light)]">
                        {groupNotebooks.length}
                      </span>
                    </ActionButton></h3>
                    {canEdit ? (
                      <div className="flex items-center gap-1">
                        <ActionButton
                          className="text-action"
                          type="button"
                          aria-label="+ 笔记本"
                          onClick={() =>
                            setDialog({ kind: "notebook", groupId: group.id })
                          }
                        >
                          <Plus aria-hidden="true" size={16} />笔记本
                        </ActionButton>
                        <ActionButton
                          className="icon-button"
                          type="button"
                          aria-label={`重命名 ${group.name}`}
                          onClick={() =>
                            setDialog({ kind: "rename-group", resource: group })
                          }
                        >
                          <MoreHorizontal aria-hidden="true" size={16} />
                        </ActionButton>
                        {!group.is_default ? (
                          <ActionButton
                            className="icon-button danger-hover"
                            type="button"
                            aria-label={`归档 ${group.name}`}
                            onClick={() =>
                              archiveGroup.mutate({
                                id: group.id,
                                expected_version:group.version,
                                archived: true,
                              })
                            }
                          >
                            <Archive aria-hidden="true" size={14} />
                          </ActionButton>
                        ) : null}
                      </div>
                    ) : null}
                  </div>
                  <div id={contentId} hidden={collapsed}>
                  {groupNotebooks.length ? (
                    <div className="workbench-resource-grid">
                      {groupNotebooks.map((notebook) => (
                        <article key={notebook.id} className="workbench-collection-card">
                          <Link to={`/collections/${notebook.id}`} className="workbench-collection-link">
                            <NotebookIcon icon={notebook.icon} />
                            <span className="workbench-resource-copy">
                              <strong>{notebook.title}</strong>
                              <span>{notebookCounts.get(notebook.id) ?? 0} 篇文档 · 更新于 {formatDate(notebook.updated_at_ms)}</span>
                            </span>
                          </Link>
                          <div className="workbench-collection-actions">
                            {releaseFeatures.documentFavorites && <ActionButton
                              type="button"
                              className={`icon-button${isPinned(notebook.id) ? " is-pinned" : ""}`}
                              aria-label={isPinned(notebook.id) ? `移出快捷访问 ${notebook.title}` : `加入快捷访问 ${notebook.title}`}
                              aria-pressed={isPinned(notebook.id)}
                              onClick={() => togglePin(notebook.id)}
                            >
                              <Pin aria-hidden="true" size={14} />
                            </ActionButton>}
                            {canEdit ? <>
                              <ActionButton type="button" className="icon-button" aria-label={`编辑笔记本 ${notebook.title}`} title="编辑名称和图标" onClick={() => setDialog({ kind: "edit-notebook", resource: notebook })}>
                                <MoreHorizontal aria-hidden="true" size={16} />
                              </ActionButton>
                              <ActionButton type="button" className="icon-button danger-hover" aria-label={`归档 ${notebook.title}`} onClick={() => archiveNotebook.mutate({ id: notebook.id, expected_directory_version:notebook.directory_version, archived: true })}>
                                <Archive aria-hidden="true" size={14} />
                              </ActionButton>
                            </> : null}
                          </div>
                          {canEdit && (notebookCounts.get(notebook.id) ?? 0) === 0 ? (
                            <div className="workbench-collection-footer"><Button variant="ghost" className="workbench-collection-create" icon={<Plus aria-hidden="true" size={16} />} onClick={() => createFirstDocument(notebook)}>新建文档</Button></div>
                          ) : null}
                        </article>
                      ))}
                    </div>
                  ) : (
                    <ActionButton
                      type="button"
                      disabled={!canEdit}
                      onClick={() =>
                        setDialog({ kind: "notebook", groupId: group.id })
                      }
                      className="workbench-empty-group"
                    >
                      此分组暂无笔记本{canEdit ? "，点击创建" : ""}
                    </ActionButton>
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

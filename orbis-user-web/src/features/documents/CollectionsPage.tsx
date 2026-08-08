import {
  Archive,
  BookOpen,
  FolderPlus,
  MoreHorizontal,
  Plus,
} from "lucide-react";
import { useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useStore } from "zustand";

import type { DocumentGroup, Notebook } from "../../shared/api/schemas";
import { authStore } from "../../shared/auth/auth-store";
import { Button } from "../../shared/ui/Button";
import { StatusMessage } from "../../shared/ui/StatusMessage";
import { DocumentShell } from "./DocumentShell";
import { ResourceDialog } from "./ResourceDialog";
import {
  useArchiveDocumentGroup,
  useArchiveNotebook,
  useCreateDocumentGroup,
  useCreateNote,
  useCreateNotebook,
  useDocumentGroups,
  useNotebooks,
  useNoteSearch,
  useUpdateDocumentGroup,
  useUpdateNotebook,
} from "./queries";

type DialogState =
  | { kind: "group" }
  | { kind: "notebook"; groupId: string }
  | { kind: "rename-group"; resource: DocumentGroup }
  | { kind: "rename-notebook"; resource: Notebook }
  | null;

function formatDate(value: number): string {
  return new Intl.DateTimeFormat("zh-CN", {
    month: "short",
    day: "numeric",
  }).format(new Date(value));
}

export function CollectionsPage() {
  const navigate = useNavigate();
  const workspace = useStore(authStore, (state) => state.workspace);
  const canEdit = workspace?.role !== "normal";
  const [dialog, setDialog] = useState<DialogState>(null);
  const groupsQuery = useDocumentGroups();
  const notebooksQuery = useNotebooks();
  const notesQuery = useNoteSearch("");
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
  const notebookCounts = useMemo(
    () =>
      notes.reduce(
        (counts, note) =>
          counts.set(note.notebook_id, (counts.get(note.notebook_id) ?? 0) + 1),
        new Map<string, number>(),
      ),
    [notes],
  );

  async function handleDialog(value: string) {
    if (!dialog) return;
    if (dialog.kind === "group")
      await createGroup.mutateAsync({ name: value, sort_order: groups.length });
    else if (dialog.kind === "notebook") {
      const notebook = await createNotebook.mutateAsync({
        title: value,
        group_id: dialog.groupId,
        sort_order: notebooks.length,
      });
      navigate(`/collections/${notebook.id}`);
    } else if (dialog.kind === "rename-group")
      await updateGroup.mutateAsync({ id: dialog.resource.id, name: value });
    else
      await updateNotebook.mutateAsync({
        id: dialog.resource.id,
        title: value,
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

  const dialogCopy =
    dialog?.kind === "group"
      ? {
          title: "新建分组",
          label: "分组名称",
          placeholder: "例如：产品研发",
          initialValue: "",
          submitLabel: "创建分组",
        }
      : dialog?.kind === "notebook"
        ? {
            title: "新建文集",
            label: "文集名称",
            placeholder: "例如：Orbis 产品手册",
            initialValue: "",
            submitLabel: "创建文集",
          }
        : dialog?.kind === "rename-group"
          ? {
              title: "重命名分组",
              label: "分组名称",
              placeholder: "分组名称",
              initialValue: dialog.resource.name,
              submitLabel: "保存",
            }
          : dialog?.kind === "rename-notebook"
            ? {
                title: "重命名文集",
                label: "文集名称",
                placeholder: "文集名称",
                initialValue: dialog.resource.title,
                submitLabel: "保存",
              }
            : null;

  return (
    <DocumentShell
      toolbar={
        canEdit ? (
          <Button
            variant="primary"
            icon={<Plus aria-hidden="true" size={15} />}
            onClick={() =>
              groups[0] &&
              setDialog({ kind: "notebook", groupId: groups[0].id })
            }
            disabled={!groups.length}
          >
            新建文集
          </Button>
        ) : null
      }
    >
      <div className="mx-auto max-w-[1240px] px-5 py-8 lg:px-10 lg:py-10">
        <header className="mb-9">
          <div className="mb-2 text-xs font-semibold uppercase tracking-[0.18em] text-[var(--muted-light)]">
            Workspace / Documents
          </div>
          <h1 className="text-4xl font-semibold tracking-[-0.045em] lg:text-5xl">
            我的文集
          </h1>
          <p className="mt-3 max-w-xl text-sm leading-6 text-[var(--muted)]">
            在清晰的层级中管理分组、文集和文档目录。
          </p>
        </header>
        {groupsQuery.isError || notebooksQuery.isError || notesQuery.isError ? (
          <StatusMessage tone="error" title="文集加载失败">
            请检查 API 服务后重试。
          </StatusMessage>
        ) : null}
        <section aria-label="文集">
          <div className="section-heading">
            <div>
              <h2>文集管理</h2>
              <p>{notebooks.length} 个文集，按工作主题归档</p>
            </div>
            {canEdit ? (
              <Button
                variant="secondary"
                icon={<FolderPlus aria-hidden="true" size={15} />}
                onClick={() => setDialog({ kind: "group" })}
              >
                新建分组
              </Button>
            ) : null}
          </div>
          {groupsQuery.isLoading || notebooksQuery.isLoading ? (
            <div className="empty-panel">正在加载文集…</div>
          ) : null}
          {!groupsQuery.isLoading && !notebooks.length ? (
            <div className="empty-panel">
              <BookOpen aria-hidden="true" className="mx-auto mb-3" size={24} />
              <div className="font-semibold text-black">还没有文集</div>
              <p className="mt-1">先在默认分组下创建一个文集。</p>
              {canEdit && groups[0] ? (
                <Button
                  className="mt-4"
                  variant="primary"
                  onClick={() =>
                    setDialog({ kind: "notebook", groupId: groups[0].id })
                  }
                >
                  创建第一个文集
                </Button>
              ) : null}
            </div>
          ) : null}
          <div className="space-y-8">
            {groups.map((group) => {
              const groupNotebooks = notebooks.filter(
                (notebook) => notebook.group_id === group.id,
              );
              return (
                <div key={group.id}>
                  <div className="mb-3 flex items-center justify-between gap-3">
                    <div className="flex items-center gap-2">
                      <h3 className="text-sm font-semibold">{group.name}</h3>
                      {group.is_default ? (
                        <span className="tag">默认</span>
                      ) : null}
                      <span className="text-xs text-[var(--muted-light)]">
                        {groupNotebooks.length}
                      </span>
                    </div>
                    {canEdit ? (
                      <div className="flex items-center gap-1">
                        <button
                          className="text-action"
                          type="button"
                          onClick={() =>
                            setDialog({ kind: "notebook", groupId: group.id })
                          }
                        >
                          + 文集
                        </button>
                        <button
                          className="icon-button"
                          type="button"
                          aria-label={`重命名 ${group.name}`}
                          onClick={() =>
                            setDialog({ kind: "rename-group", resource: group })
                          }
                        >
                          <MoreHorizontal aria-hidden="true" size={15} />
                        </button>
                        {!group.is_default ? (
                          <button
                            className="icon-button danger-hover"
                            type="button"
                            aria-label={`归档 ${group.name}`}
                            onClick={() =>
                              archiveGroup.mutate({
                                id: group.id,
                                archived: true,
                              })
                            }
                          >
                            <Archive aria-hidden="true" size={14} />
                          </button>
                        ) : null}
                      </div>
                    ) : null}
                  </div>
                  {groupNotebooks.length ? (
                    <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                      {groupNotebooks.map((notebook) => (
                        <article
                          key={notebook.id}
                          className="collection-card group/card"
                        >
                          <Link
                            to={`/collections/${notebook.id}`}
                            className="block min-w-0 flex-1"
                          >
                            <div className="mb-8 document-icon">
                              <BookOpen aria-hidden="true" size={19} />
                            </div>
                            <h4 className="truncate text-base font-semibold">
                              {notebook.title}
                            </h4>
                            <p className="mt-2 text-xs text-[var(--muted)]">
                              {notebookCounts.get(notebook.id) ?? 0} 篇文档 ·
                              更新于 {formatDate(notebook.updated_at_ms)}
                            </p>
                          </Link>
                          {canEdit ? (
                            <div className="ml-2 flex shrink-0 flex-col gap-1 opacity-0 transition group-hover/card:opacity-100">
                              <button
                                type="button"
                                className="icon-button"
                                aria-label={`重命名 ${notebook.title}`}
                                onClick={() =>
                                  setDialog({
                                    kind: "rename-notebook",
                                    resource: notebook,
                                  })
                                }
                              >
                                <MoreHorizontal aria-hidden="true" size={15} />
                              </button>
                              <button
                                type="button"
                                className="icon-button danger-hover"
                                aria-label={`归档 ${notebook.title}`}
                                onClick={() =>
                                  archiveNotebook.mutate({
                                    id: notebook.id,
                                    archived: true,
                                  })
                                }
                              >
                                <Archive aria-hidden="true" size={14} />
                              </button>
                            </div>
                          ) : null}
                          {canEdit &&
                          (notebookCounts.get(notebook.id) ?? 0) === 0 ? (
                            <button
                              type="button"
                              className="absolute bottom-4 right-4 text-action"
                              onClick={() => createFirstDocument(notebook)}
                            >
                              新建文档
                            </button>
                          ) : null}
                        </article>
                      ))}
                    </div>
                  ) : (
                    <button
                      type="button"
                      disabled={!canEdit}
                      onClick={() =>
                        setDialog({ kind: "notebook", groupId: group.id })
                      }
                      className="w-full rounded-xl border border-dashed border-[var(--border-strong)] bg-white/40 p-6 text-sm text-[var(--muted)] hover:border-black/30 disabled:cursor-default"
                    >
                      此分组暂无文集{canEdit ? "，点击创建" : ""}
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        </section>
      </div>
      {dialogCopy ? (
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

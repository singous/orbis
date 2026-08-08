import {
  ArchiveRestore,
  BookOpen,
  FilePlus2,
  FolderKanban,
} from "lucide-react";
import type { ReactNode } from "react";
import { useStore } from "zustand";

import { authStore } from "../../shared/auth/auth-store";
import { StatusMessage } from "../../shared/ui/StatusMessage";
import { DocumentShell } from "./DocumentShell";
import { canMutateWorkspaceContent } from "../workspace/capabilities";
import {
  useArchiveDocumentGroup,
  useArchiveNotebook,
  useArchiveNote,
  useDocumentGroups,
  useNotebooks,
  useNoteSearch,
} from "./queries";

type ArchiveResource = {
  id: string;
  label: string;
  parentLabel?: string;
  restoreBlockedReason?: string;
};

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "恢复失败，请稍后重试。";
}

function ArchiveSection({
  title,
  icon,
  resources,
  canRestore,
  onRestore,
  pendingId,
  errorId,
  error,
}: {
  title: string;
  icon: ReactNode;
  resources: ArchiveResource[];
  canRestore: boolean;
  onRestore: (id: string) => void;
  pendingId?: string;
  errorId?: string;
  error?: unknown;
}) {
  return (
    <section className="mb-8">
      <div className="section-heading">
        <div>
          <h2>{title}</h2>
          <p>{resources.length} 项已归档</p>
        </div>
      </div>
      {resources.length ? (
        <div className="divide-y divide-[var(--border)] overflow-hidden rounded-xl border border-[var(--border)] bg-white">
          {resources.map((resource) => (
            <div
              key={resource.id}
              className="flex items-center gap-3 px-4 py-3.5"
            >
              <div className="document-icon small">{icon}</div>
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-semibold">{resource.label}</div>
                {resource.parentLabel ? (
                  <div className="mt-1 text-xs text-[var(--muted)]">
                    {resource.parentLabel}
                  </div>
                ) : null}
                {resource.restoreBlockedReason ? (
                  <div className="mt-1 text-xs text-[var(--warning-text)]">
                    {resource.restoreBlockedReason}
                  </div>
                ) : null}
                {pendingId === resource.id ? (
                  <div className="mt-1 text-xs text-[var(--muted)]">正在恢复…</div>
                ) : null}
                {errorId === resource.id && error ? (
                  <div role="alert" className="mt-1 text-xs text-[var(--danger-text)]">
                    {errorMessage(error)}
                  </div>
                ) : null}
              </div>
              {canRestore ? (
                <button
                  type="button"
                  className="text-action inline-flex items-center gap-1"
                  aria-label={pendingId === resource.id ? `正在恢复 ${resource.label}` : `恢复 ${resource.label}`}
                  disabled={Boolean(resource.restoreBlockedReason) || pendingId === resource.id}
                  onClick={() => onRestore(resource.id)}
                >
                  <ArchiveRestore aria-hidden="true" size={14} />
                  {pendingId === resource.id ? "正在恢复" : "恢复"}
                </button>
              ) : null}
            </div>
          ))}
        </div>
      ) : (
        <div className="empty-panel">没有已归档的{title}。</div>
      )}
    </section>
  );
}

export function ArchivePage() {
  const workspace = useStore(authStore, (state) => state.workspace);
  const canRestore = canMutateWorkspaceContent(workspace);
  const groupsQuery = useDocumentGroups("archived");
  const notebooksQuery = useNotebooks(undefined, "archived");
  const notesQuery = useNoteSearch("", "archived");
  const archiveGroup = useArchiveDocumentGroup();
  const archiveNotebook = useArchiveNotebook();
  const archiveNote = useArchiveNote();
  const groups = groupsQuery.data?.items ?? [];
  const notebooks = notebooksQuery.data?.items ?? [];
  const notes = notesQuery.data?.items ?? [];
  const archivedGroupsById = new Map(groups.map((group) => [group.id, group]));
  const archivedNotebooksById = new Map(
    notebooks.map((notebook) => [notebook.id, notebook]),
  );

  return (
    <DocumentShell>
      <div className="mx-auto max-w-[1040px] px-5 py-8 lg:px-10 lg:py-10">
        <header className="mb-9">
          <div className="mb-2 text-xs font-semibold uppercase tracking-[0.18em] text-[var(--muted-light)]">
            Documents
          </div>
          <h1 className="text-4xl font-semibold tracking-[-0.045em] lg:text-5xl">
            归档
          </h1>
          <p className="mt-3 text-sm leading-6 text-[var(--muted)]">
            已归档内容不会出现在在线文档中。
            {canRestore
              ? "你可以在此恢复它们。"
              : "只有工作空间管理者可以恢复内容。"}
          </p>
        </header>
        {groupsQuery.isError || notebooksQuery.isError || notesQuery.isError ? (
          <StatusMessage tone="error" title="归档加载失败">
            请检查 API 服务后重试。
          </StatusMessage>
        ) : null}
        {groupsQuery.isLoading ||
        notebooksQuery.isLoading ||
        notesQuery.isLoading ? (
          <div className="empty-panel">正在加载归档…</div>
        ) : null}
        <ArchiveSection
          title="分组"
          icon={<FolderKanban aria-hidden="true" size={14} />}
          resources={groups.map((group) => ({
            id: group.id,
            label: group.name,
          }))}
          canRestore={canRestore}
          onRestore={(id) => archiveGroup.mutate({ id, archived: false })}
          pendingId={archiveGroup.isPending ? archiveGroup.variables?.id : undefined}
          errorId={archiveGroup.isError ? archiveGroup.variables?.id : undefined}
          error={archiveGroup.error}
        />
        <ArchiveSection
          title="文集"
          icon={<BookOpen aria-hidden="true" size={14} />}
          resources={notebooks.map((notebook) => ({
            id: notebook.id,
            label: notebook.title,
            parentLabel: archivedGroupsById.has(notebook.group_id)
              ? `归属分组：${archivedGroupsById.get(notebook.group_id)?.name}`
              : "归属分组：已恢复",
            restoreBlockedReason: archivedGroupsById.has(notebook.group_id)
              ? "请先恢复分组"
              : undefined,
          }))}
          canRestore={canRestore}
          onRestore={(id) => archiveNotebook.mutate({ id, archived: false })}
          pendingId={archiveNotebook.isPending ? archiveNotebook.variables?.id : undefined}
          errorId={archiveNotebook.isError ? archiveNotebook.variables?.id : undefined}
          error={archiveNotebook.error}
        />
        <ArchiveSection
          title="文档"
          icon={<FilePlus2 aria-hidden="true" size={14} />}
          resources={notes.map((note) => ({
            id: note.id,
            label: note.title,
            parentLabel: archivedNotebooksById.has(note.notebook_id)
              ? `归属文集：${archivedNotebooksById.get(note.notebook_id)?.title}`
              : "归属文集：已恢复",
            restoreBlockedReason: archivedNotebooksById.has(note.notebook_id)
              ? "请先恢复文集"
              : undefined,
          }))}
          canRestore={canRestore}
          onRestore={(id) => archiveNote.mutate({ id, archived: false })}
          pendingId={archiveNote.isPending ? archiveNote.variables?.id : undefined}
          errorId={archiveNote.isError ? archiveNote.variables?.id : undefined}
          error={archiveNote.error}
        />
      </div>
    </DocumentShell>
  );
}

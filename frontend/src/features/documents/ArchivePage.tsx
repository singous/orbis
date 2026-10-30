import { reportError } from "../../shared/api/request-feedback";
import { useQueries, useQuery } from "@tanstack/react-query";
import { getDocumentGroup, getNotebook } from "./catalog-api";
import { useDocumentAuth } from "./queries";
import { LoadingState } from "../../shared/ui/LoadingState";
import { ActionButton } from "../../shared/ui/ActionButton";
import {
  ArchiveRestore,
  BookOpen,
  FilePlus2,
  FolderKanban,
} from "../../shared/ui/icons";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { useSearchParams } from "react-router-dom";
import { z } from "zod";
import { useStore } from "zustand";

import { authStore } from "../../shared/auth/auth-store";
import { PageContainer } from "../../shared/ui/PageContainer";
import { DocumentShell } from "./DocumentShell";
import { canMutateWorkspaceContent } from "../workspace/capabilities";
import { useSearchResource } from "../search/use-search-resource";
import { Button } from "../../shared/ui/Button";
import {
  useArchiveDocumentGroup,
  useArchiveNotebook,
  useArchiveNote,
  useDocumentGroups,
  useNotebooks,
  useDocumentIndex,
} from "./queries";

type ArchiveResource = {
  id: string;
  label: string;
  parentLabel?: string;
  restoreBlockedReason?: string;
};

function ArchiveSection({
  title,
  icon,
  resources,
  canRestore,
  onRestore,
  pendingId,
}: {
  title: string;
  icon: ReactNode;
  resources: ArchiveResource[];
  canRestore: boolean;
  onRestore: (id: string) => void;
  pendingId?: string;
}) {
  return (
    <section className="mb-8">
      <div className="section-heading">
        <div>
          <h2>{title}</h2>
          <p>{resources.length} 项内容</p>
        </div>
      </div>
      {resources.length ? (
        <div className="workbench-document-list">
          {resources.map((resource) => (
            <div
              key={resource.id}
              className="workbench-document-row"
            >
              <div className="workbench-list-icon">{icon}</div>
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
              </div>
              {canRestore ? (
                <ActionButton
                  type="button"
                  className="text-action inline-flex items-center gap-1"
                  aria-label={pendingId === resource.id ? `正在恢复 ${resource.label}` : `恢复 ${resource.label}`}
                  disabled={Boolean(resource.restoreBlockedReason) || pendingId === resource.id}
                  onClick={() => onRestore(resource.id)}
                >
                  <ArchiveRestore aria-hidden="true" size={14} />
                  {pendingId === resource.id ? "正在恢复" : "恢复"}
                </ActionButton>
              ) : null}
            </div>
          ))}
        </div>
      ) : (
        <div className="empty-panel">回收站中没有{title}。</div>
      )}
    </section>
  );
}

export function ArchivePage() {
  const [params] = useSearchParams();
  const parsedTarget = z.object({ id: z.string().uuid(), type: z.enum(["document", "notebook", "group"]) }).safeParse({ id: params.get("resource"), type: params.get("type") });
  const target = parsedTarget.success ? parsedTarget.data : null;
  const workspace = useStore(authStore, (state) => state.workspace);
  const canRestore = canMutateWorkspaceContent(workspace);
  const groupsQuery = useDocumentGroups("archived");
  const notebooksQuery = useNotebooks(undefined, "archived");
  const [documentPage,setDocumentPage] = useState(1);
  const notesQuery = useDocumentIndex("archived", { page:documentPage });
  const auth = useDocumentAuth();
  const collectionDetails = useQueries({ queries:[...new Set(notesQuery.data?.items.map(item => item.notebook_id) ?? [])].map(id => ({
    queryKey:["notebook",id], queryFn:({signal}: { signal:AbortSignal }) => getNotebook(id,auth,signal),
  })) });
  const archiveGroup = useArchiveDocumentGroup();
  const archiveNotebook = useArchiveNotebook();
  const archiveNote = useArchiveNote();
  const groups = groupsQuery.data?.items ?? [];
  const notebooks = notebooksQuery.data?.items ?? [];
  const knownNotebooks = collectionDetails.flatMap(query => query.data ? [query.data] : []);
  const notes = notesQuery.data?.items ?? [];
  const archivedGroupsById = new Map(groups.map((group) => [group.id, group]));
  const archivedNotebooksById = new Map(
    notebooks.map((notebook) => [notebook.id, notebook]),
  );
  const notebooksById = new Map(
    [...knownNotebooks, ...notebooks].map((notebook) => [notebook.id, notebook]),
  );
  const archivedNotesById = new Map(notes.map((note) => [note.id, note]));

  function noteRestoreBlockedReason(note: (typeof notes)[number]): string | undefined {
    const notebook = notebooksById.get(note.notebook_id);
    if (!notebook) return "请先载入所属文集信息";
    if ( archivedGroupsById.has(notebook.group_id)) {
      return "请先恢复分组";
    }
    if (archivedNotebooksById.has(note.notebook_id)) {
      return "请先恢复笔记本";
    }
    if (note.parent_id && archivedNotesById.has(note.parent_id)) {
      return "请先恢复父文档";
    }
    return undefined;
  }

  async function completeRestore(action: () => Promise<unknown>) {
    try {
      await action();

    } catch (error) {
      reportError(error);
    }
  }

  return (
    <DocumentShell>
      <PageContainer
        title="回收站"
        description={
          canRestore
            ? "移入回收站的内容不会出现在在线文档中，你可以在此恢复它们。"
            : "移入回收站的内容不会出现在在线文档中。你当前没有恢复内容的权限。"
        }
      >
        {target ? <ArchiveSearchTarget id={target.id} type={target.type} canRestore={canRestore} /> : null}

        {groupsQuery.isLoading ||
        notebooksQuery.isLoading ||
        collectionDetails.some(query => query.isPending) ||
        notesQuery.isLoading ? (
          <LoadingState label="正在加载回收站…" />
        ) : null}
        <ArchiveSection
          title="分组"
          icon={<FolderKanban aria-hidden="true" size={14} />}
          resources={groups.filter(group => !(target?.type === "group" && target.id === group.id)).map((group) => ({
            id: group.id,
            label: group.name,
          }))}
          canRestore={canRestore}
          onRestore={(id) => void completeRestore(() => archiveGroup.mutateAsync({ id, archived: false,expected_version:groups.find(item => item.id===id)!.version }))}
          pendingId={archiveGroup.isPending ? archiveGroup.variables?.id : undefined}
        />
        <ArchiveSection
          title="笔记本"
          icon={<BookOpen aria-hidden="true" size={14} />}
          resources={notebooks.filter(notebook => !(target?.type === "notebook" && target.id === notebook.id)).map((notebook) => ({
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
          onRestore={(id) => void completeRestore(() => archiveNotebook.mutateAsync({ id, archived: false,expected_directory_version:notebooks.find(item => item.id===id)!.directory_version }))}
          pendingId={archiveNotebook.isPending ? archiveNotebook.variables?.id : undefined}
        />
        <ArchiveSection
          title="文档"
          icon={<FilePlus2 aria-hidden="true" size={14} />}
          resources={notes.filter(note => !(target?.type === "document" && target.id === note.id)).map((note) => ({
            id: note.id,
            label: note.title,
            parentLabel: notebooksById.has(note.notebook_id)
              ? `归属笔记本：${notebooksById.get(note.notebook_id)?.title}`
              : "归属笔记本：已恢复",
            restoreBlockedReason: noteRestoreBlockedReason(note),
          }))}
          canRestore={canRestore}
          onRestore={(id) => void completeRestore(() => archiveNote.mutateAsync({ id, archived: false,expected_directory_version:notebooksById.get(archivedNotesById.get(id)!.notebook_id)!.directory_version }))}
          pendingId={archiveNote.isPending ? archiveNote.variables?.id : undefined}
        />
        <div className="collaboration-actions"><Button size="sm" disabled={documentPage<=1 || notesQuery.isFetching} onClick={() => setDocumentPage(value=>value-1)}>上一页回收站文档</Button><span>第 {documentPage} 页</span><Button size="sm" disabled={!notesQuery.data?.pagination.has_next || notesQuery.isFetching} onClick={() => setDocumentPage(value=>value+1)}>下一页回收站文档</Button></div>
      </PageContainer>
    </DocumentShell>
  );
}

function ArchiveSearchTarget({ id, type, canRestore }: { id: string; type: "document" | "notebook" | "group"; canRestore: boolean }) {
  const query = useSearchResource(type, id, "archived");
  const auth = useDocumentAuth();
  const info = useQuery({
    queryKey:["archive-target-version",type,id,query.data?.notebook_id],
    enabled:Boolean(query.data && (type!=="document" || query.data.notebook_id)),
    queryFn:async ({signal}) => type==="group" ? (await getDocumentGroup(id,auth,signal)).version
      : (await getNotebook(type==="notebook" ? id : query.data!.notebook_id!,auth,signal)).directory_version,
  });
  const archiveGroup = useArchiveDocumentGroup();
  const archiveNotebook = useArchiveNotebook();
  const archiveNote = useArchiveNote();
  const action = type === "group" ? archiveGroup : type === "notebook" ? archiveNotebook : archiveNote;
  const target = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!query.data) return;
    target.current?.focus({ preventScroll: true });
    target.current?.scrollIntoView?.({ block: "nearest" });
  }, [query.data?.id]);
  async function restore() {
    try {
      if (info.data === undefined) throw new Error("资源版本尚未载入，请重试。");
      if (type==="group") await archiveGroup.mutateAsync({ id,archived:false,expected_version:info.data });
      else if (type==="notebook") await archiveNotebook.mutateAsync({ id,archived:false,expected_directory_version:info.data });
      else await archiveNote.mutateAsync({ id,archived:false,expected_directory_version:info.data });

    } catch (error) {
      reportError(error);
    }
  }
  if (query.isPending) return <LoadingState label="正在定位回收站内容…" />;
  if (query.isError) return null;
  if (!query.data) return null;
  const Icon = type === "group" ? FolderKanban : type === "notebook" ? BookOpen : FilePlus2;
  return <div ref={target} tabIndex={-1} aria-label="搜索定位的回收站内容">
    {canRestore && info.isPending ? <LoadingState label="正在准备恢复…" compact /> : null}

    <ArchiveSection title="搜索定位" icon={<Icon aria-hidden="true" size={18} />} resources={[{ id, label: query.data.title, parentLabel: query.data.location }]} canRestore={canRestore && info.data!==undefined && !info.isError} onRestore={() => void restore()} pendingId={action.isPending ? id : undefined} />
  </div>;
}

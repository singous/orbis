import { BookOpen, FilePlus2, Plus } from "lucide-react";
import { Link } from "react-router-dom";
import { useStore } from "zustand";

import { authStore } from "../../shared/auth/auth-store";
import { formatDate } from "../../shared/format/date";
import { PageContainer } from "../../shared/ui/PageContainer";
import { StatusMessage } from "../../shared/ui/StatusMessage";
import { canMutateWorkspaceContent } from "../workspace/capabilities";
import { DocumentShell } from "./DocumentShell";
import {
  useDocumentGroups,
  useNotebooks,
  useNoteSearch,
} from "./queries";

export function DocumentOverviewPage() {
  const workspace = useStore(authStore, (state) => state.workspace);
  const canEdit = canMutateWorkspaceContent(workspace);
  const groupsQuery = useDocumentGroups();
  const notebooksQuery = useNotebooks();
  const notesQuery = useNoteSearch("");
  const groups = groupsQuery.data?.items ?? [];
  const notebooks = notebooksQuery.data?.items ?? [];
  const notes = notesQuery.data?.items ?? [];
  const recentNotes = [...notes]
    .sort((left, right) => right.updated_at_ms - left.updated_at_ms)
    .slice(0, 5);

  return (
    <DocumentShell>
      <PageContainer
        eyebrow="文档中心"
        title="文档概览"
        description="查看工作空间的文档状态，并从这里快速开始写作。"
        actions={
          canEdit ? (
            <Link
              to="/documents/collections"
              className="inline-flex h-9 items-center justify-center gap-1.5 rounded-lg bg-[var(--surface-inverse)] px-3 text-sm font-medium text-[var(--text-oninverse)] transition hover:opacity-90"
            >
              <Plus aria-hidden="true" size={15} />
              新建笔记本
            </Link>
          ) : null
        }
      >
        {groupsQuery.isError || notebooksQuery.isError || notesQuery.isError ? (
          <StatusMessage tone="error" title="文档空间加载失败">
            请检查 API 服务后重试。
          </StatusMessage>
        ) : null}

        <section className="stat-strip" aria-label="文档摘要">
          <div className="stat-item">
            <span className="stat-value">{groups.length}</span>
            <span className="stat-label">个分组</span>
          </div>
          <div className="stat-item">
            <span className="stat-value">{notebooks.length}</span>
            <span className="stat-label">个笔记本</span>
          </div>
          <div className="stat-item">
            <span className="stat-value">{notes.length}</span>
            <span className="stat-label">篇在线文档</span>
          </div>
        </section>

        <section aria-label="最近更新">
          <div className="section-heading">
            <div>
              <h2>最近更新</h2>
              <p>继续上次的写作</p>
            </div>
            <Link className="text-action" to="/documents/recent">
              查看全部
            </Link>
          </div>
          {notesQuery.isLoading ? (
            <div className="empty-panel">正在加载文档…</div>
          ) : null}
          {!notesQuery.isLoading && !recentNotes.length ? (
            <div className="empty-panel">
              <FilePlus2
                aria-hidden="true"
                className="mx-auto mb-3"
                size={24}
              />
              <div className="font-semibold text-black">还没有文档</div>
              <p className="mt-1">先创建笔记本，再开始第一篇文档。</p>
              <Link
                className="mt-4 inline-flex text-sm font-semibold"
                to="/documents/collections"
              >
                管理笔记本
              </Link>
            </div>
          ) : null}
          {recentNotes.length ? (
            <div className="divide-y divide-[var(--border)] overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--surface-content)]">
              {recentNotes.map((note) => (
                <Link
                  key={note.id}
                  to={`/documents/${note.id}`}
                  className="flex items-center gap-4 px-4 py-3.5 transition hover:bg-[var(--surface-hover)]"
                >
                  <div className="document-icon small">
                    <FilePlus2 aria-hidden="true" size={15} />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-semibold">
                      {note.title}
                    </div>
                    <div className="mt-1 truncate text-xs text-[var(--muted)]">
                      {note.plain_text || "空白文档"}
                    </div>
                  </div>
                  <span className="hidden text-xs text-[var(--muted-light)] sm:block">
                    {formatDate(note.updated_at_ms)}
                  </span>
                </Link>
              ))}
            </div>
          ) : null}
        </section>

        <section className="mt-8 rounded-2xl border border-[var(--border)] bg-[var(--surface-content)] p-5">
          <div className="flex items-start gap-3">
            <div className="document-icon">
              <BookOpen aria-hidden="true" size={18} />
            </div>
            <div>
              <h2 className="text-base font-semibold">管理你的笔记本</h2>
              <p className="mt-1 text-sm text-[var(--muted)]">
                分组、笔记本和目录结构集中在一个地方维护。
              </p>
              <Link
                className="mt-3 inline-flex text-sm font-semibold"
                to="/documents/collections"
              >
                前往我的笔记本
              </Link>
            </div>
          </div>
        </section>
      </PageContainer>
    </DocumentShell>
  );
}

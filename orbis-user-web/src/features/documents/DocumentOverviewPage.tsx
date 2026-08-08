import { BookOpen, FilePlus2, Plus } from "lucide-react";
import { Link, useNavigate } from "react-router-dom";
import { useStore } from "zustand";

import { authStore } from "../../shared/auth/auth-store";
import { Button } from "../../shared/ui/Button";
import { StatusMessage } from "../../shared/ui/StatusMessage";
import { DocumentShell } from "./DocumentShell";
import {
  useCreateNote,
  useDocumentGroups,
  useNotebooks,
  useNoteSearch,
} from "./queries";

function formatDate(value: number): string {
  return new Intl.DateTimeFormat("zh-CN", {
    month: "short",
    day: "numeric",
  }).format(new Date(value));
}

export function DocumentOverviewPage() {
  const navigate = useNavigate();
  const workspace = useStore(authStore, (state) => state.workspace);
  const canEdit = workspace?.role !== "normal";
  const groupsQuery = useDocumentGroups();
  const notebooksQuery = useNotebooks();
  const notesQuery = useNoteSearch("");
  const createNote = useCreateNote();
  const groups = groupsQuery.data?.items ?? [];
  const notebooks = notebooksQuery.data?.items ?? [];
  const notes = notesQuery.data?.items ?? [];
  const recentNotes = [...notes]
    .sort((left, right) => right.updated_at_ms - left.updated_at_ms)
    .slice(0, 5);

  async function createDocument() {
    const notebook = notebooks[0];
    if (!notebook) return;
    const note = await createNote.mutateAsync({
      notebook_id: notebook.id,
      title: "未命名文档",
      parent_id: null,
      sort_order: notes.filter((item) => item.notebook_id === notebook.id)
        .length,
    });
    navigate(`/documents/${note.id}`);
  }

  return (
    <DocumentShell
      toolbar={
        canEdit ? (
          <Button
            variant="primary"
            icon={<Plus aria-hidden="true" size={15} />}
            disabled={!notebooks.length || createNote.isPending}
            onClick={createDocument}
          >
            新建文档
          </Button>
        ) : null
      }
    >
      <div className="mx-auto max-w-[1040px] px-5 py-8 lg:px-10 lg:py-10">
        <header className="mb-9">
          <div className="mb-2 text-xs font-semibold uppercase tracking-[0.18em] text-[var(--muted-light)]">
            Workspace / Documents
          </div>
          <h1 className="text-4xl font-semibold tracking-[-0.045em] lg:text-5xl">
            文档概览
          </h1>
          <p className="mt-3 max-w-xl text-sm leading-6 text-[var(--muted)]">
            查看工作空间的文档状态，并从这里快速开始写作。
          </p>
        </header>

        {groupsQuery.isError || notebooksQuery.isError || notesQuery.isError ? (
          <StatusMessage tone="error" title="文档空间加载失败">
            请检查 API 服务后重试。
          </StatusMessage>
        ) : null}

        <section
          className="mb-10 grid gap-3 sm:grid-cols-3"
          aria-label="文档摘要"
        >
          <div className="document-card">
            <div className="text-2xl font-semibold">{groups.length}</div>
            <div className="mt-1 text-xs text-[var(--muted)]">个分组</div>
          </div>
          <div className="document-card">
            <div className="text-2xl font-semibold">{notebooks.length}</div>
            <div className="mt-1 text-xs text-[var(--muted)]">个文集</div>
          </div>
          <div className="document-card">
            <div className="text-2xl font-semibold">{notes.length}</div>
            <div className="mt-1 text-xs text-[var(--muted)]">篇在线文档</div>
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
              <p className="mt-1">先创建文集，再开始第一篇文档。</p>
              <Link
                className="mt-4 inline-flex text-sm font-semibold"
                to="/documents/collections"
              >
                管理文集
              </Link>
            </div>
          ) : null}
          {recentNotes.length ? (
            <div className="divide-y divide-[var(--border)] overflow-hidden rounded-xl border border-[var(--border)] bg-white">
              {recentNotes.map((note) => (
                <Link
                  key={note.id}
                  to={`/documents/${note.id}`}
                  className="flex items-center gap-4 px-4 py-3.5 transition hover:bg-[#fafafa]"
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

        <section className="mt-10 rounded-2xl border border-[var(--border)] bg-white p-5">
          <div className="flex items-start gap-3">
            <div className="document-icon">
              <BookOpen aria-hidden="true" size={18} />
            </div>
            <div>
              <h2 className="text-base font-semibold">管理你的文集</h2>
              <p className="mt-1 text-sm text-[var(--muted)]">
                分组、文集和目录结构集中在一个地方维护。
              </p>
              <Link
                className="mt-3 inline-flex text-sm font-semibold"
                to="/documents/collections"
              >
                前往我的文集
              </Link>
            </div>
          </div>
        </section>
      </div>
    </DocumentShell>
  );
}

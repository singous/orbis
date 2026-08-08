import { BookOpen, BrainCircuit, FilePlus2, LibraryBig } from "lucide-react";
import { Link } from "react-router-dom";

import { DocumentShell } from "../documents/DocumentShell";
import {
  useDocumentGroups,
  useNotebooks,
  useNoteSearch,
} from "../documents/queries";

export function HomePage() {
  const groupsQuery = useDocumentGroups();
  const notebooksQuery = useNotebooks();
  const notesQuery = useNoteSearch("");
  const groups = groupsQuery.data?.items ?? [];
  const notebooks = notebooksQuery.data?.items ?? [];
  const notes = notesQuery.data?.items ?? [];
  const recentNotes = notes.slice(0, 5);

  return (
    <DocumentShell>
      <div className="mx-auto max-w-[1040px] px-5 py-8 lg:px-10 lg:py-10">
        <header className="mb-9">
          <div className="mb-2 text-xs font-semibold uppercase tracking-[0.18em] text-[var(--muted-light)]">
            Orbis Cloud
          </div>
          <h1 className="text-4xl font-semibold tracking-[-0.045em] lg:text-5xl">
            首页
          </h1>
          <p className="mt-3 text-sm leading-6 text-[var(--muted)]">
            从在线文档开始，组织团队正在推进的工作。
          </p>
        </header>
        <section className="grid gap-3 md:grid-cols-3">
          <Link to="/documents" className="document-card">
            <div className="mb-7 document-icon">
              <BookOpen aria-hidden="true" size={18} />
            </div>
            <h2 className="text-base font-semibold">在线文档</h2>
            <p className="mt-2 text-xs leading-5 text-[var(--muted)]">
              {groups.length} 个分组 · {notebooks.length} 个文集 ·{" "}
              {notes.length} 篇文档
            </p>
            <div className="mt-5 text-sm font-semibold">进入文档</div>
          </Link>
          <div className="document-card opacity-65" aria-disabled="true">
            <div className="mb-7 document-icon">
              <LibraryBig aria-hidden="true" size={18} />
            </div>
            <h2 className="text-base font-semibold">知识库</h2>
            <p className="mt-2 text-xs leading-5 text-[var(--muted)]">
              规划中，暂不提供知识库业务。
            </p>
            <span className="mt-5 inline-block text-sm font-semibold">
              即将推出
            </span>
          </div>
          <div className="document-card opacity-65" aria-disabled="true">
            <div className="mb-7 document-icon">
              <BrainCircuit aria-hidden="true" size={18} />
            </div>
            <h2 className="text-base font-semibold">记忆库</h2>
            <p className="mt-2 text-xs leading-5 text-[var(--muted)]">
              规划中，暂不提供记忆库业务。
            </p>
            <span className="mt-5 inline-block text-sm font-semibold">
              即将推出
            </span>
          </div>
        </section>
        <section className="mt-10" aria-label="最近编辑">
          <div className="flex items-center gap-3">
            <div className="document-icon">
              <FilePlus2 aria-hidden="true" size={18} />
            </div>
            <div>
              <h2 className="text-base font-semibold">继续写作</h2>
              <p className="mt-1 text-sm text-[var(--muted)]">
                最近编辑的文档会显示在这里。
              </p>
            </div>
          </div>
          {notesQuery.isLoading ? (
            <div className="empty-panel mt-4">正在加载最近文档…</div>
          ) : null}
          {!notesQuery.isLoading && !recentNotes.length ? (
            <div className="empty-panel mt-4">
              还没有可继续的文档。
              <Link
                to="/documents/collections"
                className="mt-3 inline-flex text-sm font-semibold"
              >
                前往我的文集
              </Link>
            </div>
          ) : null}
          {recentNotes.length ? (
            <div className="mt-4 divide-y divide-[var(--border)] overflow-hidden rounded-xl border border-[var(--border)] bg-white">
              {recentNotes.map((note) => (
                <Link
                  key={note.id}
                  to={`/documents/${note.id}`}
                  className="flex items-center gap-3 px-4 py-3 transition hover:bg-[#fafafa]"
                >
                  <FilePlus2 aria-hidden="true" size={15} />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-semibold">{note.title}</div>
                    <div className="mt-1 truncate text-xs text-[var(--muted)]">
                      {note.plain_text || "空白文档"}
                    </div>
                  </div>
                </Link>
              ))}
            </div>
          ) : null}
          {recentNotes.length ? (
            <Link
              to="/documents/recent"
              className="mt-3 inline-flex text-sm font-semibold"
            >
              查看全部最近文档
            </Link>
          ) : null}
        </section>
      </div>
    </DocumentShell>
  );
}

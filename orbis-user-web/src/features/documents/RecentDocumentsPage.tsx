import { FilePlus2 } from "lucide-react";
import { Link } from "react-router-dom";

import { StatusMessage } from "../../shared/ui/StatusMessage";
import { DocumentShell } from "./DocumentShell";
import { useNoteSearch } from "./queries";

function formatDate(value: number): string {
  return new Intl.DateTimeFormat("zh-CN", {
    month: "short",
    day: "numeric",
  }).format(new Date(value));
}

export function RecentDocumentsPage() {
  const notesQuery = useNoteSearch("");
  const notes = notesQuery.data?.items ?? [];

  return (
    <DocumentShell>
      <div className="mx-auto max-w-[1040px] px-5 py-8 lg:px-10 lg:py-10">
        <header className="mb-9">
          <div className="mb-2 text-xs font-semibold uppercase tracking-[0.18em] text-[var(--muted-light)]">
            Documents
          </div>
          <h1 className="text-4xl font-semibold tracking-[-0.045em] lg:text-5xl">
            最近文档
          </h1>
          <p className="mt-3 text-sm leading-6 text-[var(--muted)]">
            按最近更新时间继续你的工作。
          </p>
        </header>
        {notesQuery.isError ? (
          <StatusMessage tone="error" title="最近文档加载失败">
            请检查 API 服务后重试。
          </StatusMessage>
        ) : null}
        {notesQuery.isLoading ? (
          <div className="empty-panel">正在加载文档…</div>
        ) : null}
        {!notesQuery.isLoading && !notes.length ? (
          <div className="empty-panel">
            还没有可继续的文档。
            <Link
              to="/documents/collections"
              className="mt-3 inline-flex text-sm font-semibold"
            >
              前往我的文集
            </Link>
          </div>
        ) : null}
        {notes.length ? (
          <div className="divide-y divide-[var(--border)] overflow-hidden rounded-2xl border border-[var(--border)] bg-white">
            {notes.map((note) => (
              <Link
                key={note.id}
                to={`/documents/${note.id}`}
                className="flex items-center gap-4 px-5 py-4 transition hover:bg-[#fafafa]"
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
                <time className="text-xs text-[var(--muted-light)]">
                  {formatDate(note.updated_at_ms)}
                </time>
              </Link>
            ))}
          </div>
        ) : null}
      </div>
    </DocumentShell>
  );
}

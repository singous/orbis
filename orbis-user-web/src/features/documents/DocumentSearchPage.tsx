import { FilePlus2, Search, X } from "lucide-react";
import { Link, useSearchParams } from "react-router-dom";

import { PageContainer } from "../../shared/ui/PageContainer";
import { StatusMessage } from "../../shared/ui/StatusMessage";
import { DocumentShell } from "./DocumentShell";
import { useNotebooks, useNoteSearch } from "./queries";

export function DocumentSearchPage() {
  const [params, setParams] = useSearchParams();
  const query = params.get("q") ?? "";
  const trimmedQuery = query.trim();
  const notesQuery = useNoteSearch(query, "active", {
    enabled: Boolean(trimmedQuery),
  });
  const notebooksQuery = useNotebooks(undefined, "active");
  const notes = notesQuery.data?.items ?? [];
  const notebookNames = new Map(
    (notebooksQuery.data?.items ?? []).map((notebook) => [
      notebook.id,
      notebook.title,
    ]),
  );

  function setQuery(nextQuery: string) {
    if (nextQuery) setParams({ q: nextQuery });
    else setParams({});
  }

  return (
    <DocumentShell>
      <PageContainer eyebrow="文档中心" title="搜索文档">
        <div className="mb-8">
          <label className="relative block max-w-2xl">
            <Search
              aria-hidden="true"
              size={17}
              className="absolute left-3.5 top-1/2 -translate-y-1/2 text-[var(--muted-light)]"
            />
            <input
              type="search"
              role="searchbox"
              aria-label="搜索文档"
              className="h-12 w-full rounded-xl border border-[var(--border)] bg-[var(--surface-content)] pl-10 pr-4 text-sm outline-none transition focus:border-[var(--accent)] focus:ring-4 focus:ring-[var(--accent-soft)]"
              placeholder="搜索标题或正文…"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
          </label>
        </div>
        {notesQuery.isError ? (
          <StatusMessage tone="error" title="文档搜索失败">
            请检查 API 服务后重试。
          </StatusMessage>
        ) : null}
        {trimmedQuery ? (
          <p className="mb-4 text-sm text-[var(--muted)]">
            找到 {notes.length} 篇相关文档
          </p>
        ) : (
          <p className="mb-4 text-sm text-[var(--muted)]">
            输入关键词搜索标题或正文。
          </p>
        )}
        {trimmedQuery ? (
          <button
            type="button"
            className="mb-4 inline-flex items-center gap-1 text-sm font-semibold text-[var(--muted)] hover:text-black"
            onClick={() => setQuery("")}
          >
            <X aria-hidden="true" size={14} />
            清空搜索
          </button>
        ) : null}
        {trimmedQuery && notesQuery.isLoading ? (
          <div className="empty-panel">正在搜索…</div>
        ) : null}
        {trimmedQuery && !notesQuery.isLoading && !notes.length ? (
          <div className="empty-panel">没有匹配的文档。试试更短的关键词。</div>
        ) : null}
        {trimmedQuery && notes.length ? (
          <div className="grid gap-3 md:grid-cols-2">
            {notes.map((note) => (
              <Link
                key={note.id}
                to={`/documents/${note.id}`}
                className="document-card"
              >
                <div className="mb-6 document-icon">
                  <FilePlus2 aria-hidden="true" size={18} />
                </div>
                <h2 className="truncate text-base font-semibold">
                  {note.title}
                </h2>
                <p className="mt-2 line-clamp-2 text-xs leading-5 text-[var(--muted)]">
                  {note.plain_text || "空白文档"}
                </p>
                <p className="mt-3 text-xs text-[var(--muted-light)]">
                  所属笔记本：{notebookNames.get(note.notebook_id) ?? "未知笔记本"}
                </p>
              </Link>
            ))}
          </div>
        ) : null}
      </PageContainer>
    </DocumentShell>
  );
}

import { FilePlus2, Search } from "lucide-react";
import { Link, useSearchParams } from "react-router-dom";

import { StatusMessage } from "../../shared/ui/StatusMessage";
import { DocumentShell } from "./DocumentShell";
import { useNoteSearch } from "./queries";

export function DocumentSearchPage() {
  const [params, setParams] = useSearchParams();
  const query = params.get("q") ?? "";
  const notesQuery = useNoteSearch(query);
  const notes = notesQuery.data?.items ?? [];

  function setQuery(nextQuery: string) {
    if (nextQuery) setParams({ q: nextQuery });
    else setParams({});
  }

  return (
    <DocumentShell>
      <div className="mx-auto max-w-[1040px] px-5 py-8 lg:px-10 lg:py-10">
        <header className="mb-8">
          <div className="mb-2 text-xs font-semibold uppercase tracking-[0.18em] text-[var(--muted-light)]">
            Documents
          </div>
          <h1 className="text-4xl font-semibold tracking-[-0.045em] lg:text-5xl">
            搜索文档
          </h1>
          <label className="relative mt-6 block max-w-2xl">
            <Search
              aria-hidden="true"
              size={17}
              className="absolute left-3.5 top-1/2 -translate-y-1/2 text-[var(--muted-light)]"
            />
            <input
              type="search"
              role="searchbox"
              aria-label="搜索文档"
              className="h-12 w-full rounded-xl border border-[var(--border)] bg-white pl-10 pr-4 text-sm outline-none transition focus:border-[#8072f2] focus:ring-4 focus:ring-[#6757f5]/10"
              placeholder="搜索标题或正文…"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
          </label>
        </header>
        {notesQuery.isError ? (
          <StatusMessage tone="error" title="文档搜索失败">
            请检查 API 服务后重试。
          </StatusMessage>
        ) : null}
        {query ? (
          <p className="mb-4 text-sm text-[var(--muted)]">
            找到 {notes.length} 篇相关文档
          </p>
        ) : (
          <p className="mb-4 text-sm text-[var(--muted)]">
            输入关键词搜索标题或正文。
          </p>
        )}
        {notesQuery.isLoading ? (
          <div className="empty-panel">正在搜索…</div>
        ) : null}
        {!notesQuery.isLoading && query && !notes.length ? (
          <div className="empty-panel">没有匹配的文档。试试更短的关键词。</div>
        ) : null}
        {notes.length ? (
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
              </Link>
            ))}
          </div>
        ) : null}
      </div>
    </DocumentShell>
  );
}

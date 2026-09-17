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
      <PageContainer title="搜索文档" description="搜索工作空间中的标题与正文。">
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
              className="workbench-search-field"
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
          <div className="workbench-document-list">
            {notes.map((note) => (
              <Link
                key={note.id}
                to={`/documents/${note.id}`}
                className="workbench-document-row workbench-search-result"
              >
                <FilePlus2 aria-hidden="true" size={19} />
                <div className="workbench-resource-copy">
                  <h2>{note.title}</h2>
                  <span>{note.plain_text || "空白文档"}</span>
                </div>
                <span className="workbench-search-notebook">所属笔记本：{notebookNames.get(note.notebook_id) ?? "未知笔记本"}</span>
              </Link>
            ))}
          </div>
        ) : null}
      </PageContainer>
    </DocumentShell>
  );
}

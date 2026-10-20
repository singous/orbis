import {useState} from "react";
import {Button} from "../../shared/ui/Button";
import { LoadingState } from "../../shared/ui/LoadingState";
import { FilePlus2 } from "../../shared/ui/icons";
import { Link } from "react-router-dom";

import { formatDate } from "../../shared/format/date";
import { PageContainer } from "../../shared/ui/PageContainer";
import { StatusMessage } from "../../shared/ui/StatusMessage";
import { DocumentShell } from "./DocumentShell";
import { useDocumentIndex } from "./queries";

export function RecentDocumentsPage() {
  const [page,setPage]=useState(1);
  const notesQuery = useDocumentIndex("active",{page});
  const notes = notesQuery.data?.items ?? [];

  return (
    <DocumentShell>
      <PageContainer
        title="最近文档"
        description="按最近更新时间继续你的工作。"
      >
        {notesQuery.isError ? (
          <StatusMessage tone="error" title="最近文档加载失败">
            请检查 API 服务后重试。
          </StatusMessage>
        ) : null}
        {notesQuery.isLoading ? (
          <LoadingState label="正在加载文档…" />
        ) : null}
        {!notesQuery.isLoading && !notes.length ? (
          <div className="empty-panel">
            还没有可继续的文档。
            <Link
              to="/documents/collections"
              className="mt-3 inline-flex text-sm font-semibold"
            >
              前往我的笔记本
            </Link>
          </div>
        ) : null}
        {notes.length ? (
          <div className="workbench-document-list">
            {notes.map((note) => (
              <Link
                key={note.id}
                to={`/documents/${note.id}`}
                className="workbench-document-row"
              >
                <div className="workbench-list-icon">
                  <FilePlus2 aria-hidden="true" size={16} />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-semibold">
                    {note.title}
                  </div>
                  <div className="mt-1 truncate text-xs text-[var(--muted)]">
                    {note.summary || "打开文档"}
                  </div>
                </div>
                <time className="text-xs text-[var(--muted-light)]">
                  {formatDate(note.updated_at_ms)}
                </time>
              </Link>
            ))}
          </div>
        ) : null}
        <div className="collaboration-actions"><Button disabled={page<=1||notesQuery.isFetching} onClick={()=>setPage(value=>value-1)}>上一页最近文档</Button><span>第 {page} 页</span><Button disabled={!notesQuery.data?.pagination.has_next||notesQuery.isFetching} onClick={()=>setPage(value=>value+1)}>下一页最近文档</Button></div>
      </PageContainer>
    </DocumentShell>
  );
}

import { BookOpen, ChevronRight, FilePlus2, Plus } from "lucide-react";
import { Link } from "react-router-dom";
import { useStore } from "zustand";

import { authStore } from "../../shared/auth/auth-store";
import { formatDate } from "../../shared/format/date";
import { PageContainer } from "../../shared/ui/PageContainer";
import { StatusMessage } from "../../shared/ui/StatusMessage";
import { canMutateWorkspaceContent } from "../workspace/capabilities";
import { NotebookIcon } from "./NotebookIcon";
import { DocumentShell } from "./DocumentShell";
import { useDocumentGroups, useNotebooks, useNoteSearch } from "./queries";

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
  const groupNames = new Map(groups.map((group) => [group.id, group.name]));

  return (
    <DocumentShell>
      <PageContainer
        title="文档概览"
        description={`${notebooks.length} 个笔记本 · ${notes.length} 篇文档`}
        actions={canEdit ? <Link to="/documents/collections" className="workbench-primary-action"><Plus aria-hidden="true" size={16} />新建笔记本</Link> : null}
      >
        {groupsQuery.isError || notebooksQuery.isError || notesQuery.isError ? <StatusMessage tone="error" title="文档空间加载失败">请检查 API 服务后重试。</StatusMessage> : null}

        <section className="workbench-section" aria-label="我的笔记本">
          <header className="workbench-section-heading"><h2>我的笔记本</h2><Link className="workbench-more" to="/documents/collections">管理笔记本<ChevronRight aria-hidden="true" size={14} /></Link></header>
          {notebooksQuery.isLoading ? <div className="empty-panel">正在加载笔记本…</div> : null}
          {notebooks.length ? <div className="workbench-resource-grid">
            {notebooks.slice(0, 6).map((notebook) => <Link key={notebook.id} to={`/collections/${notebook.id}`} className="workbench-resource-card">
              <NotebookIcon icon={notebook.icon} />
              <span className="workbench-resource-copy"><strong>{notebook.title}</strong><span>{groupNames.get(notebook.group_id) || "笔记本"} · 更新于 {formatDate(notebook.updated_at_ms)}</span></span>
              <ChevronRight className="workbench-resource-chevron" aria-hidden="true" size={17} />
            </Link>)}
          </div> : !notebooksQuery.isLoading ? <div className="workbench-empty-section"><BookOpen aria-hidden="true" size={26} /><h3>还没有笔记本</h3><p>按工作主题创建笔记本，开始整理你的文档。</p><Link className="workbench-more" to="/documents/collections">前往我的笔记本<ChevronRight aria-hidden="true" size={14} /></Link></div> : null}
        </section>

        <section className="workbench-section" aria-label="最近更新">
          <header className="workbench-section-heading"><h2>最近更新</h2><Link className="workbench-more" to="/documents/recent">查看全部<ChevronRight aria-hidden="true" size={14} /></Link></header>
          {notesQuery.isLoading ? <div className="empty-panel">正在加载文档…</div> : null}
          {!notesQuery.isLoading && !recentNotes.length ? <div className="workbench-empty-section"><FilePlus2 aria-hidden="true" size={26} /><h3>还没有文档</h3><p>先创建笔记本，再开始第一篇文档。</p><Link className="workbench-more" to="/documents/collections">管理笔记本<ChevronRight aria-hidden="true" size={14} /></Link></div> : null}
          {recentNotes.length ? <ul className="workbench-document-list">
            {recentNotes.map((note) => <li key={note.id}><Link to={`/documents/${note.id}`} className="workbench-document-row">
              <FilePlus2 aria-hidden="true" size={18} />
              <span className="workbench-resource-copy"><strong>{note.title}</strong><span>{note.plain_text || "空白文档"}</span></span>
              <time>{formatDate(note.updated_at_ms)}</time><ChevronRight className="workbench-resource-chevron" aria-hidden="true" size={15} />
            </Link></li>)}
          </ul> : null}
        </section>
      </PageContainer>
    </DocumentShell>
  );
}

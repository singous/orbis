import {
  ArrowRight,
  BookOpen,
  BrainCircuit,
  ChevronRight,
  Clock3,
  FileText,
  LibraryBig,
  Notebook,
  Plus,
  Search,
} from "lucide-react";
import { type FormEvent, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useStore } from "zustand";

import { authStore } from "../../shared/auth/auth-store";
import { formatDate } from "../../shared/format/date";
import { PageContainer } from "../../shared/ui/PageContainer";
import { StatusMessage } from "../../shared/ui/StatusMessage";
import { canMutateWorkspaceContent } from "../workspace/capabilities";
import { WorkspaceShell } from "../workspace/WorkspaceShell";
import { NotebookIcon } from "../documents/NotebookIcon";
import { useDocumentGroups, useNotebooks, useNoteSearch } from "../documents/queries";

type WorkspaceArea = {
  title: string;
  description: string;
  to: string;
  icon: typeof BookOpen;
  soon?: boolean;
};

export function HomePage() {
  const navigate = useNavigate();
  const workspace = useStore(authStore, (state) => state.workspace);
  const groupsQuery = useDocumentGroups();
  const notebooksQuery = useNotebooks();
  const notesQuery = useNoteSearch("");
  const [keyword, setKeyword] = useState("");
  const groups = groupsQuery.data?.items ?? [];
  const notebooks = notebooksQuery.data?.items ?? [];
  const notes = notesQuery.data?.items ?? [];

  // The search endpoint owns recency ordering; preserve its returned sequence.
  const recentNotes = notes.slice(0, 5);
  const recentNotebooks = [...notebooks]
    .sort((left, right) => right.updated_at_ms - left.updated_at_ms)
    .slice(0, 4);
  const areas: WorkspaceArea[] = [
    { title: "在线文档", description: `${groups.length} 个分组 · ${notebooks.length} 个笔记本 · ${notes.length} 篇文档`, to: "/documents", icon: BookOpen },
    { title: "我的笔记本", description: "按主题整理文档，维护目录与层级。", to: "/documents/collections", icon: Notebook },
    { title: "最近编辑", description: "继续上次的写作。", to: "/documents/recent", icon: Clock3 },
    { title: "全文搜索", description: "搜索工作空间中的标题与正文。", to: "/documents/search", icon: Search },
    { title: "知识库", description: "汇集文件与笔记，查找和使用知识。", to: "/knowledge", icon: LibraryBig, soon: true },
    { title: "记忆库", description: "保存长期上下文，连接每一次思考。", to: "/memory", icon: BrainCircuit, soon: true },
  ];

  function submitSearch(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const query = keyword.trim();
    navigate(query ? `/documents/search?q=${encodeURIComponent(query)}` : "/documents/search");
  }

  return (
    <WorkspaceShell>
      <PageContainer
        title="首页"
        description={workspace?.name || "我的工作空间"}
        actions={canMutateWorkspaceContent(workspace) ? (
          <Link className="workbench-primary-action" to="/documents/collections">
            <Plus aria-hidden="true" size={16} />新建笔记本
          </Link>
        ) : null}
      >
        <section className="workbench-section" aria-label="工作区板块">
          <header className="workbench-section-heading">
            <h2>工作空间</h2>
            <form className="workbench-inline-search" onSubmit={submitSearch} role="search">
              <Search aria-hidden="true" size={15} />
              <input type="search" aria-label="搜索文档" placeholder="搜索文档…" value={keyword} onChange={(event) => setKeyword(event.target.value)} />
              <button type="submit" aria-label="搜索"><ArrowRight aria-hidden="true" size={15} /></button>
            </form>
          </header>
          <div className="workbench-resource-grid">
            {areas.map(({ title, description, to, icon: Icon, soon }) => (
              <Link key={title} to={to} className="workbench-resource-card">
                <span className="workbench-resource-icon"><Icon aria-hidden="true" size={23} /></span>
                <span className="workbench-resource-copy"><strong>{title}</strong><span>{description}</span></span>
                {soon ? <span className="workbench-availability">即将推出</span> : <ChevronRight className="workbench-resource-chevron" aria-hidden="true" size={17} />}
              </Link>
            ))}
          </div>
        </section>

        {recentNotebooks.length ? (
          <section className="workbench-section" aria-label="常用笔记本">
            <header className="workbench-section-heading"><h2>最近使用的笔记本</h2><Link className="workbench-more" to="/documents/collections">查看全部<ChevronRight aria-hidden="true" size={14} /></Link></header>
            <div className="workbench-notebook-shortcuts">
              {recentNotebooks.map((notebook) => (
                <Link key={notebook.id} to={`/collections/${notebook.id}`}><NotebookIcon icon={notebook.icon} size="sm" /><span>{notebook.title}</span></Link>
              ))}
            </div>
          </section>
        ) : null}

        <section className="workbench-section" aria-label="最近编辑">
          <header className="workbench-section-heading"><h2>最近编辑</h2><Link className="workbench-more" to="/documents/recent">查看全部<ChevronRight aria-hidden="true" size={14} /></Link></header>
          {notesQuery.isError ? <StatusMessage tone="error" title="最近文档加载失败">请稍后重试。</StatusMessage> : null}
          {notesQuery.isLoading ? <div className="empty-panel">正在加载最近文档…</div> : null}
          {!notesQuery.isLoading && !notesQuery.isError && !recentNotes.length ? (
            <div className="empty-panel">还没有可继续的文档。<Link to="/documents/collections" className="mt-3 inline-flex text-sm font-semibold">前往我的笔记本</Link></div>
          ) : null}
          {recentNotes.length ? (
            <ul className="workbench-document-list">
              {recentNotes.map((note) => (
                <li key={note.id}><Link to={`/documents/${note.id}`} className="workbench-document-row">
                  <FileText aria-hidden="true" size={18} />
                  <span className="workbench-resource-copy"><strong>{note.title}</strong><span>{note.plain_text || "空白文档"}</span></span>
                  <time>{formatDate(note.updated_at_ms)}</time>
                  <ChevronRight className="workbench-resource-chevron" aria-hidden="true" size={15} />
                </Link></li>
              ))}
            </ul>
          ) : null}
        </section>
      </PageContainer>
    </WorkspaceShell>
  );
}

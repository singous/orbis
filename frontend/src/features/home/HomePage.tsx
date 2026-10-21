import { LoadingState } from "../../shared/ui/LoadingState";
import { buttonVariants } from "../../shared/ui/Button";
import { InputGroup } from "@heroui/react/input-group";
import { ActionButton } from "../../shared/ui/ActionButton";
import {
  ArrowRight,
  BookOpen,
  ChevronRight,
  Clock3,
  FileText,
  Notebook,
  Plus,
  Search,
} from "../../shared/ui/icons";
import { type FormEvent, useState } from "react";
import { Link } from "react-router-dom";
import { useStore } from "zustand";

import { authStore } from "../../shared/auth/auth-store";
import { formatDate } from "../../shared/format/date";
import { PageContainer } from "../../shared/ui/PageContainer";
import { StatusMessage } from "../../shared/ui/StatusMessage";
import { canMutateWorkspaceContent } from "../workspace/capabilities";
import { WorkspaceShell } from "../workspace/WorkspaceShell";
import { useSearchPalette } from "../search/search-palette-context";
import { NotebookIcon } from "../documents/NotebookIcon";
import { useDocumentGroups, useNotebooks, useDocumentIndex } from "../documents/queries";

type WorkspaceArea = {
  title: string;
  description: string;
  to: string;
  icon: typeof BookOpen;
};

function HomeInlineSearch() {
  const { openSearch } = useSearchPalette();
  const [keyword, setKeyword] = useState("");
  function submitSearch(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    openSearch({ q: keyword.trim(), type: "document" });
  }
  return <form className="workbench-inline-search" onSubmit={submitSearch} role="search">
    <InputGroup fullWidth className="workbench-search-group orbis-compact-search"><InputGroup.Prefix><Search aria-hidden="true" size={16} /></InputGroup.Prefix>
      <InputGroup.Input type="search" aria-label="搜索文档" placeholder="搜索文档…" value={keyword} onChange={(event) => setKeyword(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter" && event.nativeEvent.isComposing) event.preventDefault(); }} />
      <InputGroup.Suffix><ActionButton type="submit" aria-label="搜索"><ArrowRight aria-hidden="true" size={16} /></ActionButton></InputGroup.Suffix>
    </InputGroup>
  </form>;
}

function HomeSearchCard({ title, description, icon: Icon }: Pick<WorkspaceArea, "title" | "description" | "icon">) {
  const { isOpen, openSearch } = useSearchPalette();
  return <ActionButton type="button" className="workbench-resource-card" aria-haspopup="dialog" aria-expanded={isOpen} onClick={() => openSearch()}>
    <span className="workbench-resource-icon icon-accent"><Icon aria-hidden="true" size={24} /></span>
    <span className="workbench-resource-copy"><strong>{title}</strong><span>{description}</span></span>
    <ChevronRight className="workbench-resource-chevron" aria-hidden="true" size={18} />
  </ActionButton>;
}

export function HomePage() {
  const workspace = useStore(authStore, (state) => state.workspace);
  const groupsQuery = useDocumentGroups();
  const notebooksQuery = useNotebooks();
  const notesQuery = useDocumentIndex();
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
    { title: "全局搜索", description: "快速查找文档、笔记本、站点和文件。", to: "/search", icon: Search },
  ];

  return (
    <WorkspaceShell>
      <PageContainer
        title="首页"
        actions={canMutateWorkspaceContent(workspace) ? (
          <Link className={buttonVariants({ variant: "primary" })} to="/documents/collections">
            <Plus aria-hidden="true" size={16} />新建笔记本
          </Link>
        ) : null}
      >
        <section className="workbench-section" aria-label="功能入口">
          <header className="workbench-section-heading">
            <h2>功能入口</h2>
            <HomeInlineSearch />
          </header>
          <div className="workbench-resource-grid">
            {areas.map(({ title, description, to, icon: Icon }) => to === "/search" ? <HomeSearchCard key={title} title={title} description={description} icon={Icon} /> : (
              <Link key={title} to={to} className="workbench-resource-card">
                <span className="workbench-resource-icon icon-accent"><Icon aria-hidden="true" size={24} /></span>
                <span className="workbench-resource-copy"><strong>{title}</strong><span>{description}</span></span>
                <ChevronRight className="workbench-resource-chevron" aria-hidden="true" size={18} />
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
          {notesQuery.isLoading ? <LoadingState label="正在加载最近文档…" /> : null}
          {!notesQuery.isLoading && !notesQuery.isError && !recentNotes.length ? (
            <div className="empty-panel">还没有可继续的文档。<Link to="/documents/collections" className="mt-3 inline-flex text-sm font-semibold">前往我的笔记本</Link></div>
          ) : null}
          {recentNotes.length ? (
            <ul className="workbench-document-list">
              {recentNotes.map((note) => (
                <li key={note.id}><Link to={`/documents/${note.id}`} className="workbench-document-row">
                  <FileText aria-hidden="true" size={18} />
                  <span className="workbench-resource-copy"><strong>{note.title}</strong><span>{note.summary || "打开文档"}</span></span>
                  <time>{formatDate(note.updated_at_ms)}</time>
                  <ChevronRight className="workbench-resource-chevron" aria-hidden="true" size={16} />
                </Link></li>
              ))}
            </ul>
          ) : null}
        </section>
      </PageContainer>
    </WorkspaceShell>
  );
}

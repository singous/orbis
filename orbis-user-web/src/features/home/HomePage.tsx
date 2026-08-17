import {
  ArrowRight,
  BookOpen,
  BrainCircuit,
  ChevronRight,
  Clock3,
  FileText,
  LibraryBig,
  Notebook,
  Search,
} from "lucide-react";
import { type FormEvent, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useStore } from "zustand";

import { authStore } from "../../shared/auth/auth-store";
import { formatDate } from "../../shared/format/date";
import { WorkspaceShell } from "../workspace/WorkspaceShell";
import {
  useDocumentGroups,
  useNotebooks,
  useNoteSearch,
} from "../documents/queries";

/** 早/午/晚 greeting, so the hero reads as a working surface, not a banner. */
function greeting(hour: number): string {
  if (hour < 6) return "夜深了";
  if (hour < 12) return "早上好";
  if (hour < 18) return "下午好";
  return "晚上好";
}

type AreaCard = {
  title: string;
  description: string;
  to: string;
  icon: typeof BookOpen;
  tags: string[];
  soon?: boolean;
};

export function HomePage() {
  const navigate = useNavigate();
  const user = useStore(authStore, (state) => state.user);
  const groupsQuery = useDocumentGroups();
  const notebooksQuery = useNotebooks();
  const notesQuery = useNoteSearch("");
  const [keyword, setKeyword] = useState("");

  const groups = groupsQuery.data?.items ?? [];
  const notebooks = notebooksQuery.data?.items ?? [];
  const notes = notesQuery.data?.items ?? [];

  // The search endpoint already returns notes in recency order and the home
  // list is contracted to preserve it, so this must not re-sort.
  const recentNotes = notes.slice(0, 5);
  // The chip row carries real shortcuts instead of decorative suggestions:
  // the notebooks this workspace touched most recently.
  const recentNotebooks = [...notebooks]
    .sort((left, right) => right.updated_at_ms - left.updated_at_ms)
    .slice(0, 4);

  const cards: AreaCard[] = [
    {
      title: "在线文档",
      description: `${groups.length} 个分组 · ${notebooks.length} 个笔记本 · ${notes.length} 篇文档`,
      to: "/documents",
      icon: BookOpen,
      tags: ["分组管理", "文档树"],
    },
    {
      title: "我的笔记本",
      description: "按笔记本组织文档，维护目录与层级。",
      to: "/documents/collections",
      icon: Notebook,
      tags: ["目录", "层级"],
    },
    {
      title: "最近编辑",
      description: "回到刚刚离开的文档，接着写下去。",
      to: "/documents/recent",
      icon: Clock3,
      tags: ["继续写作", "时间线"],
    },
    {
      title: "全文搜索",
      description: "按标题与正文检索工作区内的全部文档。",
      to: "/documents/search",
      icon: Search,
      tags: ["标题", "正文"],
    },
    {
      title: "知识库",
      description: "文件入库、笔记快照发布与检索问答。",
      to: "/knowledge",
      icon: LibraryBig,
      tags: ["即将推出"],
      soon: true,
    },
    {
      title: "记忆库",
      description: "长期上下文沉淀与召回。",
      to: "/memory",
      icon: BrainCircuit,
      tags: ["即将推出"],
      soon: true,
    },
  ];

  function submitSearch(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const query = keyword.trim();
    navigate(query ? `/documents/search?q=${encodeURIComponent(query)}` : "/documents/search");
  }

  return (
    <WorkspaceShell>
      <div className="home-page">
        <section className="home-hero" aria-labelledby="home-greeting">
          <h1 className="home-hero-title" id="home-greeting">
            {greeting(new Date().getHours())}
            {user?.display_name ? `，${user.display_name}` : ""}，今天想写点什么？
          </h1>
          <p className="home-hero-subtitle">从搜索开始，或者直接进入一个笔记本。</p>

          <form className="home-search" onSubmit={submitSearch} role="search">
            <Search aria-hidden="true" size={18} />
            <input
              className="home-search-input"
              type="search"
              aria-label="搜索文档"
              placeholder="搜索标题或正文…"
              value={keyword}
              onChange={(event) => setKeyword(event.target.value)}
            />
            <button type="submit" className="home-search-submit" aria-label="搜索">
              <ArrowRight aria-hidden="true" size={17} />
            </button>
          </form>

          {recentNotebooks.length ? (
            <div className="home-chips">
              {recentNotebooks.map((notebook) => (
                <Link key={notebook.id} to={`/collections/${notebook.id}`} className="home-chip">
                  <Notebook aria-hidden="true" size={13} />
                  <span className="truncate">{notebook.title}</span>
                </Link>
              ))}
            </div>
          ) : null}
        </section>

        <section className="home-grid" aria-label="工作区板块">
          {cards.map(({ title, description, to, icon: Icon, tags, soon }) => (
            <Link key={title} to={to} className={`home-card${soon ? " is-soon" : ""}`}>
              <span className="home-card-icon">
                <Icon aria-hidden="true" size={19} />
              </span>
              <span className="home-card-title">{title}</span>
              <span className="home-card-description">{description}</span>
              <span className="home-card-tags">
                {tags.map((tag) => (
                  <span key={tag} className="tag">
                    {tag}
                  </span>
                ))}
              </span>
            </Link>
          ))}
        </section>

        <section className="home-recent" aria-label="最近编辑">
          <header className="home-section-header">
            <h2 className="home-section-title">最近编辑</h2>
            <Link to="/documents/recent" className="home-section-more">
              查看全部
              <ChevronRight aria-hidden="true" size={15} />
            </Link>
          </header>

          {notesQuery.isLoading ? <div className="empty-panel">正在加载最近文档…</div> : null}

          {!notesQuery.isLoading && !recentNotes.length ? (
            <div className="empty-panel">
              还没有可继续的文档。
              <Link to="/documents/collections" className="mt-3 inline-flex text-sm font-semibold">
                前往我的笔记本
              </Link>
            </div>
          ) : null}

          {recentNotes.length ? (
            <ul className="home-recent-list">
              {recentNotes.map((note) => (
                <li key={note.id}>
                  <Link to={`/documents/${note.id}`} className="home-recent-item">
                    <span className="home-recent-icon">
                      <FileText aria-hidden="true" size={16} />
                    </span>
                    <span className="home-recent-body">
                      <span className="home-recent-title">{note.title}</span>
                      <span className="home-recent-excerpt">{note.plain_text || "空白文档"}</span>
                    </span>
                    <time className="home-recent-date">{formatDate(note.updated_at_ms)}</time>
                  </Link>
                </li>
              ))}
            </ul>
          ) : null}
        </section>
      </div>
    </WorkspaceShell>
  );
}

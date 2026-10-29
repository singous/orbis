import { type FormEvent, useEffect, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useStore } from "zustand";
import { InputGroup } from "@heroui/react/input-group";
import { authStore } from "../../shared/auth/auth-store";
import { reportError } from "../../shared/api/request-feedback";
import { formatDate } from "../../shared/format/date";
import { ActionButton } from "../../shared/ui/ActionButton";
import { Button } from "../../shared/ui/Button";
import { ArrowRight, FileText, Search } from "../../shared/ui/icons";
import { LoadingState } from "../../shared/ui/LoadingState";
import { canMutateWorkspaceContent } from "../workspace/capabilities";
import { WorkspaceShell } from "../workspace/WorkspaceShell";
import { useSearchPalette } from "../search/search-palette-context";
import { NotebookIcon } from "../documents/NotebookIcon";
import { useCreateNote, useNotebooks, useDocumentIndex } from "../documents/queries";
import { QuickNoteComposer } from "../quick-notes/QuickNoteComposer";
import { QuickNoteTags } from "../quick-notes/QuickNoteTags";
import { buildActivityCalendar, memberDays } from "./home-activity";
import { useHomeQuickNotes } from "./home-queries";
import "../quick-notes/quick-notes.css";
import "./home.css";

const greetingDate = new Intl.DateTimeFormat("zh-CN", { timeZone: "Asia/Shanghai", month: "long", day: "numeric", weekday: "long" });
const CLOCK_REFRESH_MS = 60_000;

function HomeInlineSearch() {
  const { openSearch } = useSearchPalette();
  const [keyword, setKeyword] = useState("");
  function submitSearch(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    openSearch({ q: keyword.trim(), type: "document" });
  }
  return <form className="home-search" onSubmit={submitSearch} role="search">
    <InputGroup fullWidth className="home-search-group"><InputGroup.Prefix><Search aria-hidden="true" size={20} /></InputGroup.Prefix>
      <InputGroup.Input type="search" aria-label="搜索文档" placeholder="搜索你的知识…" value={keyword} onChange={event => setKeyword(event.target.value)} onKeyDown={event => { if (event.key === "Enter" && event.nativeEvent.isComposing) event.preventDefault(); }} />
      <InputGroup.Suffix><ActionButton type="submit" aria-label="搜索" className="home-search-submit"><ArrowRight aria-hidden="true" size={18} /></ActionButton></InputGroup.Suffix>
    </InputGroup>
  </form>;
}

export function HomePage() {
  const user = useStore(authStore, state => state.user);
  const workspace = useStore(authStore, state => state.workspace);
  const canEdit = canMutateWorkspaceContent(workspace);
  const notebooksQuery = useNotebooks();
  const notesQuery = useDocumentIndex();
  const quickNotes = useHomeQuickNotes();
  const [tagManager, setTagManager] = useState(false);
  const [now, setNow] = useState(Date.now);
  useEffect(() => { const timer = window.setInterval(() => setNow(Date.now()), CLOCK_REFRESH_MS); return () => window.clearInterval(timer); }, []);
  const notebooks = notebooksQuery.data?.items ?? [];
  const notes = notesQuery.data?.items ?? [];
  const recentNotebooks = [...notebooks].sort((a, b) => b.updated_at_ms - a.updated_at_ms).slice(0, 3);
  const notebookById = new Map(notebooks.map(notebook => [notebook.id, notebook]));
  const createNote = useCreateNote();
  const targetNotebook = recentNotebooks[0];
  const creating = useRef(false);
  const navigate = useNavigate();
  async function startDocument() {
    if (!canEdit || creating.current) return;
    if (!targetNotebook) { navigate("/documents/collections"); return; }
    creating.current = true;
    try {
      const note = await createNote.mutateAsync({ notebook_id: targetNotebook.id, title: "未命名文档", parent_id: null });
      navigate(`/documents/${note.id}`);
    } catch (error) { reportError(error); }
    finally { creating.current = false; }
  }
  const activity = buildActivityCalendar([...notes, ...(quickNotes.recent.data?.items ?? [])], now);
  const activityReady = notesQuery.isSuccess && quickNotes.recent.isSuccess;
  const failedQueries = [notebooksQuery, notesQuery, quickNotes.summary, quickNotes.tags, quickNotes.recent].filter(query => query.isError);

  return <WorkspaceShell>
    <div className="home-page">
      <header className="home-header"><h1>首页</h1><HomeInlineSearch /></header>
      {failedQueries.length ? <div className="home-error" role="alert">部分内容加载失败。<Button size="sm" onClick={() => failedQueries.forEach(query => void query.refetch())}>重新加载</Button></div> : null}
      <div className="home-grid">
        <section className="home-card home-welcome" aria-label="欢迎回来">
          <div className="home-welcome-main">
            <div className="home-welcome-copy">
              <time dateTime={new Date(now).toISOString()}>{greetingDate.format(now)}</time>
              <h2>嗨，欢迎回来。</h2>
              <p className="home-welcome-subtitle">每个小想法，都值得有个家。</p>
              <p className="home-welcome-detail">和 Orbis 一起，记录生活的第 {user ? memberDays(user.created_at_ms, now) : 1} 天</p>
              <nav className="home-welcome-actions" aria-label="功能入口">
                {canEdit ? <Button variant="primary" icon={<FileText size={19} aria-hidden="true" />} isPending={createNote.isPending} disabled={notebooksQuery.isPending || notebooksQuery.isError} onClick={() => void startDocument()}>写篇文档</Button> : <Link className="home-text-link" to="/documents">浏览文档<ArrowRight size={18} aria-hidden="true" /></Link>}
                <Link className="home-text-link" to="/documents/collections">去逛逛笔记本<ArrowRight size={18} aria-hidden="true" /></Link>
              </nav>
            </div>
            <img className="home-welcome-art" src="/images/home/welcome-stationery.webp" alt="" width="320" height="320" />
          </div>
          <nav className="home-stats" aria-label="内容统计">
            <Link to="/documents"><strong>{notesQuery.isSuccess ? notesQuery.data.pagination.total : "—"}</strong><span>篇文档</span></Link>
            <Link to="/documents/collections"><strong>{notebooksQuery.isSuccess ? notebooksQuery.data.pagination.total : "—"}</strong><span>本笔记本</span></Link>
            <Link to="/documents/quick-notes"><strong>{quickNotes.summary.isSuccess ? quickNotes.summary.data.total : "—"}</strong><span>条随手记</span></Link>
          </nav>
        </section>

        {user && workspace ? <QuickNoteComposer key={`${user.id}:${workspace.id}`} appearance="home" userId={user.id} workspaceId={workspace.id} tags={quickNotes.tags.data?.items ?? []} canEdit={canEdit} onManageTags={() => setTagManager(true)} onSaved={quickNotes.refresh} /> : null}

        <section className="home-card home-recent" aria-label="最近编辑">
          <header className="home-card-heading"><h2>接着上次的灵感</h2><Link className="home-more" to="/documents/recent">查看全部<ArrowRight size={17} aria-hidden="true" /></Link></header>
          {notesQuery.isPending ? <LoadingState label="正在加载最近文档…" /> : null}
          {notesQuery.isSuccess && !notes.length ? <div className="home-empty"><FileText size={30} aria-hidden="true" /><p>还没有可继续的文档</p><Link className="home-text-link" to="/documents/collections">从第一个笔记本开始<ArrowRight size={16} aria-hidden="true" /></Link></div> : null}
          <ul className="home-document-list">{notes.slice(0, 3).map(note => {
            const notebook = notebookById.get(note.notebook_id);
            return <li key={note.id}><Link to={`/documents/${note.id}`} className="home-document-row">
              <FileText size={29} strokeWidth={1.6} aria-hidden="true" />
              <span className="home-document-copy"><strong>{note.title || "未命名文档"}</strong><span>{notebook ? <><NotebookIcon icon={notebook.icon} size="sm" />{notebook.title}</> : "在线文档"}</span></span>
              <time dateTime={new Date(note.updated_at_ms).toISOString()}>{formatDate(note.updated_at_ms)}</time><ArrowRight className="home-document-arrow" size={16} aria-hidden="true" />
            </Link></li>;
          })}</ul>
          <div className="home-notebooks"><h3>常去的小角落</h3>
            {notebooksQuery.isPending ? <LoadingState label="正在加载笔记本…" /> : null}
            {notebooksQuery.isSuccess && !notebooks.length ? <Link className="home-text-link" to="/documents/collections">为你的想法创建一个笔记本<ArrowRight size={16} aria-hidden="true" /></Link> : null}
            <div className="home-notebook-grid">{recentNotebooks.map(notebook => <Link key={notebook.id} className="home-notebook" to={`/collections/${notebook.id}`}><NotebookIcon icon={notebook.icon} size="lg" /><span><strong>{notebook.title}</strong><span>更新于 {formatDate(notebook.updated_at_ms)}</span></span></Link>)}</div>
          </div>
        </section>

        <section className="home-card home-activity" aria-label="灵感足迹">
          <header className="home-card-heading"><div><h2>灵感足迹</h2><p>认真记录的日子，都在这里。</p></div><span className="home-activity-summary">本月记录了 {activityReady ? activity.activeDays : "—"} 天</span></header>
          {!activityReady && !notesQuery.isError && !quickNotes.recent.isError ? <LoadingState label="正在加载灵感足迹…" /> : null}
          <div className="home-calendar" role="img" aria-label={activityReady ? `近期内容足迹，本月有 ${activity.activeDays} 个记录日。按当前内容的创建和最近编辑日期统计。` : "灵感足迹尚未加载"}>
            <div className="home-calendar-days">{activity.days.map(day => <span key={day.date} className={`home-calendar-day${day.future ? " is-future" : ""}`} data-level={activityReady && !day.future ? Math.min(day.count, 4) : 0} title={day.future ? `${day.date}：尚未到来` : activityReady ? `${day.date}：${day.count} 条内容` : "尚未加载"} />)}</div>
            <div className="home-calendar-months">{activity.months.map(month => <span key={month.date}>{month.label}</span>)}</div>
          </div>
          <div className="home-calendar-legend" aria-hidden="true"><span>少</span>{[0, 1, 2, 3, 4].map(level => <span key={level} className="home-calendar-day" data-level={level} />)}<span>多</span></div>
          <p className="home-activity-scope">依据最近 {notes.length} 篇文档与 {quickNotes.recent.data?.items.length ?? 0} 条随手记的创建及最近编辑日期</p>
          <footer className="home-activity-footer"><span>今天，也给想法留一点位置。</span></footer>
        </section>
      </div>
      {user && workspace ? <QuickNoteTags key={`tags:${user.id}:${workspace.id}`} open={tagManager && canEdit} onOpenChange={setTagManager} tags={quickNotes.tags.data?.items ?? []} onChanged={quickNotes.refresh} /> : null}
    </div>
  </WorkspaceShell>;
}

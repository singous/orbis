import { type FormEvent, useEffect, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useStore } from "zustand";
import { Input } from "@orbis/ui/input";
import { authStore } from "../../shared/auth/auth-store";
import { reportError } from "../../shared/api/request-feedback";
import { formatDate } from "../../shared/format/date";
import { Button, buttonVariants } from "@orbis/ui/button";
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
import { HomeSurface, HomeHeader, HomeGrid, HomeCard, HomeCardHeading } from "./HomeLayout";
import { HomeActivityCard } from "./HomeActivityCard";

const greetingDate = new Intl.DateTimeFormat("zh-CN", { timeZone: "Asia/Shanghai", month: "long", day: "numeric", weekday: "long" });
const CLOCK_REFRESH_MS = 60_000;

function HomeInlineSearch() {
  const { openSearch } = useSearchPalette();
  const [keyword, setKeyword] = useState("");
  function submitSearch(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    openSearch({ q: keyword.trim(), type: "document" });
  }
  return <form className="home-search w-full min-[541px]:w-[min(28rem,45%)]" onSubmit={submitSearch} role="search">
    <div className="home-search-group relative h-(--ob-control-height-lg) min-w-0 w-full"><Search aria-hidden="true" className="home-ui-icon pointer-events-none absolute inset-y-0 start-3 my-auto size-4.5 flex-none text-ob-muted-foreground" />
      <Input className="h-(--ob-control-height-lg) min-h-(--ob-control-height-lg) ps-[42px] pe-[calc(var(--ob-control-height-sm)+1.5rem)] border-transparent shadow-sm pointer-coarse:text-base" type="search" aria-label="搜索文档" placeholder="搜索你的知识…" value={keyword} onChange={event => setKeyword(event.target.value)} onKeyDown={event => { if (event.key === "Enter" && event.nativeEvent.isComposing) event.preventDefault(); }} />
      <Button variant="ghost" type="submit" size="sm" className="absolute inset-y-0 end-3 my-auto size-(--ob-control-height-sm) p-0" aria-label="搜索"><ArrowRight aria-hidden="true" /></Button>
    </div>
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

  // 断点沿用原布局的 <=540 / <=1000 / <=1200px；列数由日历模型派生。
  return <WorkspaceShell>
    <HomeSurface>
      <HomeHeader><HomeInlineSearch /></HomeHeader>
      {failedQueries.length ? <div className="home-error mb-4 flex items-center gap-4 text-ob-danger-text" role="alert">部分内容加载失败。<Button size="sm" onClick={() => failedQueries.forEach(query => void query.refetch())}>重新加载</Button></div> : null}
      <HomeGrid>
        <HomeCard className="home-welcome flex flex-col" aria-label="欢迎回来">
          <div className="home-welcome-main relative flex min-h-[calc(6*var(--ob-control-height-lg))] flex-1 items-start pb-24 min-[541px]:items-center min-[541px]:pb-6">
            <div className="home-welcome-copy relative z-1 min-w-0 max-w-none min-[541px]:max-w-[60%]">
              <time className="mb-4 block text-xs text-ob-muted-foreground min-[541px]:mb-6" dateTime={new Date(now).toISOString()}>{greetingDate.format(now)}</time>
              <h2 className="m-0 text-2xl font-semibold text-ob-foreground">嗨，欢迎回来。</h2>
              <p className="home-welcome-subtitle mt-2 text-base">每个小想法，都值得有个家。</p>
              <p className="home-welcome-detail mt-1 text-ob-muted-foreground">和 Orbis 一起，记录生活的第 {user ? memberDays(user.created_at_ms, now) : 1} 天</p>
              <nav className="home-welcome-actions mt-4 flex flex-wrap items-center gap-2 min-[541px]:mt-6 min-[541px]:gap-3" aria-label="功能入口">
                {canEdit ? <Button variant="primary" loading={createNote.isPending} disabled={notebooksQuery.isPending || notebooksQuery.isError} onClick={() => void startDocument()}>{!createNote.isPending ? <FileText aria-hidden="true" /> : null}写篇文档</Button> : <Link className={buttonVariants({ variant: "ghost" })} to="/documents">浏览文档<ArrowRight aria-hidden="true" /></Link>}
                <Link className={buttonVariants({ variant: "ghost" })} to="/documents/collections">去逛逛笔记本<ArrowRight aria-hidden="true" /></Link>
              </nav>
            </div>
            <img className="home-welcome-art absolute end-0 bottom-0 h-auto max-h-64 w-32 object-contain min-[541px]:bottom-4 min-[541px]:w-[36%] min-[1001px]:w-[40%]" src="/images/home/welcome-stationery.webp" alt="" width="320" height="320" />
          </div>
          <nav className="home-stats grid grid-cols-3 border-t border-ob-surface-edge pt-4" aria-label="内容统计">
            <Link className="flex flex-col gap-1 rounded-ob-sm p-2 text-ob-muted-foreground hover:bg-ob-accent focus-visible:bg-ob-accent ob-focus-ring" to="/documents"><strong className="text-2xl font-semibold text-ob-foreground tabular-nums">{notesQuery.isSuccess ? notesQuery.data.pagination.total : "—"}</strong><span className="text-xs">篇文档</span></Link>
            <Link className="flex flex-col gap-1 rounded-ob-sm p-2 text-ob-muted-foreground hover:bg-ob-accent focus-visible:bg-ob-accent ob-focus-ring border-s border-ob-surface-edge ps-3 min-[541px]:ps-6" to="/documents/collections"><strong className="text-2xl font-semibold text-ob-foreground tabular-nums">{notebooksQuery.isSuccess ? notebooksQuery.data.pagination.total : "—"}</strong><span className="text-xs">本笔记本</span></Link>
            <Link className="flex flex-col gap-1 rounded-ob-sm p-2 text-ob-muted-foreground hover:bg-ob-accent focus-visible:bg-ob-accent ob-focus-ring border-s border-ob-surface-edge ps-3 min-[541px]:ps-6" to="/documents/quick-notes"><strong className="text-2xl font-semibold text-ob-foreground tabular-nums">{quickNotes.summary.isSuccess ? quickNotes.summary.data.total : "—"}</strong><span className="text-xs">条随手记</span></Link>
          </nav>
        </HomeCard>

        {user && workspace ? <QuickNoteComposer key={`${user.id}:${workspace.id}`} appearance="home" userId={user.id} workspaceId={workspace.id} tags={quickNotes.tags.data?.items ?? []} canEdit={canEdit} onManageTags={() => setTagManager(true)} onSaved={quickNotes.refresh} /> : null}

        <HomeCard className="home-recent" aria-label="最近编辑">
          <HomeCardHeading title="接着上次的灵感" actions={<Link className={buttonVariants({ variant: "ghost", size: "sm" })} to="/documents/recent">查看全部<ArrowRight aria-hidden="true" /></Link>} />
          {notesQuery.isPending ? <LoadingState label="正在加载最近文档…" /> : null}
          {notesQuery.isSuccess && !notes.length ? <div className="home-empty flex min-h-[calc(5*var(--ob-control-height-lg))] flex-col items-center justify-center text-ob-muted-foreground"><FileText className="home-ui-icon size-4.5 flex-none" aria-hidden="true" /><p className="mt-3">还没有可继续的文档</p><Link className={buttonVariants({ variant: "ghost" })} to="/documents/collections">从第一个笔记本开始<ArrowRight aria-hidden="true" /></Link></div> : null}
          <ul className="home-document-list m-0 list-none p-0">{notes.slice(0, 3).map(note => {
            const notebook = notebookById.get(note.notebook_id);
            return <li className="border-b border-ob-surface-edge" key={note.id}><Link to={`/documents/${note.id}`} className="home-document-row flex min-h-(--ob-control-height-md) min-w-0 items-center gap-2 rounded-ob-sm px-0 py-3 text-ob-foreground hover:bg-ob-accent focus-visible:bg-ob-accent ob-focus-ring min-[541px]:gap-3 min-[541px]:px-2">
              <FileText className="home-ui-icon size-4.5 flex-none" aria-hidden="true" />
              <span className="home-document-copy flex min-w-0 flex-1 flex-col gap-1"><strong className="truncate font-normal">{note.title || "未命名文档"}</strong><span className="flex items-center gap-1 text-xs text-ob-muted-foreground">{notebook ? <><NotebookIcon icon={notebook.icon} size="sm" />{notebook.title}</> : "在线文档"}</span></span>
              <time className="max-w-22 flex-none text-xs text-ob-muted-foreground min-[541px]:max-w-none" dateTime={new Date(note.updated_at_ms).toISOString()}>{formatDate(note.updated_at_ms)}</time><ArrowRight className="home-document-arrow home-ui-icon hidden size-4.5 flex-none text-ob-muted-foreground min-[541px]:inline-block" aria-hidden="true" />
            </Link></li>;
          })}</ul>
          <div className="home-notebooks mt-4"><h3 className="m-0 mb-3 text-base font-semibold">常去的小角落</h3>
            {notebooksQuery.isPending ? <LoadingState label="正在加载笔记本…" /> : null}
            {notebooksQuery.isSuccess && !notebooks.length ? <Link className={buttonVariants({ variant: "ghost" })} to="/documents/collections">为你的想法创建一个笔记本<ArrowRight aria-hidden="true" /></Link> : null}
            <div className="home-notebook-grid grid grid-cols-1 gap-3 min-[541px]:grid-cols-3 min-[1001px]:grid-cols-1 min-[1201px]:grid-cols-3">{recentNotebooks.map(notebook => <Link key={notebook.id} className="home-notebook flex min-w-0 items-center gap-3 rounded-ob-lg bg-ob-surface-secondary p-3 text-ob-foreground hover:bg-ob-accent focus-visible:bg-ob-accent ob-focus-ring" to={`/collections/${notebook.id}`}><NotebookIcon icon={notebook.icon} /><span className="flex min-w-0 flex-col gap-1"><strong className="truncate font-medium">{notebook.title}</strong><span className="text-xs text-ob-foreground/70">更新于 {formatDate(notebook.updated_at_ms)}</span></span></Link>)}</div>
          </div>
        </HomeCard>

        <HomeActivityCard state={activityReady ? "ready" : notesQuery.isError || quickNotes.recent.isError ? "unavailable" : "pending"} activity={activity} noteCount={notes.length} quickNoteCount={quickNotes.recent.data?.items.length ?? 0} />
      </HomeGrid>
      {user && workspace ? <QuickNoteTags key={`tags:${user.id}:${workspace.id}`} open={tagManager && canEdit} onOpenChange={setTagManager} tags={quickNotes.tags.data?.items ?? []} onChanged={quickNotes.refresh} /> : null}
    </HomeSurface>
  </WorkspaceShell>;
}

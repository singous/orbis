import { useSearchParams, Link } from "react-router-dom";
import { Button } from "@orbis/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@orbis/ui/dropdown-menu";
import { Input } from "@orbis/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@orbis/ui/select";
import { ArrowDown, ArrowUpRight, BookOpen, Copy, MoreHorizontal, Search } from "@orbis/ui/icons";

import type { Note } from "../../shared/api/schemas";
import { reportError } from "../../shared/api/request-feedback";
import { LoadingState } from "../../shared/ui/LoadingState";
import { PageHeader } from "../../shared/ui/PageHeader";
import { DocumentKindIcon } from "./DocumentKindIcon";
import { DocumentLink } from "./DocumentLink";
import { DocumentShell } from "./DocumentShell";
import { NotebookIcon } from "./NotebookIcon";
import { documentEditPeriod, formatNotebookUpdateTime } from "./notebook-update-time";
import { useDocumentIndex, useNotebooks } from "./queries";

const ALL_NOTEBOOKS = "all";
const RESULTS_PER_PAGE = 20;
const recentColumns = "grid grid-cols-[minmax(0,1fr)_minmax(0,19%)_minmax(6rem,13%)_auto] items-center gap-x-4 max-[640px]:grid-cols-[minmax(0,1fr)_auto] max-[640px]:gap-x-2";

export function RecentDocumentsPage() {
  const [params, setParams] = useSearchParams();
  const title = params.get("title") ?? "";
  const notebookId = params.get("notebook") || ALL_NOTEBOOKS;
  const parsedPage = Number(params.get("page") ?? 1);
  const page = Number.isSafeInteger(parsedPage) && parsedPage > 0 ? parsedPage : 1;
  const query = title.trim().toLocaleLowerCase();
  const filtered = Boolean(query) || notebookId !== ALL_NOTEBOOKS;
  const notesQuery = useDocumentIndex("active", { allPages: filtered, page });
  const notebooksQuery = useNotebooks();
  const notebooks = notebooksQuery.data?.items ?? [];
  const notebooksById = new Map(notebooks.map(notebook => [notebook.id, notebook]));
  const items = [{ value: ALL_NOTEBOOKS, label: "全部笔记本" }, ...notebooks.map(notebook => ({ value: notebook.id, label: notebook.title }))];
  const notes = notesQuery.data?.items ?? [];
  const matches = filtered ? notes.filter(note => (notebookId === ALL_NOTEBOOKS || note.notebook_id === notebookId) && (!query || note.title.toLocaleLowerCase().includes(query))) : notes;
  const effectivePage = filtered ? Math.min(page, Math.max(1, Math.ceil(matches.length / RESULTS_PER_PAGE))) : page;
  const visible = filtered ? matches.slice((effectivePage - 1) * RESULTS_PER_PAGE, effectivePage * RESULTS_PER_PAGE) : matches;
  const hasNext = filtered ? effectivePage * RESULTS_PER_PAGE < matches.length : notesQuery.data?.pagination.has_next;
  const now = Date.now();
  const groups = new Map<string, Note[]>();
  for (const note of visible) {
    const period = documentEditPeriod(note.updated_at_ms, now);
    const group = groups.get(period) ?? [];
    group.push(note);
    groups.set(period, group);
  }

  function filter(key: "title" | "notebook", value: string) {
    const next = new URLSearchParams(params);
    next.delete("page");
    if (value && !(key === "notebook" && value === ALL_NOTEBOOKS)) next.set(key, value);
    else next.delete(key);
    setParams(next, { replace: true });
  }

  function goToPage(value: number) {
    const next = new URLSearchParams(params);
    if (value > 1) next.set("page", String(value));
    else next.delete("page");
    setParams(next);
  }

  return (
    <DocumentShell>
      <div className="min-h-full bg-card">
        <div className="mx-auto w-full max-w-[1440px] px-[clamp(20px,3.25vw,44px)] pt-[37px] pb-10 max-[640px]:pt-6">
          <PageHeader title="最近编辑" description="数据表、画板与文档，按最后编辑时间排序" className="mb-7 border-0 pb-0 max-[641px]:pb-0" />
          <div className="mb-7 flex flex-wrap items-center gap-3">
            <label className="relative block w-[280px] max-w-full">
              <span className="sr-only">搜索文档标题</span>
              <Search aria-hidden="true" size={15} className="pointer-events-none absolute start-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
              <Input type="search" className="h-[34px] bg-sidebar ps-8 text-sm md:text-xs" placeholder="搜索文档标题" value={title} onChange={event => filter("title", event.target.value)} />
            </label>
            <Select items={items} value={notebookId} onValueChange={value => filter("notebook", value ?? ALL_NOTEBOOKS)}>
              <SelectTrigger aria-label="按笔记本筛选" className="h-[34px] max-w-full min-w-[130px] gap-2 rounded-md px-2.5 text-xs"><BookOpen aria-hidden="true" className="size-[15px] text-muted-foreground" /><SelectValue>{notebookId === ALL_NOTEBOOKS ? "全部笔记本" : notebooksById.get(notebookId)?.title ?? "所选笔记本"}</SelectValue></SelectTrigger>
              <SelectContent align="start" alignItemWithTrigger={false}>{items.map(item => <SelectItem key={item.value} value={item.value}>{item.label}</SelectItem>)}</SelectContent>
            </Select>
            <span className="ms-auto flex items-center gap-2 text-xs text-muted-foreground"><ArrowDown aria-hidden="true" size={15} />最近编辑优先</span>
          </div>
          {notesQuery.isLoading ? <LoadingState label="正在加载文档…" /> : null}
          {notesQuery.isError ? <div role="alert" className="flex items-center gap-3 text-sm text-muted-foreground">无法加载最近编辑。<Button variant="secondary" size="sm" onClick={() => void notesQuery.refetch()}>重试</Button></div> : null}
          {notesQuery.isSuccess && !visible.length ? <div className="grid justify-items-start gap-3 rounded-xl bg-sidebar p-6 text-sm text-muted-foreground">
            {filtered ? <>没有符合条件的文档。<Button variant="secondary" size="sm" onClick={() => setParams({}, { replace: true })}>清除筛选</Button></> : <>还没有可继续的文档。<Link to="/documents" className="font-semibold text-foreground">前往我的笔记本</Link></>}
          </div> : null}
          {visible.length ? <>
            <div className={`${recentColumns} mb-4 px-3 text-[11px] text-muted-foreground max-[640px]:hidden`} aria-hidden="true"><span>文档</span><span>所属笔记本</span><span>最后编辑</span><span className="w-6" /></div>
            <div className="grid gap-[18px]">{Array.from(groups, ([period, group]) => <section key={period} aria-label={period}>
              <h2 className="flex min-h-7 items-center gap-2 px-3 text-xs font-semibold">{period}<span className="text-[11px] font-normal text-muted-foreground">{group.length} 项</span></h2>
              <ul className="m-0 grid list-none gap-1 p-0">{group.map(note => {
                const notebook = notebooksById.get(note.notebook_id);
                const to = `/documents/${note.id}`;
                return <li key={note.id} className={`${recentColumns} min-h-[52px] rounded-md px-3 text-sm hover:bg-sidebar focus-within:bg-sidebar`}>
                  <DocumentLink noteId={note.id} to={to} title={note.title} className="flex min-h-10 min-w-0 items-center gap-3 rounded-sm">
                    <DocumentKindIcon note={note} size={18} /><span className="min-w-0 truncate font-medium">{note.title}</span>
                  </DocumentLink>
                  <Link to={`/collections/${note.notebook_id}`} className="flex min-w-0 items-center gap-2 rounded-sm text-xs text-muted-foreground hover:text-foreground max-[640px]:hidden" title={notebook?.title}>
                    <NotebookIcon icon={notebook?.icon} size="sm" /><span className="truncate">{notebook?.title ?? "打开笔记本"}</span>
                  </Link>
                  <time className="text-xs text-muted-foreground max-[640px]:hidden" dateTime={new Date(note.updated_at_ms).toISOString()}>{formatNotebookUpdateTime(note.updated_at_ms, now)}</time>
                  <DropdownMenu>
                    <DropdownMenuTrigger render={<Button variant="ghost" size="icon-xs" aria-label={`文档操作：${note.title}`}><MoreHorizontal aria-hidden="true" /></Button>} />
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem render={<Link to={to} />}><ArrowUpRight aria-hidden="true" />打开文档</DropdownMenuItem>
                      <DropdownMenuItem render={<Link to={`/collections/${note.notebook_id}`} />}><BookOpen aria-hidden="true" />前往笔记本</DropdownMenuItem>
                      <DropdownMenuItem onClick={async () => {
                        try {
                          if (!navigator.clipboard) throw new Error("当前浏览器无法访问剪贴板。");
                          await navigator.clipboard.writeText(new URL(to, window.location.origin).href);
                        } catch (error) { reportError(error); }
                      }}><Copy aria-hidden="true" />复制文档链接</DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </li>;
              })}</ul>
            </section>)}</div>
          </> : null}
          {visible.length || effectivePage > 1 ? (
            <footer className="mt-7 flex flex-wrap items-center justify-between gap-3 border-t border-border px-3 pt-3 text-xs text-muted-foreground">
              <span>本页显示 {visible.length} 项最近编辑</span>
              {effectivePage > 1 || hasNext ? <div className="flex items-center gap-2">
                <Button variant="ghost" size="sm" disabled={effectivePage <= 1 || notesQuery.isFetching} onClick={() => goToPage(effectivePage - 1)}>上一页最近文档</Button>
                <span>第 {effectivePage} 页</span>
                <Button variant="ghost" size="sm" disabled={!hasNext || notesQuery.isFetching} onClick={() => goToPage(effectivePage + 1)}>下一页最近文档</Button>
              </div> : null}
            </footer>
          ) : null}
        </div>
      </div>
    </DocumentShell>
  );
}

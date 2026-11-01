import { readerFocus, readerTouchTarget } from "./chrome";
import { LoadingState } from "../../../shared/ui/LoadingState";
import { Button } from "@orbis/ui/button";
import { Dialog, DialogClose } from "@orbis/ui/dialog";
import { CommandPopup, CommandInput, CommandList, CommandResult, CommandMessage, CommandFooter } from "../../../shared/ui/command";
import { FileText, X } from "../../../shared/ui/icons";
import { useEffect, useMemo, useRef, useState, type RefObject } from "react";
import { useNavigate } from "react-router-dom";

import type { PublishedPage } from "../schemas";
import { ApiError } from "../../../shared/api/api-client";
import { pageHref, searchPublishedPages } from "./reader-model";

function Highlight({ text, query }: { text: string; query: string }) {
  const normalized = query.trim().toLocaleLowerCase();
  const index = text.toLocaleLowerCase().indexOf(normalized);
  if (!normalized || index < 0) return <>{text}</>;
  return <>{text.slice(0, index)}<mark className="rounded-[2px] bg-(--ob-reader-highlight) text-(--ob-reader-text)">{text.slice(index, index + normalized.length)}</mark>{text.slice(index + normalized.length)}</>;
}

export function SearchDialog({ open = true, pages, basePath, close, loadPages, finalFocus }: { open?: boolean; pages: PublishedPage[]; basePath: string; close: () => void; finalFocus?: RefObject<HTMLElement | null>; loadPages?: (query:string,signal?:AbortSignal) => Promise<PublishedPage[]> }) {
  const [query, setQuery] = useState("");
  const [composing,setComposing]=useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const navigate = useNavigate();
  const [loaded, setLoaded] = useState<{ loader: typeof loadPages; query:string; pages: PublishedPage[]; error: string | null } | null>(null);
  const current = loaded && loaded.loader === loadPages && loaded.query===query.trim() ? loaded : null;
  const loading = Boolean(loadPages && query.trim() && !composing && !current);
  const searchPages = loadPages ? current?.pages ?? [] : pages;
  const results = useMemo(() => searchPublishedPages(searchPages, query,Boolean(loadPages)), [searchPages, query,loadPages]);

  useEffect(() => {
    if (!open) return;
    setQuery("");
    setComposing(false);
    setActiveIndex(0);
    setLoaded(null);
  }, [open]);

  useEffect(() => {
    if(!open||!loadPages||!query.trim()||composing)return;
    let active=true;
    const abort=new AbortController();
    const timer=setTimeout(()=>{void loadPages(query.trim(),abort.signal).then(items=>{
      if(active)setLoaded({loader:loadPages,query:query.trim(),pages:items,error:null});
    }).catch(error=>{if(active)setLoaded({loader:loadPages,query:query.trim(),pages:[],error:error instanceof ApiError?error.message:"暂时无法搜索，请重试。"});});},200);
    return()=>{active=false;clearTimeout(timer);abort.abort();};
  },[open,loadPages,query,composing]);

  useEffect(() => { setActiveIndex(0); }, [query]);
  useEffect(() => {
    const activeOption = dialogRef.current?.querySelector<HTMLElement>(`#site-search-${activeIndex}`);
    activeOption?.scrollIntoView?.({ block: "nearest" });
  }, [activeIndex, results]);

  function choose(index: number) {
    const result = results[index];
    if (!result) return;
    navigate(pageHref(basePath, result.page.slug));
    close();
  }

  return <Dialog open={open} onOpenChange={nextOpen => { if (!nextOpen) close(); }}>
    <CommandPopup preset="reader" title="搜索文档" initialFocus={inputRef} finalFocus={finalFocus} ref={dialogRef} onKeyDown={event => {
      if ((event.nativeEvent.isComposing || composing || event.keyCode === 229) && event.key === "Escape") event.stopPropagation();
    }}>
      <CommandInput ref={inputRef} aria-label="搜索文档" listId="site-reader-search-results" activeId={results[activeIndex] ? `site-search-${activeIndex}` : undefined} placeholder="搜索标题与正文…" value={query} onCompositionStart={() => setComposing(true)} onCompositionEnd={() => setComposing(false)} onChange={event => setQuery(event.target.value)} onKeyDown={event => {
          if (event.nativeEvent.isComposing || composing || event.keyCode === 229) {
            if (event.key === "Escape") event.stopPropagation();
            return;
          }
          if (event.key === "ArrowDown") { event.preventDefault(); event.stopPropagation(); setActiveIndex(index => results.length ? (index + 1) % results.length : 0); }
          else if (event.key === "ArrowUp") { event.preventDefault(); event.stopPropagation(); setActiveIndex(index => results.length ? (index - 1 + results.length) % results.length : 0); }
          else if (event.key === "Enter") { event.preventDefault(); event.stopPropagation(); choose(activeIndex); }
        }}>
        <DialogClose asChild><Button appearance="unstyled" type="button" className={`absolute inset-y-0 end-3 my-auto grid size-[30px] cursor-pointer place-items-center border-0 border-current bg-transparent p-0 text-(--ob-reader-muted) hover:bg-(--ob-reader-surface-soft) ${readerFocus} ${readerTouchTarget}`} aria-label="关闭搜索"><X aria-hidden="true" size={18} /></Button></DialogClose>
      </CommandInput>
      <CommandList id="site-reader-search-results" aria-label="搜索结果">
        {/* Search options retain active-descendant focus on the combobox input. */}
        {loading ? <LoadingState label="正在加载搜索索引…" compact /> : current?.error ? null : !query.trim() ? <CommandMessage kind="prompt" description="输入关键词搜索当前发布版本" detail="仅显示读者可见的文档" /> : results.length ? results.map((result, index) => <CommandResult key={result.page.slug} selected={activeIndex === index} icon={FileText} title={<Highlight text={result.page.title} query={query} />} path={result.path} excerpt={<Highlight text={result.excerpt} query={query} />} element={<Button appearance="unstyled" id={`site-search-${index}`} type="button" aria-label={`${result.page.title} ${result.path} ${result.excerpt}`} onMouseMove={() => setActiveIndex(index)} onClick={() => choose(index)} />} />) : <CommandMessage kind="empty" title="没有找到相关内容" description="请尝试更短的关键词或浏览左侧目录。" />}
      </CommandList>
      <CommandFooter />
    </CommandPopup>
  </Dialog>;
}

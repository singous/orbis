import { LoadingState } from "../../../shared/ui/LoadingState";
import { Input } from "@orbis/ui/input";
import { Button } from "@orbis/ui/button";
import { Dialog, DialogPopup, DialogTitle, DialogClose } from "@orbis/ui/dialog";
import { FileText, Search, X } from "../../../shared/ui/icons";
import { useEffect, useMemo, useRef, useState, type RefObject } from "react";
import { useNavigate } from "react-router-dom";

import type { PublishedPage } from "../schemas";
import { ApiError } from "../../../shared/api/api-client";
import { pageHref, searchPublishedPages } from "./reader-model";

function Highlight({ text, query }: { text: string; query: string }) {
  const normalized = query.trim().toLocaleLowerCase();
  const index = text.toLocaleLowerCase().indexOf(normalized);
  if (!normalized || index < 0) return <>{text}</>;
  return <>{text.slice(0, index)}<mark>{text.slice(index, index + normalized.length)}</mark>{text.slice(index + normalized.length)}</>;
}

export function SearchDialog({ open = true, pages, basePath, close, loadPages, finalFocus }: { open?: boolean; pages: PublishedPage[]; basePath: string; close: () => void; finalFocus?: RefObject<HTMLElement | null>; loadPages?: (query:string,signal?:AbortSignal) => Promise<PublishedPage[]> }) {
  const [query, setQuery] = useState("");
  const [composing,setComposing]=useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const [portalContainer, setPortalContainer] = useState<HTMLDivElement | null>(null);
  const navigate = useNavigate();
  const attempt = 0;
  const [loaded, setLoaded] = useState<{ loader: typeof loadPages; attempt: number; query:string; pages: PublishedPage[]; error: string | null } | null>(null);
  const current = loaded?.loader === loadPages && loaded?.attempt === attempt && loaded.query===query.trim() ? loaded : null;
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
      if(active)setLoaded({loader:loadPages,attempt,query:query.trim(),pages:items,error:null});
    }).catch(error=>{if(active)setLoaded({loader:loadPages,attempt,query:query.trim(),pages:[],error:error instanceof ApiError?error.message:"暂时无法搜索，请重试。"});});},200);
    return()=>{active=false;clearTimeout(timer);abort.abort();};
  },[open,loadPages,attempt,query,composing]);

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

  return <div className="site-reader-overlay-root" ref={setPortalContainer}>{portalContainer ? <Dialog open={open} onOpenChange={nextOpen => { if (!nextOpen) close(); }}>
    <DialogPopup portalContainer={portalContainer} initialFocus={inputRef} finalFocus={finalFocus} backdropClassName="site-reader-search-backdrop" viewportClassName="site-reader-search-viewport" className="site-reader-search-dialog" ref={dialogRef} onKeyDown={event => {
      if ((event.nativeEvent.isComposing || composing || event.keyCode === 229) && event.key === "Escape") event.stopPropagation();
    }}>
      <DialogTitle className="sr-only">搜索文档</DialogTitle>
      <div className="site-reader-search-field relative border-b border-(--reader-border) bg-(--reader-surface)">
        <Search aria-hidden="true" size={18} className="pointer-events-none absolute inset-y-0 start-3 my-auto text-(--reader-muted)" />
        <Input className="h-full min-h-0 rounded-none border-0 bg-transparent ps-[42px] pe-[54px] text-(--reader-text) shadow-none" ref={inputRef} role="combobox" aria-label="搜索文档" aria-controls="site-reader-search-results" aria-expanded="true" aria-activedescendant={results[activeIndex] ? `site-search-${activeIndex}` : undefined} placeholder="搜索标题与正文…" value={query} onCompositionStart={() => setComposing(true)} onCompositionEnd={() => setComposing(false)} onChange={event => setQuery(event.target.value)} onKeyDown={event => {
          if (event.nativeEvent.isComposing || composing || event.keyCode === 229) {
            if (event.key === "Escape") event.stopPropagation();
            return;
          }
          if (event.key === "ArrowDown") { event.preventDefault(); event.stopPropagation(); setActiveIndex(index => results.length ? (index + 1) % results.length : 0); }
          else if (event.key === "ArrowUp") { event.preventDefault(); event.stopPropagation(); setActiveIndex(index => results.length ? (index - 1 + results.length) % results.length : 0); }
          else if (event.key === "Enter") { event.preventDefault(); event.stopPropagation(); choose(activeIndex); }
        }} />
        <DialogClose asChild><Button appearance="unstyled" type="button" className="absolute inset-y-0 end-3 my-auto" aria-label="关闭搜索"><X aria-hidden="true" size={18} /></Button></DialogClose>
      </div>
      <div id="site-reader-search-results" className="site-reader-search-results" role="listbox" aria-label="搜索结果">
        {/* Search options retain active-descendant focus on the combobox input. */}
        {loading ? <LoadingState label="正在加载搜索索引…" compact /> : current?.error ? null : !query.trim() ? <div className="site-reader-search-hint"><Search aria-hidden="true" size={20} /><p>输入关键词搜索当前发布版本</p><span>仅显示读者可见的文档</span></div> : results.length ? results.map((result, index) => <Button appearance="unstyled" id={`site-search-${index}`} key={result.page.slug} type="button" role="option" aria-label={`${result.page.title} ${result.path} ${result.excerpt}`} aria-selected={activeIndex === index} className={activeIndex === index ? "is-active" : ""} onMouseMove={() => setActiveIndex(index)} onClick={() => choose(index)}>
          <FileText aria-hidden="true" size={18} />
          <span><strong><Highlight text={result.page.title} query={query} /></strong><small>{result.path}</small><span><Highlight text={result.excerpt} query={query} /></span></span>
        </Button>) : <div className="site-reader-search-empty"><Search aria-hidden="true" size={22} /><strong>没有找到相关内容</strong><p>请尝试更短的关键词或浏览左侧目录。</p></div>}
      </div>
      <footer><span><kbd>↑</kbd><kbd>↓</kbd> 选择</span><span><kbd>↵</kbd> 打开</span><span><kbd>esc</kbd> 关闭</span></footer>
    </DialogPopup>
  </Dialog> : null}</div>;
}

import { LoadingState } from "../../../shared/ui/LoadingState";
import { InputGroup } from "@heroui/react/input-group";
import { Modal } from "@heroui/react/modal";
import { FileText, Search, X } from "../../../shared/ui/icons";
import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";

import type { PublishedPage } from "../schemas";
import { ApiError } from "../../../shared/api/api-client";
import { ActionButton } from "../../../shared/ui/ActionButton";
import { pageHref, searchPublishedPages } from "./reader-model";

function Highlight({ text, query }: { text: string; query: string }) {
  const normalized = query.trim().toLocaleLowerCase();
  const index = text.toLocaleLowerCase().indexOf(normalized);
  if (!normalized || index < 0) return <>{text}</>;
  return <>{text.slice(0, index)}<mark>{text.slice(index, index + normalized.length)}</mark>{text.slice(index + normalized.length)}</>;
}

export function SearchDialog({ open = true, pages, basePath, close, loadPages }: { open?: boolean; pages: PublishedPage[]; basePath: string; close: () => void; loadPages?: (query:string,signal?:AbortSignal) => Promise<PublishedPage[]> }) {
  const [query, setQuery] = useState("");
  const [composing,setComposing]=useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const [portalContainer, setPortalContainer] = useState<HTMLDivElement | null>(null);
  const navigate = useNavigate();
  const [attempt, setAttempt] = useState(0);
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

  return <div className="site-reader-overlay-root" ref={setPortalContainer}>{portalContainer ? <Modal.Backdrop
    isOpen={open} isKeyboardDismissDisabled onOpenChange={(nextOpen) => { if (!nextOpen) close(); }}
    UNSTABLE_portalContainer={portalContainer} className="site-reader-search-backdrop"
  >
    <Modal.Container className="site-reader-search-container"><Modal.Dialog className="site-reader-search-dialog" aria-label="搜索文档"><div ref={dialogRef} onKeyDown={(event) => {
      if (event.nativeEvent.isComposing) return;
      if (event.key === "Escape") { event.preventDefault(); close(); }
    }}>
      <InputGroup fullWidth className="site-reader-search-field"><InputGroup.Prefix><Search aria-hidden="true" size={18} /></InputGroup.Prefix><InputGroup.Input autoFocus ref={inputRef} role="combobox" aria-label="搜索文档" aria-controls="site-reader-search-results" aria-expanded="true" aria-activedescendant={results[activeIndex] ? `site-search-${activeIndex}` : undefined} placeholder="搜索标题与正文…" value={query} onCompositionStart={()=>setComposing(true)} onCompositionEnd={()=>setComposing(false)} onChange={(event) => setQuery(event.target.value)} onKeyDown={(event) => {
        if (event.nativeEvent.isComposing) return;
        if (event.key === "ArrowDown") { event.preventDefault(); event.stopPropagation(); setActiveIndex((index) => results.length ? (index + 1) % results.length : 0); }
        else if (event.key === "ArrowUp") { event.preventDefault(); event.stopPropagation(); setActiveIndex((index) => results.length ? (index - 1 + results.length) % results.length : 0); }
        else if (event.key === "Enter") { event.preventDefault(); event.stopPropagation(); choose(activeIndex); }
      }} /><InputGroup.Suffix><ActionButton type="button" aria-label="关闭搜索" onClick={close}><X aria-hidden="true" size={18} /></ActionButton></InputGroup.Suffix></InputGroup>
      <div id="site-reader-search-results" className="site-reader-search-results" role="listbox">
        {/* Search options retain active-descendant focus on the combobox input. */}
        {loading ? <LoadingState label="正在加载搜索索引…" compact /> : current?.error ? <div className="site-reader-search-empty" role="alert"><p>{current.error}</p><ActionButton type="button" onClick={() => setAttempt((value) => value + 1)}>重新加载搜索</ActionButton></div> : !query.trim() ? <div className="site-reader-search-hint"><Search aria-hidden="true" size={20} /><p>输入关键词搜索当前发布版本</p><span>仅显示读者可见的文档</span></div> : results.length ? results.map((result, index) => <button id={`site-search-${index}`} key={result.page.slug} type="button" role="option" aria-label={`${result.page.title} ${result.path} ${result.excerpt}`} aria-selected={activeIndex === index} className={activeIndex === index ? "is-active" : ""} onMouseMove={() => setActiveIndex(index)} onClick={() => choose(index)}>
          <FileText aria-hidden="true" size={18} />
          <span><strong><Highlight text={result.page.title} query={query} /></strong><small>{result.path}</small><span><Highlight text={result.excerpt} query={query} /></span></span>
        </button>) : <div className="site-reader-search-empty"><Search aria-hidden="true" size={22} /><strong>没有找到相关内容</strong><p>请尝试更短的关键词或浏览左侧目录。</p></div>}
      </div>
      <footer><span><kbd>↑</kbd><kbd>↓</kbd> 选择</span><span><kbd>↵</kbd> 打开</span><span><kbd>esc</kbd> 关闭</span></footer>
    </div></Modal.Dialog></Modal.Container>
  </Modal.Backdrop> : null}</div>;
}

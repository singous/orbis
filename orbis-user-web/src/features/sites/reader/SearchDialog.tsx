import { FileText, Search, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
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

export function SearchDialog({ pages, basePath, close, loadPages }: { pages: PublishedPage[]; basePath: string; close: () => void; loadPages?: () => Promise<PublishedPage[]> }) {
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const dialogRef = useRef<HTMLElement>(null);
  const navigate = useNavigate();
  const [attempt, setAttempt] = useState(0);
  const [loaded, setLoaded] = useState<{ loader: typeof loadPages; attempt: number; pages: PublishedPage[]; error: string | null } | null>(null);
  const current = loaded?.loader === loadPages && loaded?.attempt === attempt ? loaded : null;
  const loading = Boolean(loadPages && !current);
  const searchPages = loadPages ? current?.pages ?? [] : pages;
  const results = useMemo(() => searchPublishedPages(searchPages, query), [searchPages, query]);

  useEffect(() => {
    if (!loadPages) return;
    let active = true;
    void loadPages().then((items) => {
      if (active) setLoaded({ loader: loadPages, attempt, pages: items, error: null });
    }).catch((error: unknown) => {
      if (active) setLoaded({ loader: loadPages, attempt, pages: [], error: error instanceof ApiError ? error.message : "暂时无法加载搜索索引。" });
    });
    return () => { active = false; };
  }, [loadPages, attempt]);

  useEffect(() => { inputRef.current?.focus(); }, []);
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

  return <div className="site-reader-search-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) close(); }}>
    <section ref={dialogRef} className="site-reader-search-dialog" role="dialog" aria-modal="true" aria-label="搜索文档" onKeyDown={(event) => {
      if (event.nativeEvent.isComposing) return;
      if (event.key === "Escape") { event.preventDefault(); close(); }
      else if (event.key === "Tab") {
        const focusable = Array.from(dialogRef.current?.querySelectorAll<HTMLElement>("input, button:not([disabled])") ?? []);
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
      }
    }}>
      <div className="site-reader-search-field"><Search aria-hidden="true" size={18} /><input ref={inputRef} role="combobox" aria-label="搜索文档" aria-controls="site-reader-search-results" aria-expanded="true" aria-activedescendant={results[activeIndex] ? `site-search-${activeIndex}` : undefined} placeholder="搜索标题与正文…" value={query} onChange={(event) => setQuery(event.target.value)} onKeyDown={(event) => {
        if (event.nativeEvent.isComposing) return;
        if (event.key === "ArrowDown") { event.preventDefault(); event.stopPropagation(); setActiveIndex((index) => results.length ? (index + 1) % results.length : 0); }
        else if (event.key === "ArrowUp") { event.preventDefault(); event.stopPropagation(); setActiveIndex((index) => results.length ? (index - 1 + results.length) % results.length : 0); }
        else if (event.key === "Enter") { event.preventDefault(); event.stopPropagation(); choose(activeIndex); }
      }} /><button type="button" aria-label="关闭搜索" onClick={close}><X aria-hidden="true" size={18} /></button></div>
      <div id="site-reader-search-results" className="site-reader-search-results" role="listbox">
        {loading ? <div className="site-reader-search-hint" role="status"><p>正在加载搜索索引…</p></div> : current?.error ? <div className="site-reader-search-empty" role="alert"><p>{current.error}</p><button type="button" onClick={() => setAttempt((value) => value + 1)}>重新加载搜索</button></div> : !query.trim() ? <div className="site-reader-search-hint"><Search aria-hidden="true" size={20} /><p>输入关键词搜索当前发布版本</p><span>仅显示读者可见的文档</span></div> : results.length ? results.map((result, index) => <button id={`site-search-${index}`} key={result.page.slug} type="button" role="option" aria-label={`${result.page.title} ${result.path} ${result.excerpt}`} aria-selected={activeIndex === index} className={activeIndex === index ? "is-active" : ""} onMouseMove={() => setActiveIndex(index)} onClick={() => choose(index)}>
          <FileText aria-hidden="true" size={17} />
          <span><strong><Highlight text={result.page.title} query={query} /></strong><small>{result.path}</small><span><Highlight text={result.excerpt} query={query} /></span></span>
        </button>) : <div className="site-reader-search-empty"><Search aria-hidden="true" size={21} /><strong>没有找到相关内容</strong><p>请尝试更短的关键词或浏览左侧目录。</p></div>}
      </div>
      <footer><span><kbd>↑</kbd><kbd>↓</kbd> 选择</span><span><kbd>↵</kbd> 打开</span><span><kbd>esc</kbd> 关闭</span></footer>
    </section>
  </div>;
}

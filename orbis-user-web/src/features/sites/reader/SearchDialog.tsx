import { FileText, Search, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";

import type { PublishedPage } from "../schemas";
import { pageHref, searchPublishedPages } from "./reader-model";

function Highlight({ text, query }: { text: string; query: string }) {
  const normalized = query.trim().toLocaleLowerCase();
  const index = text.toLocaleLowerCase().indexOf(normalized);
  if (!normalized || index < 0) return <>{text}</>;
  return <>{text.slice(0, index)}<mark>{text.slice(index, index + normalized.length)}</mark>{text.slice(index + normalized.length)}</>;
}

export function SearchDialog({ pages, basePath, close }: { pages: PublishedPage[]; basePath: string; close: () => void }) {
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const dialogRef = useRef<HTMLElement>(null);
  const navigate = useNavigate();
  const results = useMemo(() => searchPublishedPages(pages, query), [pages, query]);

  useEffect(() => { inputRef.current?.focus(); }, []);
  useEffect(() => { setActiveIndex(0); }, [query]);

  function choose(index: number) {
    const result = results[index];
    if (!result) return;
    navigate(pageHref(basePath, result.page.slug));
    close();
  }

  return <div className="site-reader-search-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) close(); }}>
    <section ref={dialogRef} className="site-reader-search-dialog" role="dialog" aria-modal="true" aria-label="搜索文档" onKeyDown={(event) => {
      if (event.key === "Escape") { event.preventDefault(); close(); }
      else if (event.key === "Tab") {
        const focusable = Array.from(dialogRef.current?.querySelectorAll<HTMLElement>("input, button:not([disabled])") ?? []);
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
      }
      else if (event.key === "ArrowDown") { event.preventDefault(); setActiveIndex((index) => results.length ? (index + 1) % results.length : 0); }
      else if (event.key === "ArrowUp") { event.preventDefault(); setActiveIndex((index) => results.length ? (index - 1 + results.length) % results.length : 0); }
      else if (event.key === "Enter") { event.preventDefault(); choose(activeIndex); }
    }}>
      <div className="site-reader-search-field"><Search aria-hidden="true" size={18} /><input ref={inputRef} role="combobox" aria-label="搜索文档" aria-controls="site-reader-search-results" aria-expanded="true" aria-activedescendant={results[activeIndex] ? `site-search-${activeIndex}` : undefined} placeholder="搜索标题与正文…" value={query} onChange={(event) => setQuery(event.target.value)} /><button type="button" aria-label="关闭搜索" onClick={close}><X aria-hidden="true" size={18} /></button></div>
      <div id="site-reader-search-results" className="site-reader-search-results" role="listbox">
        {!query.trim() ? <div className="site-reader-search-hint"><Search aria-hidden="true" size={20} /><p>输入关键词搜索当前发布版本</p><span>仅显示读者可见的文档</span></div> : results.length ? results.map((result, index) => <button id={`site-search-${index}`} key={result.page.slug} type="button" role="option" aria-label={`${result.page.title} ${result.path} ${result.excerpt}`} aria-selected={activeIndex === index} className={activeIndex === index ? "is-active" : ""} onMouseMove={() => setActiveIndex(index)} onClick={() => choose(index)}>
          <FileText aria-hidden="true" size={17} />
          <span><strong><Highlight text={result.page.title} query={query} /></strong><small>{result.path}</small><span><Highlight text={result.excerpt} query={query} /></span></span>
        </button>) : <div className="site-reader-search-empty"><Search aria-hidden="true" size={21} /><strong>没有找到相关内容</strong><p>请尝试更短的关键词或浏览左侧目录。</p></div>}
      </div>
      <footer><span><kbd>↑</kbd><kbd>↓</kbd> 选择</span><span><kbd>↵</kbd> 打开</span><span><kbd>esc</kbd> 关闭</span></footer>
    </section>
  </div>;
}

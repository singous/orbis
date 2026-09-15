import { ArrowDown, ArrowUp, FileText, Plus, Search, X } from "lucide-react";
import { useDeferredValue, useState } from "react";
import { usePublishableNotes } from "./queries";
import type { NavigationItem } from "./schemas";

export function SiteNavigationEditor({ value, onChange, disabled }: { value: NavigationItem[]; onChange: (value: NavigationItem[]) => void; disabled: boolean }) {
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(1);
  const deferredQuery = useDeferredValue(query);
  const notes = usePublishableNotes(deferredQuery, page);
  const selected = new Set(value.map((entry) => entry.note_id));

  function move(index: number, direction: number) {
    const next = [...value];
    [next[index], next[index + direction]] = [next[index + direction], next[index]];
    onChange(next);
  }
  function update(index: number, patch: Partial<NavigationItem>) {
    onChange(value.map((entry, position) => position === index ? { ...entry, ...patch } : entry));
  }

  return <div className="site-navigation-editor">
    <div className="site-section-heading"><div><h2>站点目录</h2><p>选择要公开的文档，按读者的阅读顺序组织。</p></div><span>{value.length} 篇</span></div>
    {value.length ? <ol className="site-selected-pages">{value.map((entry, index) => <li key={entry.note_id}>
      <div className="site-page-position"><FileText size={17} /><span>{String(index + 1).padStart(2, "0")}</span></div>
      <fieldset disabled={disabled} className="site-page-fields">
        <label className="mvp-field">导航标题<input value={entry.title} required maxLength={240} onChange={(event) => update(index, { title: event.target.value })} aria-label={`第 ${index + 1} 篇导航标题`} /></label>
        <label className="mvp-field">页面路径<input value={entry.slug} required pattern="[a-z0-9]+(-[a-z0-9]+)*" maxLength={100} onChange={(event) => update(index, { slug: event.target.value })} aria-label={`第 ${index + 1} 篇页面路径`} /></label>
        <label className="mvp-field">分组<input value={entry.group || ""} maxLength={120} placeholder="例如：开始使用" onChange={(event) => update(index, { group: event.target.value || null })} aria-label={`第 ${index + 1} 篇分组`} /></label>
      </fieldset>
      {!disabled ? <div className="site-page-controls"><button type="button" className="site-icon-button" disabled={index === 0} aria-label={`上移 ${entry.title}`} onClick={() => move(index, -1)}><ArrowUp size={15} /></button><button type="button" className="site-icon-button" disabled={index === value.length - 1} aria-label={`下移 ${entry.title}`} onClick={() => move(index, 1)}><ArrowDown size={15} /></button><button type="button" className="site-icon-button" aria-label={`移除 ${entry.title}`} onClick={() => onChange(value.filter((_, position) => position !== index))}><X size={15} /></button></div> : null}
    </li>)}</ol> : <div className="site-navigation-empty"><FileText size={25} /><p>先添加一篇文档</p><span>内部文集的组织方式会保持独立。</span></div>}
    {!disabled ? <section className="site-document-picker"><h3>添加文档</h3><label className="site-picker-search"><Search size={16} /><input type="search" aria-label="查找可发布文档" placeholder="按标题或内容查找…" value={query} onChange={(event) => { setQuery(event.target.value); setPage(1); }} /></label>
      {notes.isPending ? <p className="mvp-muted">正在加载文档…</p> : notes.isError ? <p role="alert">无法加载文档。<button type="button" onClick={() => void notes.refetch()}>重试</button></p> : <>
        <div className="site-picker-results">{notes.data.items.map((note) => <button key={note.id} type="button" disabled={selected.has(note.id) || value.length >= 200} onClick={() => onChange([...value, { note_id: note.id, title: note.title, slug: `page-${note.id}`, group: null }])}><FileText size={16} /><span>{note.title}<small>{note.plain_text.slice(0, 75) || "空白文档"}</small></span>{selected.has(note.id) ? <small>已添加</small> : <Plus size={16} />}</button>)}{!notes.data.items.length ? <p>没有找到文档</p> : null}</div>
        <div className="mvp-pagination"><button type="button" disabled={!notes.data.pagination.has_previous} onClick={() => setPage(page - 1)}>上一页</button><span>第 {page} 页</span><button type="button" disabled={!notes.data.pagination.has_next} onClick={() => setPage(page + 1)}>下一页</button></div>
      </>}
    </section> : null}
  </div>;
}

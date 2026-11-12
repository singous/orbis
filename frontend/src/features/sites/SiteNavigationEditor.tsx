import { Input } from "@orbis/ui/input";
import { Button } from "@orbis/ui/button";
import { SiteField, SitePagination, SiteSectionHeading, SiteReorderControls } from "./SiteManagementLayout";
import { FileText, Plus, Search } from "../../shared/ui/icons";
import { useDeferredValue, useState } from "react";
import { usePublishableNotes } from "./queries";
import { createPageSlug, MAX_PAGE_SLUG_LENGTH, MAX_SITE_PAGES } from "./page-slug";
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

  return <div>
    <SiteSectionHeading title="站点目录" description="选择要公开的文档，按读者的阅读顺序组织。" actions={<span className="text-xs text-muted-foreground">{value.length} 篇</span>} />
    {value.length ? <ol >{value.map((entry, index) => <li className="flex items-start gap-3 border-t border-border py-4.5 first:border-t-0 first:pt-0" key={entry.note_id}>
      <div className="flex flex-col items-center gap-2 pt-[3px] text-xs text-muted-foreground"><FileText size={18} /><span>{String(index + 1).padStart(2, "0")}</span></div>
      <fieldset disabled={disabled} className="grid min-w-0 flex-1 grid-cols-[1fr_1fr] gap-3 [&>:first-child]:col-span-full">
        <SiteField>导航标题<Input value={entry.title} required maxLength={240} onChange={(event) => update(index, { title: event.target.value })} aria-label={`第 ${index + 1} 篇导航标题`} /></SiteField>
        <SiteField>页面路径<Input value={entry.slug} required pattern="[a-z0-9]+(-[a-z0-9]+)*" maxLength={MAX_PAGE_SLUG_LENGTH} onChange={(event) => update(index, { slug: event.target.value })} aria-label={`第 ${index + 1} 篇页面路径`} /></SiteField>
        <SiteField>分组<Input value={entry.group || ""} maxLength={120} placeholder="例如：开始使用" onChange={(event) => update(index, { group: event.target.value || null })} aria-label={`第 ${index + 1} 篇分组`} /></SiteField>
      </fieldset>
      {!disabled && <SiteReorderControls appearance="navigation" first={index === 0} last={index === value.length - 1} upLabel={`上移 ${entry.title}`} downLabel={`下移 ${entry.title}`} removeLabel={`移除 ${entry.title}`} onMove={(direction) => move(index, direction)} onRemove={() => onChange(value.filter((_, position) => position !== index))} />}
    </li>)}</ol> : <div className="mb-6 flex flex-col items-center gap-2.5 rounded-xl border border-dashed border-border px-4 py-[34px] text-sm text-muted-foreground"><FileText className="text-muted-foreground" size={24} /><p>先添加一篇文档</p><span className="text-xs">内部文集的组织方式会保持独立。</span></div>}
    {!disabled && <section className="mt-[25px]"><h3 className="mb-3 text-sm font-semibold">添加文档</h3><div className="relative rounded-[9px] px-3 py-[11px]"><Search aria-hidden="true" size={16} className="pointer-events-none absolute inset-y-0 start-3 my-auto text-muted-foreground" /><Input className="ps-10" type="search" aria-label="查找可发布文档" placeholder="按标题或内容查找…" value={query} onChange={(event) => { setQuery(event.target.value); setPage(1); }} /></div>
      {notes.isPending ? <p className="text-sm text-muted-foreground">正在加载文档…</p> : notes.isError ? null : <>
        <div className="max-h-[280px] overflow-y-auto">{notes.data.items.map((note) => <Button variant="ghost" className="h-auto w-full justify-start whitespace-normal text-start" key={note.id} disabled={selected.has(note.id) || value.length >= MAX_SITE_PAGES} onClick={() => onChange([...value, { note_id: note.id, title: note.title, slug: createPageSlug(note.title, value.map((entry) => entry.slug)), group: null }])}><FileText size={16} /><span className="flex-1 text-sm">{note.title}<small className="mt-[3px] block text-xs text-muted-foreground">{note.plain_text.slice(0, 75) || "空白文档"}</small></span>{selected.has(note.id) ? <small className="mt-[3px] block text-xs text-muted-foreground">已添加</small> : <Plus size={16} />}</Button>)}{!notes.data.items.length && <p className="py-5 text-xs text-muted-foreground">没有找到文档</p>}</div>
        <SitePagination hasPrevious={notes.data.pagination.has_previous} hasNext={notes.data.pagination.has_next} onPrevious={() => setPage(page - 1)} onNext={() => setPage(page + 1)}>第 {page} 页</SitePagination>
      </>}
    </section>}
  </div>;
}

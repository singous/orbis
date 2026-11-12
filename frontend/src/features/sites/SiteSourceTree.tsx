import { Input } from "@orbis/ui/input";
import { Checkbox } from "@orbis/ui/checkbox";
import { Textarea } from "@orbis/ui/textarea";
import { Button } from "@orbis/ui/button";
import { SiteField } from "./SiteManagementLayout";
import { ChevronDown, ChevronRight, FileText, PencilLine } from "../../shared/ui/icons";
import { useState } from "react";
import { Link } from "react-router-dom";

import type { NoteTreeItem } from "../../shared/api/schemas";
import type { SiteSource, SiteSources } from "./schemas";
import { findNotePath, scopedNoteTree, updatePageOverride } from "./source-model";

type Props = {
  items: NoteTreeItem[];
  rootNoteId?: string | null;
  source: SiteSource;
  resolved?: SiteSources;
  disabled: boolean;
  onChange: (source: SiteSource) => void;
};

export function SiteSourceTree({ items, rootNoteId, source, resolved, disabled, onChange }: Props) {
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());
  const excluded = new Set(source.excluded_note_ids);
  const rootPath = rootNoteId ? findNotePath(items, rootNoteId) : null;
  const hiddenExcludedAncestors = rootPath?.slice(0, -1).filter((item) => excluded.has(item.id)) ?? [];
  const resolvedById = new Map(resolved?.pages.map((page) => [page.note_id, page]));
  const overrides = new Map(source.page_overrides.map((entry) => [entry.note_id, entry]));

  function toggleExpanded(noteId: string) {
    setExpanded((current) => {
      const next = new Set(current);
      if (next.has(noteId)) next.delete(noteId);
      else next.add(noteId);
      return next;
    });
  }

  function renderNodes(nodes: NoteTreeItem[], depth: number, inheritedExcluded: boolean): React.ReactNode {
    return nodes.map((node) => {
      const explicitlyExcluded = excluded.has(node.id);
      const affectedByParent = inheritedExcluded;
      const publiclyIncluded = !explicitlyExcluded && !affectedByParent;
      const override = overrides.get(node.id);
      const isExpanded = expanded.has(node.id);
      const resolvedPage = resolvedById.get(node.id);
      return <li key={node.id} className="[&:last-child>.site-source-node-row]:border-b-transparent" style={{ "--source-depth": depth } as React.CSSProperties}>
        <div className="site-source-node-row flex min-h-[49px] items-center gap-[9px] border-b border-border py-[7px] pe-3 ps-[calc(14px+var(--source-depth)*19px)] [&>svg]:shrink-0 [&>svg]:text-muted-foreground">
          <Checkbox
              aria-label={`公开 ${node.title}`}
              checked={publiclyIncluded}
              disabled={disabled || affectedByParent}
              onCheckedChange={(checked) => onChange({
                ...source,
                excluded_note_ids: checked
                  ? source.excluded_note_ids.filter((id) => id !== node.id)
                  : [...source.excluded_note_ids, node.id],
              })}
          >
          </Checkbox>
          <FileText aria-hidden="true" size={16} />
          <div className="grid min-w-0 flex-1 gap-[2px]">
            <Link className="truncate text-xs text-foreground" to={`/documents/${node.id}`}>{node.title}</Link>
            <span className="truncate text-xs text-muted-foreground">{affectedByParent ? "受上级排除影响" : explicitlyExcluded ? "已排除此子树" : resolvedPage ? `/${resolvedPage.slug}` : "保存来源后生成公开路径"}</span>
          </div>
          <Button variant="ghost"

            size="sm"
            aria-label={`设置 ${node.title} 的公开信息`}
            aria-expanded={isExpanded}
            onClick={() => toggleExpanded(node.id)}
          >
            <PencilLine aria-hidden="true" size={14} />
            {isExpanded ? <ChevronDown aria-hidden="true" size={14} /> : <ChevronRight aria-hidden="true" size={14} />}
          </Button>
        </div>
        {isExpanded ? <div className="grid grid-cols-1 gap-[11px] border-b border-border bg-card pt-3 pe-[15px] pb-[15px] ps-[calc(54px+var(--source-depth,0)*19px)] min-[721px]:grid-cols-2 [&_input]:min-w-0 [&_textarea]:min-w-0">
          <SiteField>公开标题<Input aria-label={`公开标题：${node.title}`} value={override?.title ?? ""} disabled={disabled} placeholder={node.title} onChange={(event) => onChange(updatePageOverride(source, node.id, { title: event.target.value || null }))} /></SiteField>
          <SiteField>公开路径<Input aria-label={`公开路径：${node.title}`} value={override?.slug ?? ""} disabled={disabled} pattern="[a-z0-9]+(-[a-z0-9]+)*(/[a-z0-9]+(-[a-z0-9]+)*)*" placeholder={resolvedPage?.slug ?? "保存后生成"} onChange={(event) => onChange(updatePageOverride(source, node.id, { slug: event.target.value || null }))} /></SiteField>
          <SiteField className="col-auto min-[721px]:col-span-full">公开简介<Textarea aria-label={`公开简介：${node.title}`} value={override?.description ?? ""} disabled={disabled} rows={2} onChange={(event) => onChange(updatePageOverride(source, node.id, { description: event.target.value || null }))} /></SiteField>
        </div> : null}
        {node.children.length ? <ul className="m-0 list-none p-0">{renderNodes(node.children, depth + 1, affectedByParent || explicitlyExcluded)}</ul> : null}
      </li>;
    });
  }

  const scoped = scopedNoteTree(items, rootNoteId);
  return <>
    {hiddenExcludedAncestors.length ? <aside className="grid gap-1.5 border-b border-[color-mix(in_oklab,var(--status-warning)_25%,var(--card))] bg-status-warning-background px-[15px] py-3 text-xs text-(--status-warning-foreground)" aria-label="隐藏上级排除提示">
      <p className="m-0 leading-[1.55]">隐藏上级“{hiddenExcludedAncestors.map((item) => item.title).join("、")}”已被全局排除，当前范围也不会公开。</p>
      <p className="m-0 leading-[1.55]">清除全局排除会影响所有包含该文档的来源范围，请确认后再恢复。</p>
      <div className="flex flex-wrap gap-2">{hiddenExcludedAncestors.map((item) => <Button variant="outline" key={item.id} disabled={disabled} onClick={() => onChange({ ...source, excluded_note_ids: source.excluded_note_ids.filter((id) => id !== item.id) })}>清除全局排除 {item.title}</Button>)}</div>
    </aside> : null}
    {scoped.length ? <ul className="m-0 list-none px-0 py-1">{renderNodes(scoped, 0, hiddenExcludedAncestors.length > 0)}</ul> : <p className="mt-[5px] text-xs text-muted-foreground">此范围内还没有文档。你仍可以保存来源，添加文档后会自动纳入。</p>}
  </>;
}

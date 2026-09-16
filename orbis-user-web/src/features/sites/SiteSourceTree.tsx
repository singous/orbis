import { ChevronDown, ChevronRight, FileText, PencilLine } from "lucide-react";
import { useState } from "react";
import { Link } from "react-router-dom";

import type { NoteTreeItem } from "../../shared/api/schemas";
import type { SiteSource, SiteSources } from "./schemas";
import { scopedNoteTree, updatePageOverride } from "./source-model";

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
      return <li key={node.id} className="site-source-node" style={{ "--source-depth": depth } as React.CSSProperties}>
        <div className="site-source-node-row">
          <label className="site-source-check">
            <input
              type="checkbox"
              aria-label={`公开 ${node.title}`}
              checked={publiclyIncluded}
              disabled={disabled || affectedByParent}
              onChange={(event) => onChange({
                ...source,
                excluded_note_ids: event.target.checked
                  ? source.excluded_note_ids.filter((id) => id !== node.id)
                  : [...source.excluded_note_ids, node.id],
              })}
            />
          </label>
          <FileText aria-hidden="true" size={15} />
          <div className="site-source-node-copy">
            <Link to={`/documents/${node.id}`}>{node.title}</Link>
            <span>{affectedByParent ? "受上级排除影响" : explicitlyExcluded ? "已排除此子树" : resolvedPage ? `/${resolvedPage.slug}` : "保存来源后生成公开路径"}</span>
          </div>
          <button
            type="button"
            className="site-source-detail-button"
            aria-label={`设置 ${node.title} 的公开信息`}
            aria-expanded={isExpanded}
            onClick={() => toggleExpanded(node.id)}
          >
            <PencilLine aria-hidden="true" size={14} />
            {isExpanded ? <ChevronDown aria-hidden="true" size={13} /> : <ChevronRight aria-hidden="true" size={13} />}
          </button>
        </div>
        {isExpanded ? <div className="site-source-overrides">
          <label>公开标题<input aria-label={`公开标题：${node.title}`} value={override?.title ?? ""} disabled={disabled} placeholder={node.title} onChange={(event) => onChange(updatePageOverride(source, node.id, { title: event.target.value || null }))} /></label>
          <label>公开路径<input aria-label={`公开路径：${node.title}`} value={override?.slug ?? ""} disabled={disabled} pattern="[a-z0-9]+(-[a-z0-9]+)*" placeholder={resolvedPage?.slug ?? "保存后生成"} onChange={(event) => onChange(updatePageOverride(source, node.id, { slug: event.target.value || null }))} /></label>
          <label className="site-source-description">公开简介<textarea aria-label={`公开简介：${node.title}`} value={override?.description ?? ""} disabled={disabled} rows={2} onChange={(event) => onChange(updatePageOverride(source, node.id, { description: event.target.value || null }))} /></label>
        </div> : null}
        {node.children.length ? <ul>{renderNodes(node.children, depth + 1, affectedByParent || explicitlyExcluded)}</ul> : null}
      </li>;
    });
  }

  const scoped = scopedNoteTree(items, rootNoteId);
  return scoped.length ? <ul className="site-source-tree">{renderNodes(scoped, 0, false)}</ul> : <p className="site-source-empty">此范围内还没有文档。你仍可以保存来源，添加文档后会自动纳入。</p>;
}

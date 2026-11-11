import { useMemo, useRef, useState, type PointerEvent } from "react";
import { Button } from "@orbis/ui/button";
import { cn } from "@orbis/ui/cn";
import { ChevronDown, Maximize, Minus, Plus } from "@orbis/ui/icons";

import type { NoteTreeItem } from "../../shared/api/schemas";
import { LoadingState } from "../../shared/ui/LoadingState";
import { DocumentKindIcon } from "./DocumentKindIcon";
import { DocumentLink } from "./DocumentLink";
import { useNoteTree } from "./queries";

const NODE_WIDTH = 186;
const NODE_HEIGHT = 36;
const ROW_HEIGHT = 50;
const COLUMN_STEP = 236;
const MAP_PADDING = 24;
const MIN_ZOOM = 50;
const MAX_ZOOM = 150;
const ZOOM_STEP = 25;

type MapNode = { note: NoteTreeItem; x: number; y: number; parent?: MapNode };

function layoutMindMap(items: NoteTreeItem[], collapsed: ReadonlySet<string>) {
  const nodes: MapNode[] = [];
  let row = 0;
  let depth = 0;
  function visit(note: NoteTreeItem, level: number, parent?: MapNode): MapNode {
    depth = Math.max(depth, level);
    const node = { note, x: MAP_PADDING + level * COLUMN_STEP, y: 0, parent };
    nodes.push(node);
    const children = collapsed.has(note.id) ? [] : note.children.map(child => visit(child, level + 1, node));
    node.y = children.length ? (children[0].y + children[children.length - 1].y) / 2 : MAP_PADDING + row++ * ROW_HEIGHT + NODE_HEIGHT / 2;
    return node;
  }
  const branches = items.map(note => visit(note, 1));
  const height = Math.max(408, MAP_PADDING * 2 + row * ROW_HEIGHT);
  const offset = (height - (MAP_PADDING * 2 + row * ROW_HEIGHT)) / 2;
  for (const node of nodes) node.y += offset;
  const rootY = branches.length ? (branches[0].y + branches[branches.length - 1].y) / 2 : height / 2;
  return { nodes, rootY, height, width: MAP_PADDING * 2 + depth * COLUMN_STEP + NODE_WIDTH };
}

export function NotebookMindMap({ notebookId, title }: { notebookId: string; title: string }) {
  const tree = useNoteTree(notebookId);
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(() => new Set());
  const [zoom, setZoom] = useState(100);
  const scroller = useRef<HTMLDivElement>(null);
  const drag = useRef<{ id: number; x: number; y: number; left: number; top: number } | null>(null);
  const map = useMemo(() => layoutMindMap(tree.data?.items ?? [], collapsed), [tree.data, collapsed]);
  const scale = zoom / 100;

  function startPan(event: PointerEvent<HTMLDivElement>) {
    if (event.button !== 0 || event.pointerType === "touch" || (event.target as Element).closest("a,button")) return;
    const region = event.currentTarget;
    drag.current = { id: event.pointerId, x: event.clientX, y: event.clientY, left: region.scrollLeft, top: region.scrollTop };
    region.setPointerCapture(event.pointerId);
  }

  function pan(event: PointerEvent<HTMLDivElement>) {
    const start = drag.current;
    if (!start || start.id !== event.pointerId) return;
    event.currentTarget.scrollLeft = start.left + start.x - event.clientX;
    event.currentTarget.scrollTop = start.top + start.y - event.clientY;
  }

  if (tree.isLoading) return <LoadingState label="正在读取脑图…" />;
  if (tree.isError) return <p role="alert" className="text-sm text-muted-foreground">无法读取笔记本目录。<Button variant="ghost" size="sm" onClick={() => void tree.refetch()}>重试</Button></p>;
  if (!map.nodes.length) return <p className="rounded-lg bg-sidebar p-6 text-sm text-muted-foreground">新建文档后，脑图会显示笔记本的目录结构。</p>;

  return (
    <div className="grid gap-3.5">
      <div ref={scroller} role="region" aria-label="笔记本目录脑图" tabIndex={0} className="max-h-[min(55dvh,600px)] min-h-48 min-w-0 cursor-grab overflow-auto overscroll-contain rounded-lg active:cursor-grabbing" onPointerDown={startPan} onPointerMove={pan} onLostPointerCapture={() => { drag.current = null; }}>
        <div className="relative mx-auto overflow-hidden" style={{ width: map.width * scale, height: map.height * scale }}>
          <div className="absolute start-0 top-0 origin-top-left" style={{ width: map.width, height: map.height, transform: `scale(${scale})` }}>
            <svg className="pointer-events-none absolute inset-0 text-muted-foreground/45" width={map.width} height={map.height} fill="none" stroke="currentColor" aria-hidden="true">
              {map.nodes.map(({ note, x, y, parent }) => {
                const startX = (parent?.x ?? MAP_PADDING) + NODE_WIDTH;
                const startY = parent?.y ?? map.rootY;
                const mid = (x + startX) / 2;
                return <path key={note.id} d={`M${startX} ${startY} C${mid} ${startY} ${mid} ${y} ${x} ${y}`} strokeDasharray="3 3" />;
              })}
            </svg>
            <div className="absolute grid h-9 place-items-center rounded-md bg-primary px-3 text-primary-foreground" style={{ left: MAP_PADDING, top: map.rootY - NODE_HEIGHT / 2, width: NODE_WIDTH }} title={title}><span className="max-w-full truncate text-sm font-semibold">{title}</span></div>
            {map.nodes.map(({ note, x, y }) => <div key={note.id} className={cn("absolute flex h-9 min-w-0 items-center rounded-md border border-border bg-card px-1", note.children.length > 0 && "border-transparent bg-sidebar-accent text-foreground")} style={{ left: x, top: y - NODE_HEIGHT / 2, width: NODE_WIDTH }}>
              <DocumentLink noteId={note.id} to={`/documents/${note.id}`} className="flex h-full min-w-0 flex-1 items-center gap-2 rounded-md px-2 text-xs hover:underline" title={note.title}>
                <DocumentKindIcon note={note} size={14} /><span className="truncate">{note.title}</span>
              </DocumentLink>
              {note.children.length ? <Button type="button" variant="ghost" size="icon-xs" aria-label={`${collapsed.has(note.id) ? "展开" : "收起"}脑图分支：${note.title}`} aria-expanded={!collapsed.has(note.id)} onClick={() => setCollapsed(current => {
                const next = new Set(current);
                if (next.has(note.id)) next.delete(note.id);
                else next.add(note.id);
                return next;
              })}><ChevronDown className={collapsed.has(note.id) ? "-rotate-90" : undefined} aria-hidden="true" /></Button> : null}
            </div>)}
          </div>
        </div>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
        <span>拖动画布可平移，点击节点打开文档</span>
        <div className="flex items-center gap-1">
          <Button type="button" size="icon-sm" variant="ghost" aria-label="缩小脑图" disabled={zoom <= MIN_ZOOM} onClick={() => setZoom(value => value - ZOOM_STEP)}><Minus aria-hidden="true" /></Button>
          <output aria-label="脑图缩放比例" className="min-w-10 text-center tabular-nums">{zoom}%</output>
          <Button type="button" size="icon-sm" variant="ghost" aria-label="放大脑图" disabled={zoom >= MAX_ZOOM} onClick={() => setZoom(value => value + ZOOM_STEP)}><Plus aria-hidden="true" /></Button>
          <Button type="button" size="icon-sm" variant="ghost" aria-label="重置脑图视图" onClick={() => { setZoom(100); scroller.current?.scrollTo(0, 0); }}><Maximize aria-hidden="true" /></Button>
        </div>
      </div>
    </div>
  );
}

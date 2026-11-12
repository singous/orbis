import { useMemo, useRef, useState, type PointerEvent } from "react";
import { Button } from "@orbis/ui/button";
import { cn } from "@orbis/ui/cn";
import { ChevronDown, Maximize, Minus, Plus } from "@orbis/ui/icons";

import type { NoteTreeItem } from "../../shared/api/schemas";
import { LoadingState } from "../../shared/ui/LoadingState";
import { DocumentLink } from "./DocumentLink";
import { useNoteTree } from "./queries";

const ROOT_WIDTH = 124;
const BRANCH_WIDTH = 200;
const CHILD_WIDTH = 180;
const NODE_HEIGHT = 36;
const ROOT_GAP = 206;
const CHILD_GAP = 134;
const BRANCH_STEP = 90;
const CHILD_STEP = 46;
const MAP_PADDING = 24;
const MIN_ZOOM = 50;
const MAX_ZOOM = 150;
const ZOOM_STEP = 25;

type MapNode = { note: NoteTreeItem; x: number; y: number; width: number; parent?: MapNode };

function layoutMindMap(items: NoteTreeItem[], expanded: ReadonlySet<string>) {
  const nodes: MapNode[] = [];
  const rowStep = items.some(note => expanded.has(note.id) && note.children.length) ? CHILD_STEP : BRANCH_STEP;
  let row = 0;
  let right = MAP_PADDING + ROOT_WIDTH;

  function visit(note: NoteTreeItem, parent?: MapNode): MapNode {
    const width = parent ? CHILD_WIDTH : BRANCH_WIDTH;
    const x = parent ? parent.x + parent.width + CHILD_GAP : MAP_PADDING + ROOT_WIDTH + ROOT_GAP;
    right = Math.max(right, x + width);
    const node = { note, x, width, y: 0, parent };
    nodes.push(node);
    const children = expanded.has(note.id) ? note.children.map(child => visit(child, node)) : [];
    node.y = children.length ? (children[0].y + children[children.length - 1].y) / 2 : MAP_PADDING + row++ * rowStep + NODE_HEIGHT / 2;
    return node;
  }

  const branches = items.map(note => visit(note));
  const rowsHeight = row ? (row - 1) * rowStep + NODE_HEIGHT : 0;
  const height = Math.max(408, MAP_PADDING * 2 + rowsHeight);
  const offset = (height - (MAP_PADDING * 2 + rowsHeight)) / 2;
  for (const node of nodes) node.y += offset;
  const rootY = branches.length ? (branches[0].y + branches[branches.length - 1].y) / 2 : height / 2;
  return { nodes, rootY, height, width: right + MAP_PADDING };
}

export function NotebookMindMap({ notebookId, title }: { notebookId: string; title: string }) {
  const tree = useNoteTree(notebookId);
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(() => new Set());
  const [zoom, setZoom] = useState(100);
  const scroller = useRef<HTMLDivElement>(null);
  const drag = useRef<{ id: number; x: number; y: number; left: number; top: number } | null>(null);
  const map = useMemo(() => layoutMindMap(tree.data?.items ?? [], expanded), [tree.data, expanded]);
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
        <div className="relative overflow-hidden min-[1280px]:ms-24" style={{ width: map.width * scale, height: map.height * scale }}>
          <div className="absolute start-0 top-0 origin-top-left" style={{ width: map.width, height: map.height, transform: `scale(${scale})` }}>
            <svg className="pointer-events-none absolute inset-0 text-(--ob-notebook-map-line)" width={map.width} height={map.height} fill="none" stroke="currentColor" aria-hidden="true">
              {map.nodes.map(({ note, x, y, parent }) => {
                const startX = parent ? parent.x + parent.width : MAP_PADDING + ROOT_WIDTH;
                const startY = parent?.y ?? map.rootY;
                const mid = (x + startX) / 2;
                return <path key={note.id} d={`M${startX} ${startY} C${mid} ${startY} ${mid} ${y} ${x} ${y}`} strokeDasharray="3 3" />;
              })}
            </svg>
            <div className="absolute grid h-9 place-items-center rounded-md bg-primary px-3 text-primary-foreground" style={{ left: MAP_PADDING, top: map.rootY - NODE_HEIGHT / 2, width: ROOT_WIDTH }} title={title}><span className="max-w-full truncate text-sm font-semibold">{title}</span></div>
            {map.nodes.map(({ note, x, y, width }) => <div key={note.id} className={cn("absolute flex h-9 min-w-0 items-center justify-center rounded-md border border-border bg-card px-3", note.children.length > 0 && "border-transparent bg-sidebar-accent text-foreground")} style={{ left: x, top: y - NODE_HEIGHT / 2, width }}>
              <DocumentLink noteId={note.id} to={`/documents/${note.id}`} className="flex h-full min-w-0 items-center rounded-md text-xs hover:underline" title={note.title}>
                <span className="truncate">{note.title}</span>
              </DocumentLink>
              {note.children.length ? <Button type="button" variant="ghost" size="xs" className="ms-3 gap-1 rounded-full bg-card px-1.5 text-[10px] aria-expanded:bg-card" aria-label={`${expanded.has(note.id) ? "收起" : "展开"}脑图分支：${note.title}`} aria-expanded={expanded.has(note.id)} onClick={() => setExpanded(current => {
                const next = new Set(current);
                if (next.has(note.id)) next.delete(note.id);
                else next.add(note.id);
                return next;
              })}><span aria-hidden="true">{note.children.length}</span><ChevronDown className={expanded.has(note.id) ? undefined : "-rotate-90"} aria-hidden="true" /></Button> : null}
            </div>)}
          </div>
        </div>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
        <span>默认展示一级 · 点击箭头逐层展开 · 点击标题打开页面</span>
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

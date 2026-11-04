import { DropdownMenu, DropdownMenuContent, DropdownMenuRadioGroup, DropdownMenuRadioItem, DropdownMenuTrigger } from "@orbis/ui/dropdown-menu";
import { Maximize, Minus, Plus } from "@orbis/ui/icons";
import { useRef, useState, type ReactNode } from "react";
import { Button } from "@orbis/ui/button";

import { Tooltip, TooltipTrigger, TooltipContent } from "@orbis/ui/tooltip";

const previewActionClassName = "board-preview-action shrink-0";

const MIN_ZOOM = 0.2;
const MAX_ZOOM = 4;
const ZOOM_STEP = 1.2;
export const PREVIEW_ZOOMS = [0.2, 0.5, 0.75, 1, 1.5, 2, 3, 4];

export function BoardPreviewViewport({ children }: { children: ReactNode }) {
  const [view, setView] = useState({ x: 0, y: 0, zoom: 1 });
  const drag = useRef<{ x: number; y: number; origin: typeof view } | null>(null);
  function zoom(value: number) {
    setView(old => {
      const next = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, value));
      return { x: old.x * next / old.zoom, y: old.y * next / old.zoom, zoom: next };
    });
  }
  function fit() { setView({ x: 0, y: 0, zoom: 1 }); }
  return <div className="board-preview-viewport relative h-full min-h-0 overflow-hidden">
    <div className="board-preview-pan absolute inset-0 cursor-grab touch-none outline-none active:cursor-grabbing forced-colors:focus-ring forced-colors:focus-visible:outline-offset-[-2px] focus-visible:[box-shadow:inset_0_0_0_2px_var(--ring)]" tabIndex={0} role="region" aria-label="画板预览，拖动平移，使用缩放工具查看细节"
      onPointerDown={event => {
        if (event.button !== 0) return;
        event.preventDefault();
        event.currentTarget.focus({ preventScroll: true });
        event.currentTarget.setPointerCapture(event.pointerId);
        drag.current = { x: event.clientX, y: event.clientY, origin: view };
      }}
      onPointerMove={event => {
        if (drag.current) setView({ ...drag.current.origin, x: drag.current.origin.x + event.clientX - drag.current.x, y: drag.current.origin.y + event.clientY - drag.current.y });
      }}
      onPointerUp={() => { drag.current = null; }}
      onPointerCancel={() => { drag.current = null; }}
      onLostPointerCapture={() => { drag.current = null; }}
      onKeyDown={event => {
        const moves: Record<string, [number, number]> = { ArrowLeft: [40, 0], ArrowRight: [-40, 0], ArrowUp: [0, 40], ArrowDown: [0, -40] };
        if (moves[event.key]) {
          event.preventDefault();
          const [x, y] = moves[event.key];
          setView(old => ({ ...old, x: old.x + x, y: old.y + y }));
        } else if (["+", "=", "-", "0"].includes(event.key)) {
          event.preventDefault();
          if (event.key === "0") fit();
          else zoom(view.zoom * (event.key === "-" ? 1 / ZOOM_STEP : ZOOM_STEP));
        }
      }}>
      <div className="board-preview-transform pointer-events-none h-full w-full origin-center p-5 select-none" style={{ transform: `translate(${view.x}px, ${view.y}px) scale(${view.zoom})` }}>{children}</div>
    </div>
    <div className="board-preview-tools absolute top-2.5 right-3 flex items-center gap-0.5 rounded-lg border border-border bg-card p-[3px] [box-shadow:var(--ob-board-preview-controls-shadow)]" role="group" aria-label="画板预览缩放">
      <Tooltip><TooltipTrigger render={<Button  className={previewActionClassName} aria-label="适应画布" onClick={fit} variant="ghost" size="icon"><Maximize size={16} /></Button>} /><TooltipContent>{"适应画布"}</TooltipContent></Tooltip>
      <Tooltip><TooltipTrigger render={<Button  className={previewActionClassName} aria-label="缩小画板" disabled={view.zoom <= MIN_ZOOM} onClick={() => zoom(view.zoom / ZOOM_STEP)} variant="ghost" size="icon"><Minus size={15} /></Button>} /><TooltipContent>{"缩小画板"}</TooltipContent></Tooltip>
      <DropdownMenu>
        <DropdownMenuTrigger render={<Button  className={previewActionClassName} aria-label={`缩放比例 ${Math.round(view.zoom * 100)}%`} variant="ghost">{Math.round(view.zoom * 100)}%</Button>} />
        <DropdownMenuContent align="end" aria-label="缩放比例">
          <DropdownMenuRadioGroup value={view.zoom} onValueChange={zoom}>
            {PREVIEW_ZOOMS.map(value => <DropdownMenuRadioItem key={value} value={value} closeOnClick label={`${value * 100}%`}>{value * 100}%</DropdownMenuRadioItem>)}
          </DropdownMenuRadioGroup>
        </DropdownMenuContent>
      </DropdownMenu>
      <Tooltip><TooltipTrigger render={<Button  className={previewActionClassName} aria-label="放大画板" disabled={view.zoom >= MAX_ZOOM} onClick={() => zoom(view.zoom * ZOOM_STEP)} variant="ghost" size="icon"><Plus size={15} /></Button>} /><TooltipContent>{"放大画板"}</TooltipContent></Tooltip>
    </div>
  </div>;
}

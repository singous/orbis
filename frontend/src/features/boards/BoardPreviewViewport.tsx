import { Dropdown } from "@heroui/react/dropdown";
import { Maximize, Minus, Plus } from "lucide-react";
import { useRef, useState, type ReactNode } from "react";
import { ActionButton } from "../../shared/ui/ActionButton";
import { Tooltip } from "../../shared/ui/Tooltip";

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
  return <div className="board-preview-viewport">
    <div className="board-preview-pan" tabIndex={0} role="region" aria-label="画板预览，拖动平移，使用缩放工具查看细节"
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
      <div className="board-preview-transform" style={{ transform: `translate(${view.x}px, ${view.y}px) scale(${view.zoom})` }}>{children}</div>
    </div>
    <div className="board-preview-tools" role="group" aria-label="画板预览缩放">
      <Tooltip label="适应画布"><ActionButton aria-label="适应画布" onPress={fit}><Maximize size={16} /></ActionButton></Tooltip>
      <Tooltip label="缩小画板"><ActionButton aria-label="缩小画板" isDisabled={view.zoom <= MIN_ZOOM} onPress={() => zoom(view.zoom / ZOOM_STEP)}><Minus size={15} /></ActionButton></Tooltip>
      <Dropdown>
        <ActionButton aria-label={`缩放比例 ${Math.round(view.zoom * 100)}%`}>{Math.round(view.zoom * 100)}%</ActionButton>
        <Dropdown.Popover placement="bottom end"><Dropdown.Menu aria-label="缩放比例" selectionMode="single" selectedKeys={new Set([String(view.zoom)])} onAction={key => zoom(Number(key))}>
          {PREVIEW_ZOOMS.map(value => <Dropdown.Item key={value} id={String(value)} textValue={`${value * 100}%`}>{value * 100}%</Dropdown.Item>)}
        </Dropdown.Menu></Dropdown.Popover>
      </Dropdown>
      <Tooltip label="放大画板"><ActionButton aria-label="放大画板" isDisabled={view.zoom >= MAX_ZOOM} onPress={() => zoom(view.zoom * ZOOM_STEP)}><Plus size={15} /></ActionButton></Tooltip>
    </div>
  </div>;
}

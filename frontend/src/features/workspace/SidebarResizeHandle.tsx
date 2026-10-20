import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from "react";
import { SIDEBAR_MIN_WIDTH } from "./use-sidebar-resize";

const KEYBOARD_RESIZE_STEP = 16;

type Props = {
  label?: string;
  controls?: string;
  width: number;
  maximum: number;
  preview: (width: number) => void;
  commit: (width: number) => void;
  reset: () => void;
  begin: () => () => void;
};
type DragSession = { pointerId: number; startX: number; startWidth: number; latestWidth: number; target: HTMLDivElement; restore: () => void };

export function SidebarResizeHandle({ width, maximum, preview, commit, reset, begin, label = "调整侧栏宽度", controls = "workspace-sidebar" }: Props) {
  const session = useRef<DragSession | null>(null);
  const [dragging, setDragging] = useState(false);
  const [pointerFocused, setPointerFocused] = useState(false);

  function finish(accept: boolean) {
    const current = session.current;
    if (!current) return;
    session.current = null;
    document.documentElement.classList.remove("workspace-resizing");
    setDragging(false);
    if (accept) commit(current.latestWidth); else current.restore();
    if (current.target.hasPointerCapture(current.pointerId)) current.target.releasePointerCapture(current.pointerId);
  }

  useEffect(() => {
    const cancel = () => {
      const current = session.current;
      if (!current) return;
      session.current = null;
      current.restore();
      document.documentElement.classList.remove("workspace-resizing");
      setDragging(false);
      if (current.target.hasPointerCapture(current.pointerId)) current.target.releasePointerCapture(current.pointerId);
    };
    window.addEventListener("blur", cancel);
    return () => { window.removeEventListener("blur", cancel); cancel(); };
  }, []);

  function start(event: PointerEvent<HTMLDivElement>) {
    if (event.button !== 0 || session.current) return;
    event.preventDefault();
    setPointerFocused(true);
    event.currentTarget.focus({ preventScroll: true });
    event.currentTarget.setPointerCapture(event.pointerId);
    session.current = { pointerId: event.pointerId, startX: event.clientX, startWidth: width, latestWidth: width, target: event.currentTarget, restore: begin() };
    document.documentElement.classList.add("workspace-resizing");
    setDragging(true);
  }
  function move(event: PointerEvent<HTMLDivElement>) {
    const current = session.current;
    if (!current || current.pointerId !== event.pointerId) return;
    const next = Math.round(Math.min(maximum, Math.max(SIDEBAR_MIN_WIDTH, current.startWidth + event.clientX - current.startX)));
    current.latestWidth = next;
    preview(next);
  }
  function end(event: PointerEvent<HTMLDivElement>, accept: boolean) {
    if (session.current?.pointerId === event.pointerId) finish(accept);
  }
  function keyDown(event: KeyboardEvent<HTMLDivElement>) {
    setPointerFocused(false);
    if (event.key === "Escape" && session.current) { event.preventDefault(); finish(false); return; }
    if (session.current) return;
    const next = event.key === "ArrowLeft" ? width - KEYBOARD_RESIZE_STEP : event.key === "ArrowRight" ? width + KEYBOARD_RESIZE_STEP : event.key === "Home" ? SIDEBAR_MIN_WIDTH : event.key === "End" ? maximum : null;
    if (next !== null) { event.preventDefault(); commit(next); }
  }

  return <div role="separator" aria-label={label} aria-orientation="vertical" aria-controls={controls} aria-valuemin={SIDEBAR_MIN_WIDTH} aria-valuemax={maximum} aria-valuenow={width} aria-valuetext={`${width} 像素`} tabIndex={0} className="workspace-sidebar-resizer" data-resizing={dragging || undefined} data-pointer-focus={pointerFocused || undefined}
    title="拖动调整宽度；双击恢复默认" onPointerDown={start} onPointerMove={move} onPointerUp={(event) => end(event, true)} onPointerCancel={(event) => end(event, false)} onLostPointerCapture={(event) => end(event, false)} onDoubleClick={reset} onKeyDown={keyDown} onBlur={() => setPointerFocused(false)}>
    <span className="workspace-resize-line" aria-hidden="true" />
  </div>;
}

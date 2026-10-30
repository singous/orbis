import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";

const DRAG_ACTIVATION_DISTANCE_PX = 5;

/** Reorder only after release; cancellation and incidental clicks never write. */
export function usePointerReorder(onMove: (id: string, target: string, after: boolean) => void) {
  const latestMove = useRef(onMove);
  latestMove.current = onMove;
  const [target, setTarget] = useState<{ id: string; after: boolean } | null>(null);
  const cancel = useRef<(() => void) | null>(null);
  useEffect(() => () => cancel.current?.(), []);
  function start(event: ReactPointerEvent<HTMLElement>, id: string) {
    if (event.button !== 0) return;
    cancel.current?.();
    const handle = event.currentTarget;
    const scope = handle.closest("[data-reorder-scope]");
    const origin = { x: event.clientX, y: event.clientY };
    let moved = false;
    let destination: { id: string; after: boolean } | null = null;
    event.preventDefault();
    handle.focus();
    handle.setPointerCapture(event.pointerId);
    const cleanup = () => {
      handle.removeEventListener("pointermove", move);
      handle.removeEventListener("pointerup", up);
      handle.removeEventListener("pointercancel", cleanup);
      handle.removeEventListener("lostpointercapture", cleanup);
      setTarget(null);
      cancel.current = null;
    };
    const move = (e: PointerEvent) => {
      if (Math.hypot(e.clientX - origin.x, e.clientY - origin.y) < DRAG_ACTIVATION_DISTANCE_PX && !moved) return;
      moved = true;
      const hit = document.elementFromPoint(e.clientX, e.clientY)?.closest<HTMLElement>("[data-reorder-id]");
      if (!hit || hit.closest("[data-reorder-scope]") !== scope || hit.dataset.reorderId === id) { destination = null; setTarget(null); return; }
      const rect = hit.getBoundingClientRect();
      destination = { id: hit.dataset.reorderId!, after: e.clientY > rect.top + rect.height / 2 };
      setTarget(destination);
    };
    const up = () => { const drop = destination; cleanup(); if (moved && drop) latestMove.current(id, drop.id, drop.after); };
    cancel.current = cleanup;
    handle.addEventListener("pointermove", move);
    handle.addEventListener("pointerup", up);
    handle.addEventListener("pointercancel", cleanup);
    handle.addEventListener("lostpointercapture", cleanup);
  }
  return { target, start };
}

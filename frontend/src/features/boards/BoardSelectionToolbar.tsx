import { Toolbar } from "@heroui/react/toolbar";
import { useLayoutEffect, useRef, useState, type ReactNode, type RefObject } from "react";
import type { Bounds } from "./geometry";
import type { Camera } from "./renderer";
import { selectionToolbarPosition } from "./selection-geometry";

export function BoardSelectionToolbar({ bounds, camera, viewport, children }: {
  bounds: Bounds;
  camera: Camera;
  viewport: RefObject<HTMLDivElement | null>;
  children: ReactNode;
}) {
  const toolbar = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ width: 0, height: 0, viewportWidth: 0, viewportHeight: 0 });
  useLayoutEffect(() => {
    const node = toolbar.current;
    const canvas = viewport.current;
    if (!node || !canvas) return;
    const measure = () => {
      const next = { width: node.offsetWidth, height: node.offsetHeight, viewportWidth: canvas.clientWidth, viewportHeight: canvas.clientHeight };
      setSize(current => Object.keys(next).every(key => current[key as keyof typeof current] === next[key as keyof typeof next]) ? current : next);
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    observer.observe(canvas);
    return () => observer.disconnect();
  }, [viewport]);
  const position = selectionToolbarPosition(bounds, camera, { width: size.viewportWidth, height: size.viewportHeight }, size);
  return <Toolbar
    ref={toolbar}
    aria-label="选中对象操作"
    className="board-selection-actions"
    style={{ left: position?.left ?? 0, top: position?.top ?? 0, visibility: position && size.width ? "visible" : "hidden" }}
  >{children}</Toolbar>;
}

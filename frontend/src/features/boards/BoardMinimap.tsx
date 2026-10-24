import { ActionButton } from "../../shared/ui/ActionButton";
import { hiddenElements } from "./mindmap";
import { useEffect, useMemo, useRef } from "react";
import { unionBounds } from "./geometry";
import type { Element } from "./model";
import type { BoardRenderer, Camera } from "./renderer";

const WIDTH = 100,
  HEIGHT = 64,
  PADDING = 8;
export function BoardMinimap({
  elements,
  camera,
  renderer,
  onCamera,
}: {
  elements: Map<string, Element>;
  camera: Camera;
  renderer: BoardRenderer | null;
  onCamera: (camera: Camera) => void;
}) {
  const hidden = useMemo(() => hiddenElements(elements), [elements]);
  const canvas = useRef<HTMLCanvasElement>(null);
  const bounds = useMemo(
    () =>
      unionBounds(
        [...elements.values()]
          .filter((e) => e.shape_type !== "connector" && !hidden.has(e.id))
          .map((e) => e.geometry),
      ),
    [elements],
  );
  const scale = Math.min(
    (WIDTH - 2 * PADDING) / Math.max(bounds.width, 1),
    (HEIGHT - 2 * PADDING) / Math.max(bounds.height, 1),
  );
  const offsetX = (WIDTH - bounds.width * scale) / 2,
    offsetY = (HEIGHT - bounds.height * scale) / 2;
  useEffect(() => {
    const context = canvas.current?.getContext("2d");
    if (!context) return;
    context.clearRect(0, 0, WIDTH, HEIGHT);
    context.fillStyle = "#d9dfe7";
    for (const element of elements.values()) {
      if (element.shape_type === "connector" || hidden.has(element.id))
        continue;
      const g = element.geometry;
      context.fillRect(
        offsetX + (g.x - bounds.x) * scale,
        offsetY + (g.y - bounds.y) * scale,
        Math.max(2, g.width * scale),
        Math.max(2, g.height * scale),
      );
    }
  }, [elements, hidden, bounds, scale, offsetX, offsetY]);
  if (!elements.size) return null;
  const viewport = renderer
    ? {
        left: offsetX + (-camera.x / camera.zoom - bounds.x) * scale,
        top: offsetY + (-camera.y / camera.zoom - bounds.y) * scale,
        width: (renderer.stage.width() / camera.zoom) * scale,
        height: (renderer.stage.height() / camera.zoom) * scale,
      }
    : null;
  return (
    <ActionButton
      className="board-minimap"
      aria-label="画板小地图，点击定位"
      onClick={(event) => {
        if (!renderer) return;
        const rect = event.currentTarget.getBoundingClientRect();
        const screenX = event.detail === 0 ? WIDTH / 2 : event.clientX - rect.left,
          screenY = event.detail === 0 ? HEIGHT / 2 : event.clientY - rect.top;
        const x = (screenX - offsetX) / scale + bounds.x,
          y = (screenY - offsetY) / scale + bounds.y;
        onCamera({
          ...camera,
          x: renderer.stage.width() / 2 - x * camera.zoom,
          y: renderer.stage.height() / 2 - y * camera.zoom,
        });
      }}
    >
      <canvas ref={canvas} width={WIDTH} height={HEIGHT} />
      {viewport ? (
        <span className="board-minimap-viewport" style={viewport} />
      ) : null}
    </ActionButton>
  );
}

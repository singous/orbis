import { MIN_ZOOM, MAX_ZOOM, type Camera } from "./renderer";
import type { Point } from "./model";

/** 缩放时保持锚点下的世界坐标不变，避免工具栏缩放让内容漂移。 */
export function zoomAt(camera: Camera, next: number, anchor: Point): Camera {
  const zoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, next));
  const ratio = zoom / camera.zoom;
  return {
    x: anchor.x - (anchor.x - camera.x) * ratio,
    y: anchor.y - (anchor.y - camera.y) * ratio,
    zoom,
  };
}

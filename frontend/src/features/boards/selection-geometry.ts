import { elementBounds, unionBounds, type Bounds } from "./geometry";
import type { Element } from "./model";
import type { Camera } from "./renderer";

type Size = { width: number; height: number };
const EDGE_MARGIN = 8;
const SELECTION_GAP = 12;

export function selectedBounds(elements: ReadonlyMap<string, Element>, selection: ReadonlySet<string>, preview: readonly Element[] = []): Bounds | null {
  const overrides = new Map(preview.map(element => [element.id, element]));
  const selected = [...selection].map(id => overrides.get(id) ?? elements.get(id)).filter((element): element is Element => !!element);
  if (!selected.length) return null;
  // 普通图形不复制完整场景；仅在选中连线且端点正在预览时补齐端点上下文。
  const scene = overrides.size && selected.some(element => element.shape_type === "connector")
    ? new Map([...elements, ...overrides]) : elements;
  return unionBounds(selected.map(element => elementBounds(element, scene)));
}

export function selectionToolbarPosition(bounds: Bounds, camera: Camera, viewport: Size, toolbar: Size) {
  const left = bounds.x * camera.zoom + camera.x;
  const top = bounds.y * camera.zoom + camera.y;
  const width = bounds.width * camera.zoom;
  const height = bounds.height * camera.zoom;
  if (left + width < 0 || top + height < 0 || left > viewport.width || top > viewport.height) return null;
  const clamp = (value: number, limit: number) => Math.max(EDGE_MARGIN, Math.min(value, limit - EDGE_MARGIN));
  const above = top - toolbar.height - SELECTION_GAP;
  const y = above >= EDGE_MARGIN ? above : top + height + SELECTION_GAP;
  return {
    left: clamp(left + (width - toolbar.width) / 2, viewport.width - toolbar.width),
    top: clamp(y, viewport.height - toolbar.height),
  };
}

import { SHAPES, type Element, type Endpoint, type Point } from "./model";

export type Bounds = { x: number; y: number; width: number; height: number };
export const MEMBER_ROW_HEIGHT = 24;
export const MEMBER_HEADER_HEIGHT = 36;
export const CANVAS_FONT = 'Inter, "Noto Sans SC", system-ui, sans-serif';
export function intersects(a: Bounds, b: Bounds): boolean {
  return (
    a.x <= b.x + b.width &&
    a.x + a.width >= b.x &&
    a.y <= b.y + b.height &&
    a.y + a.height >= b.y
  );
}
export function unionBounds(values: Bounds[]): Bounds {
  if (!values.length) return { x: 0, y: 0, width: 1, height: 1 };
  const x = Math.min(...values.map((b) => b.x)),
    y = Math.min(...values.map((b) => b.y));
  return {
    x,
    y,
    width: Math.max(...values.map((b) => b.x + b.width)) - x || 1,
    height: Math.max(...values.map((b) => b.y + b.height)) - y || 1,
  };
}
export function rotate(point: Point, center: Point, angle: number): Point {
  const x = point.x - center.x,
    y = point.y - center.y;
  return {
    x: center.x + x * Math.cos(angle) - y * Math.sin(angle),
    y: center.y + x * Math.sin(angle) + y * Math.cos(angle),
  };
}
export function portPosition(element: Element, port: string): Point {
  const g = element.geometry;
  let x = g.x + g.width / 2,
    y = g.y + g.height / 2;
  const [side, member] = port.split(":");
  if (side === "time" && element.shape_type === "uml.lifeline")
    y = g.y + g.height * Math.max(0.2, Math.min(1, Number(member)));
  if (side === "top") y = g.y;
  if (side === "bottom") y += g.height / 2;
  if (side === "left") x = g.x;
  if (side === "right") x += g.width / 2;
  if (member && side !== "time") {
    const index = element.structure.members.findIndex(
      (row) => row.id === member,
    );
    if (index >= 0)
      y = g.y + MEMBER_HEADER_HEIGHT + (index + 0.5) * MEMBER_ROW_HEIGHT;
  }
  return rotate(
    { x, y },
    { x: g.x + g.width / 2, y: g.y + g.height / 2 },
    g.rotation_rad,
  );
}
export function endpointPosition(
  endpoint: Endpoint | null,
  elements: ReadonlyMap<string, Element>,
): Point {
  if (!endpoint) return { x: 0, y: 0 };
  const node = endpoint.element_id
    ? elements.get(endpoint.element_id)
    : undefined;
  return node
    ? portPosition(node, endpoint.port)
    : { x: endpoint.x, y: endpoint.y };
}
export function connectorPoints(
  element: Element,
  elements: ReadonlyMap<string, Element>,
): Point[] {
  const start = endpointPosition(element.structure.start, elements),
    end = endpointPosition(element.structure.end, elements);
  if (element.structure.points.length)
    return [start, ...element.structure.points, end];
  if (element.structure.route !== "orthogonal") return [start, end];
  const vertical = ["top", "bottom"].includes(
    element.structure.start?.port ?? "",
  );
  return vertical
    ? [
        start,
        { x: start.x, y: (start.y + end.y) / 2 },
        { x: end.x, y: (start.y + end.y) / 2 },
        end,
      ]
    : [
        start,
        { x: (start.x + end.x) / 2, y: start.y },
        { x: (start.x + end.x) / 2, y: end.y },
        end,
      ];
}
export function connectorPath(
  element: Element,
  elements: ReadonlyMap<string, Element>,
): string {
  const points = connectorPoints(element, elements),
    start = points[0],
    end = points.at(-1)!;
  if (element.structure.route === "curve" && points.length === 2) {
    const mid = (start.x + end.x) / 2;
    return `M${start.x},${start.y} C${mid},${start.y} ${mid},${end.y} ${end.x},${end.y}`;
  }
  return points.map((p, i) => `${i ? "L" : "M"}${p.x},${p.y}`).join(" ");
}
export function elementBounds(
  element: Element,
  elements: ReadonlyMap<string, Element>,
): Bounds {
  if (element.shape_type === "connector") {
    const points = connectorPoints(element, elements);
    const x = Math.min(...points.map((p) => p.x)),
      y = Math.min(...points.map((p) => p.y));
    return {
      x: x - 16,
      y: y - 16,
      width: Math.max(...points.map((p) => p.x)) - x + 32,
      height: Math.max(...points.map((p) => p.y)) - y + 32,
    };
  }
  const g = element.geometry,
    cx = g.x + g.width / 2,
    cy = g.y + g.height / 2;
  const w =
    Math.abs(g.width * Math.cos(g.rotation_rad)) +
    Math.abs(g.height * Math.sin(g.rotation_rad));
  const h =
    Math.abs(g.width * Math.sin(g.rotation_rad)) +
    Math.abs(g.height * Math.cos(g.rotation_rad));
  return { x: cx - w / 2, y: cy - h / 2, width: w, height: h };
}

// Paths use a normalized 100 by 100 coordinate system shared by canvas and SVG.
export function shapePath(primitive: string): string {
  return (
    [...SHAPES.values()].find((shape) => shape.primitive === primitive)?.path ??
    "M0 0H100V100H0Z"
  );
}
export function isMemberShape(element: Element): boolean {
  return ["entity", "weak-entity", "class"].includes(
    SHAPES.get(element.shape_type)?.primitive ?? "",
  );
}
export function isContainer(element: Element): boolean {
  return SHAPES.get(element.shape_type)?.container ?? false;
}
export function wrapText(
  text: string,
  maxWidth: number,
  measure: (text: string) => number,
): string[] {
  const lines: string[] = [];
  for (const paragraph of text.split("\n")) {
    let line = "";
    for (const char of Array.from(paragraph)) {
      if (line && measure(line + char) > maxWidth) {
        lines.push(line);
        line = char;
      } else line += char;
    }
    lines.push(line);
  }
  return lines;
}

const CELL_SIZE = 512,
  MAX_INDEX_CELLS = 256;
/** Bounds are independent of renderer objects; large edges cannot explode the grid. */
export class SpatialIndex {
  private cells = new Map<string, Set<string>>();
  private entries = new Map<string, { bounds: Bounds; keys: string[] }>();
  private large = new Set<string>();
  private keys(bounds: Bounds): string[] {
    const left = Math.floor(bounds.x / CELL_SIZE),
      right = Math.floor((bounds.x + bounds.width) / CELL_SIZE);
    const top = Math.floor(bounds.y / CELL_SIZE),
      bottom = Math.floor((bounds.y + bounds.height) / CELL_SIZE);
    if ((right - left + 1) * (bottom - top + 1) > MAX_INDEX_CELLS) return [];
    const result: string[] = [];
    for (let x = left; x <= right; x++)
      for (let y = top; y <= bottom; y++) result.push(`${x}:${y}`);
    return result;
  }
  set(id: string, bounds: Bounds) {
    this.delete(id);
    const keys = this.keys(bounds);
    this.entries.set(id, { bounds, keys });
    if (!keys.length) this.large.add(id);
    for (const key of keys) {
      const cell = this.cells.get(key) ?? new Set<string>();
      cell.add(id);
      this.cells.set(key, cell);
    }
  }
  delete(id: string) {
    const entry = this.entries.get(id);
    for (const key of entry?.keys ?? []) {
      const cell = this.cells.get(key)!;
      cell.delete(id);
      if (!cell.size) this.cells.delete(key);
    }
    this.large.delete(id);
    this.entries.delete(id);
  }
  query(bounds: Bounds): string[] {
    const keys = this.keys(bounds);
    const candidates = keys.length
      ? new Set([
          ...this.large,
          ...keys.flatMap((key) => [...(this.cells.get(key) ?? [])]),
        ])
      : new Set(this.entries.keys());
    return [...candidates].filter((id) =>
      intersects(this.entries.get(id)!.bounds, bounds),
    );
  }
}

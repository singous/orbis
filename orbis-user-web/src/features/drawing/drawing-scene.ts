/** Versioned document data; drawing engine runtime state never enters a block. */
export const DRAWING_VERSION = 1;
export const MAX_DRAWING_BYTES = 1024 * 1024;
export const MAX_DRAWING_ELEMENTS = 2000;
export const DRAWING_ELEMENT_TYPES = new Set(["rectangle", "diamond", "ellipse", "line", "arrow", "freedraw", "text"]);
const MAX_COORDINATE = 1_000_000;
const COLOR = /^(?:#[\da-f]{3,8}|transparent)$/i;
const TRANSIENT_ELEMENT_KEYS = new Set(["customData", "link"]);
const MAX_DRAWING_POINTS = 20_000;

export type DrawingElement = Record<string, unknown> & { id: string; type: string; x: number; y: number; width: number; height: number };
export type DrawingScene = { version: 1; elements: DrawingElement[]; appState: { viewBackgroundColor: string } };

export function emptyDrawing(): DrawingScene {
  return { version: DRAWING_VERSION, elements: [], appState: { viewBackgroundColor: "#ffffff" } };
}

function record(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function coordinate(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && Math.abs(value) <= MAX_COORDINATE;
}

function validateElementData(element: Record<string, unknown>) {
  if (["line", "arrow", "freedraw"].includes(String(element.type)) && !Array.isArray(element.points)) throw new Error("画板线条数据无效。");
  if (element.points !== undefined && (!Array.isArray(element.points) || !element.points.length || element.points.length > MAX_DRAWING_POINTS || element.points.some(point => !Array.isArray(point) || point.length !== 2 || !point.every(coordinate)))) throw new Error("画板线条数据无效。");
  if (element.type === "text" && typeof element.text !== "string") throw new Error("画板文字数据无效。");
  for (const field of ["strokeColor", "backgroundColor", "text", "originalText"]) {
    if (element[field] !== undefined && typeof element[field] !== "string") throw new Error("画板图形属性无效。");
  }
  if (element.groupIds !== undefined && (!Array.isArray(element.groupIds) || element.groupIds.some(id => typeof id !== "string"))) throw new Error("画板分组数据无效。");
  if (element.boundElements != null && (!Array.isArray(element.boundElements) || element.boundElements.some(binding => !record(binding) || typeof binding.id !== "string" || !["arrow", "text"].includes(String(binding.type))))) throw new Error("画板关联数据无效。");
  for (const field of ["startBinding", "endBinding"]) {
    const binding = element[field];
    if (binding != null && (!record(binding) || typeof binding.elementId !== "string" || !coordinate(binding.focus) || !coordinate(binding.gap))) throw new Error("画板箭头关联无效。");
  }
}

export function parseDrawingScene(source: unknown): DrawingScene {
  if (source === "" || source === undefined) return emptyDrawing();
  if (typeof source !== "string" || new TextEncoder().encode(source).length > MAX_DRAWING_BYTES) throw new Error("画板数据过大，最多支持 1 MiB。");
  let value: unknown;
  try { value = JSON.parse(source); } catch { throw new Error("画板数据无法读取，请保留原内容并重试。"); }
  if (!record(value) || value.version !== DRAWING_VERSION || !Array.isArray(value.elements) || value.elements.length > MAX_DRAWING_ELEMENTS || !record(value.appState)) {
    throw new Error("画板格式不受支持，请保留原内容。");
  }
  const ids = new Set<string>();
  for (const element of value.elements) {
    if (!record(element) || typeof element.id !== "string" || !element.id || element.id.length > 200 || ids.has(element.id) || !DRAWING_ELEMENT_TYPES.has(String(element.type))) throw new Error("画板包含不支持的图形或重复标识。");
    for (const field of ["x", "y", "width", "height"]) {
      if (!coordinate(element[field])) throw new Error("画板图形尺寸无效。");
    }
    if (Number(element.width) < 0 || Number(element.height) < 0 || element.isDeleted || element.customData || element.link) throw new Error("画板包含不支持的数据。");
    validateElementData(element);
    ids.add(element.id);
  }
  if (typeof value.appState.viewBackgroundColor !== "string" || !COLOR.test(value.appState.viewBackgroundColor)) throw new Error("画板背景颜色无效。");
  return value as DrawingScene;
}

export function serializeDrawingScene(elements: readonly Record<string, unknown>[], background: string): string {
  const scene: DrawingScene = {
    version: DRAWING_VERSION,
    elements: elements.filter(element => !element.isDeleted).map(element => Object.fromEntries(Object.entries(element).filter(([key]) => !TRANSIENT_ELEMENT_KEYS.has(key))) as DrawingElement),
    appState: { viewBackgroundColor: background },
  };
  const source = JSON.stringify(scene);
  parseDrawingScene(source);
  return source;
}

export function drawingText(source: unknown): string {
  try { return parseDrawingScene(source).elements.filter(element => element.type === "text" && typeof element.text === "string").map(element => element.text).join("\n"); }
  catch { return ""; }
}

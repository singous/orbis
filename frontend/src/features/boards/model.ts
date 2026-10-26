import { newUUID } from "../../shared/ids";
import { z } from "zod";
import catalog from "../../../../api/board-catalog.json";

export const BOARD_SCHEMA_VERSION = 1;
export const MAX_PAGE_ELEMENTS = 10_000;
export const MAX_COMMAND_ELEMENTS = 500;
export const BOARD_CATALOG = catalog;
export type ShapeDefinition = (typeof catalog.shapes)[number];
export const SHAPES = new Map(catalog.shapes.map((shape) => [shape.id, shape]));
export const geometrySchema = z.object({
  x: z.number().finite(),
  y: z.number().finite(),
  width: z.number().positive(),
  height: z.number().positive(),
  rotation_rad: z.number().finite(),
});
export const styleSchema = z.object({
  fill: z.string(),
  stroke: z.string(),
  stroke_width: z.number(),
  font_size: z.number(),
  text_color: z.string(),
  opacity: z.number(),
  dashed: z.boolean(),
  bold: z.boolean(),
  align: z.enum(["left", "center", "right"]),
});
export const pointSchema = z.object({ x: z.number(), y: z.number() });
export const endpointSchema = z.object({
  element_id: z.string().uuid().nullable(),
  port: z.string(),
  x: z.number(),
  y: z.number(),
});
export const memberSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  type: z.string(),
  key: z.enum(["", "primary", "foreign"]),
});
export const structureSchema = z.object({
  parent_id: z.string().uuid().nullable(),
  order: z.number(),
  members: z.array(memberSchema),
  start: endpointSchema.nullable(),
  end: endpointSchema.nullable(),
  points: z.array(pointSchema),
  route: z.enum(["straight", "orthogonal", "curve"]),
  start_marker: z.enum([
    "none",
    "arrow",
    "triangle",
    "diamond",
    "circle",
    "one",
    "many",
  ]),
  end_marker: z.enum([
    "none",
    "arrow",
    "triangle",
    "diamond",
    "circle",
    "one",
    "many",
  ]),
  icon_id: z.string(),
  asset_id: z.string().uuid().nullable(),
  collapsed: z.boolean(),
});
export const versionsSchema = z.object({
  geometry: z.number().int(),
  style: z.number().int(),
  text: z.number().int(),
  structure: z.number().int(),
});
export const elementSchema = z.object({
  id: z.string().uuid(),
  page_id: z.string().uuid(),
  shape_type: z
    .string()
    .refine(
      (value) => value === "connector" || SHAPES.has(value),
      "不支持的图元类型",
    ),
  shape_version: z.literal(1),
  geometry: geometrySchema,
  style: styleSchema,
  text: z.string(),
  structure: structureSchema,
  versions: versionsSchema,
  version: z.number().int(),
});
export const pageSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  background: z.string(),
  position: z.number().int(),
  version: z.number().int(),
});
export const boardSchema = z.object({
  id: z.string().uuid(),
  document_id: z.string().uuid(),
  workspace_id: z.string().uuid(),
  collection_id: z.string().uuid(),
  title: z.string(),
  schema_version: z.literal(1),
  revision: z.number().int(),
  pages: z.array(pageSchema).min(1).max(20),
  created_at_ms: z.number().int(),
  updated_at_ms: z.number().int(),
});
export type Geometry = z.infer<typeof geometrySchema>;
export type Point = z.infer<typeof pointSchema>;
export type Style = z.infer<typeof styleSchema>;
export type Structure = z.infer<typeof structureSchema>;
export type Element = z.infer<typeof elementSchema>;
export type Member = z.infer<typeof memberSchema>;
export type Endpoint = z.infer<typeof endpointSchema>;
export type Versions = z.infer<typeof versionsSchema>;
export type Board = z.infer<typeof boardSchema>;
export type BoardPage = z.infer<typeof pageSchema>;
export type Patch = {
  id: string;
  expected: Versions;
  geometry?: Geometry;
  style?: Style;
  text?: string;
  structure?: Structure;
};
export type Command =
  | { type: "elements.create"; elements: Element[] }
  | { type: "elements.update" | "layout.apply"; patches: Patch[] }
  | {
      type: "elements.delete" | "elements.restore";
      targets: Array<{ id: string; version: number }>;
    }
  | {
      type: "pages.create" | "pages.update" | "pages.delete" | "pages.restore";
      page: BoardPage;
    };
export type Mutation = {
  operation_id: string;
  schema_version: number;
  commands: Command[];
};
/** 空目标命令没有编辑内容，不应进入持久化和网络提交队列。 */
export function commandHasTargets(command: Command): boolean {
  switch (command.type) {
    case "elements.create":
      return command.elements.length > 0;
    case "elements.update":
    case "layout.apply":
      return command.patches.length > 0;
    case "elements.delete":
    case "elements.restore":
      return command.targets.length > 0;
    default:
      return true;
  }
}
export const changeSchema = z.object({
  operation_id: z.string().uuid(),
  revision: z.number().int(),
  elements: z.array(elementSchema),
  deleted: z.array(z.string().uuid()),
  pages: z.array(pageSchema),
  deleted_pages: z.array(z.string().uuid()),
  updated_at_ms: z.number().int(),
});
export type Change = z.infer<typeof changeSchema>;
export const DEFAULT_STYLE: Style = {
  fill: "#ffffff",
  stroke: "#64748b",
  stroke_width: 1.5,
  font_size: 14,
  text_color: "#1e293b",
  opacity: 1,
  dashed: false,
  bold: false,
  align: "center",
};
export function makeElement(
  shapeType: string,
  pageID: string,
  x: number,
  y: number,
): Element {
  const shape = SHAPES.get(shapeType);
  const container = shape?.container ?? false;
  return {
    id: newUUID(),
    page_id: pageID,
    shape_type: shapeType,
    shape_version: 1,
    geometry: {
      x,
      y,
      width: shape?.width ?? 180,
      height: shape?.height ?? 80,
      rotation_rad: 0,
    },
    style: {
      ...DEFAULT_STYLE,
      fill: container
        ? "#f8fafc"
        : shapeType === "basic.note"
          ? "#fef3c7"
          : "#ffffff",
      dashed: container,
    },
    text: shapeType === "connector" ? "" : (shape?.name ?? ""),
    structure: {
      parent_id: null,
      order: 0,
      members: [],
      start: null,
      end: null,
      points: [],
      route: "orthogonal",
      start_marker: "none",
      end_marker: "arrow",
      icon_id: "",
      asset_id: null,
      collapsed: false,
    },
    versions: { geometry: 0, style: 0, text: 0, structure: 0 },
    version: 0,
  };
}
export function elementPatch(
  element: Element,
  change: Omit<Patch, "id" | "expected">,
): Patch {
  return { id: element.id, expected: { ...element.versions }, ...change };
}
export function applyChange(
  elements: Map<string, Element>,
  change: Change,
): Map<string, Element> {
  const next = new Map(elements);
  for (const id of change.deleted) next.delete(id);
  for (const element of change.elements) next.set(element.id, element);
  return next;
}

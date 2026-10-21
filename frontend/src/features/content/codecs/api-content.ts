import { z } from "zod";
import type { OrbisBlock, OrbisInline, OrbisInlineStyle, OrbisTableCell, OrbisTableContent } from "../model/blocks";

const runSchema = z.object({ text: z.string(), marks: z.array(z.enum(["bold", "italic", "underline", "strike", "code"])), href: z.string().nullable(), text_color: z.string().nullable().optional(), background_color: z.string().nullable().optional() }).strict();
const cellSchema = z.object({ content: z.array(runSchema), row_span: z.number().int(), column_span: z.number().int(), alignment: z.string(), text_color: z.string().nullable(), background_color: z.string().nullable() }).strict();
const gridSchema = z.object({ rows: z.array(z.array(cellSchema)), column_widths: z.array(z.number().int().nullable()), header_rows: z.number().int(), header_columns: z.number().int() }).strict();
export const nativePayloadSchema = z.object({ type: z.string(), props: z.record(z.unknown()), content: z.array(runSchema), table: gridSchema.optional() }).strict();
export type NativeRun = z.infer<typeof runSchema>;
export type NativePayload = z.infer<typeof nativePayloadSchema>;
export type NativeBlock = NativePayload & { id: string; children: NativeBlock[] };
export const nativeBlockSchema: z.ZodType<NativeBlock> = nativePayloadSchema.extend({ id: z.string().uuid(), children: z.lazy(() => z.array(nativeBlockSchema)) });
const BLOCK_TYPES: Record<string, string> = {
  paragraph: "paragraph", heading: "heading", quote: "quote", bullet_list_item: "bulletListItem", numbered_list_item: "numberedListItem", check_list_item: "checkListItem", toggle_list_item: "toggleListItem", code_block: "codeBlock", table: "table", divider: "divider", group: "group", image: "image", audio: "audio", video: "video", file: "file", drawing: "drawing", data_table: "dataTable", callout: "callout", card: "card", card_group: "cardGroup", steps: "steps", step: "step", tabs: "tabs", tab: "tab", code_group: "codeGroup",
};
const NATIVE_TYPES = Object.fromEntries(Object.entries(BLOCK_TYPES).map(([key, value]) => [value, key]));
const PROP_NAMES: Record<string, string> = { text_alignment: "textAlignment", text_color: "textColor", background_color: "backgroundColor", show_preview: "showPreview", width: "previewWidth", height: "previewHeight" };
const NATIVE_PROP_NAMES = Object.fromEntries(Object.entries(PROP_NAMES).map(([key, value]) => [value, key]));
const MEDIA_TYPES = new Set(["image", "audio", "video", "file", "drawing"]);
const STYLED_TYPES = new Set(["paragraph", "heading", "quote", "bulletListItem", "numberedListItem", "checkListItem", "toggleListItem", "codeBlock", "table"]);
function editorLink(value: string) { return value.startsWith("asset:") ? "orbis-file:" + value.slice(6) : value; }
function nativeLink(value: string) { return value.startsWith("orbis-file:") ? "asset:" + value.slice(11) : value; }
export function editorRuns(runs: NativeRun[]): OrbisInline[] {
  return runs.map(run => {
    const styles: OrbisInlineStyle = Object.fromEntries(run.marks.map(mark => [mark, true]));
    if (run.text_color != null) styles.textColor = run.text_color;
    if (run.background_color != null) styles.backgroundColor = run.background_color;
    const value: OrbisInline = { type: "text", text: run.text, ...(Object.keys(styles).length ? { styles } : {}) };
    return run.href === null ? value : { type: "link", href: editorLink(run.href), content: [value] };
  });
}
export function nativeRuns(content: OrbisInline[] | string): NativeRun[] {
  if (typeof content === "string") return content ? [{ text: content, marks: [], href: null }] : [];
  const result: NativeRun[] = [];
  const visit = (nodes: OrbisInline[], href: string | null) => {
    for (const node of nodes) {
      if (node.type === "link") {
        const parts: OrbisInline[] = typeof node.content === "string" ? [{ type: "text", text: node.content }] : node.content;
        visit(parts, nativeLink(node.href));
      } else {
        const styles = node.styles ?? {};
        const unknown = Object.keys(styles).filter(key => !["bold", "italic", "underline", "strike", "code", "textColor", "backgroundColor"].includes(key));
        if (unknown.length) throw new Error("文本包含当前内容契约不支持的样式，请保留草稿。");
        const run: NativeRun = { text: node.text, marks: ["bold", "italic", "underline", "strike", "code"].filter(mark => styles[mark as keyof OrbisInlineStyle] === true) as NativeRun["marks"], href };
        if (styles.textColor !== undefined) run.text_color = styles.textColor;
        if (styles.backgroundColor !== undefined) run.background_color = styles.backgroundColor;
        result.push(run);
      }
    }
  };
  visit(content, null);
  return result;
}
function editorSource(value: unknown): string {
  if (value === null || value === undefined) return "";
  const source = value as { type: string; asset_id?: string; url?: string };
  if (source.type === "asset" && typeof source.asset_id === "string") return "orbis-file:" + source.asset_id;
  if (source.type === "external" && typeof source.url === "string") return source.url;
  throw new Error("媒体来源不受支持，请保留原内容。");
}
function nativeSource(value: unknown) {
  if (value === "" || value === null || value === undefined) return null;
  if (typeof value !== "string") throw new Error("媒体来源格式不正确。");
  const link = nativeLink(value);
  if (link.startsWith("asset:")) return { type: "asset", asset_id: link.slice(6) };
  return { type: "external", url: link };
}
export function editorPayload(id: string, payload: NativePayload): OrbisBlock {
  const type = BLOCK_TYPES[payload.type];
  if (!type) throw new Error("服务返回了不受支持的内容类型，请保留原内容。");
  const props: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(payload.props)) {
    if (key === "source" && MEDIA_TYPES.has(type)) props.url = editorSource(value);
    else if (type === "dataTable" && key === "table_version") props.table_revision = value ?? 0;
    else props[PROP_NAMES[key] ?? key] = type === "dataTable" && key === "table_id" ? value ?? "" : key === "href" && typeof value === "string" ? editorLink(value) : value;
  }
  let content: OrbisBlock["content"] = editorRuns(payload.content);
  if (payload.table) content = { type: "tableContent", columnWidths: payload.table.column_widths, headerRows: payload.table.header_rows, headerCols: payload.table.header_columns,
    rows: payload.table.rows.map(row => ({ cells: row.map(cell => ({ type: "tableCell", props: { colspan: cell.column_span, rowspan: cell.row_span, textAlignment: cell.alignment, textColor: cell.text_color, backgroundColor: cell.background_color }, content: editorRuns(cell.content) })) })) };
  return { id, type, props, content, children: [] };
}
export function editorBlock(value: NativeBlock): OrbisBlock {
  return { ...editorPayload(value.id, value), children: value.children.map(editorBlock) };
}
function nativeCell(cell: OrbisTableCell): z.infer<typeof cellSchema> {
  const object = typeof cell !== "string" && !Array.isArray(cell) ? cell : null;
  const props = object?.props ?? {};
  return { content: nativeRuns(object?.content ?? (object ? [] : cell as OrbisInline[] | string)), row_span: Number(props.rowspan ?? 1), column_span: Number(props.colspan ?? 1), alignment: String(props.textAlignment ?? "left"), text_color: typeof props.textColor === "string" ? props.textColor : null, background_color: typeof props.backgroundColor === "string" ? props.backgroundColor : null };
}
export function nativePayload(block: Omit<OrbisBlock, "children">): NativePayload {
  const type = NATIVE_TYPES[block.type];
  if (!type) throw new Error("内容类型不受支持，请保留草稿。");
  const props: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(block.props)) {
    if (key === "isToggleable" && value === false) continue;
    if (!STYLED_TYPES.has(block.type) && ((key === "textAlignment" && value === "left") || (["textColor", "backgroundColor"].includes(key) && value === "default"))) continue;
    if (MEDIA_TYPES.has(block.type) && key === "url") props.source = nativeSource(value);
    else if (MEDIA_TYPES.has(block.type) && ["previewWidth", "previewHeight"].includes(key) && value === 0) continue;
    else if (block.type === "dataTable") {
      if (key === "table_id") props.table_id = value || null;
      else if (key === "table_revision") props.table_version = value || null;
      else if (!["title", "default_view_id", "field_names"].includes(key)) throw new Error("表格引用包含不支持的字段。");
    } else props[NATIVE_PROP_NAMES[key] ?? key] = key === "href" && typeof value === "string" ? nativeLink(value) : value;
  }
  if (MEDIA_TYPES.has(block.type) && !("source" in props)) props.source = null;
  if (block.type === "dataTable") { props.table_id ??= null; props.table_version ??= null; }
  const result: NativePayload = { type, props, content: [] };
  if (type === "table") {
    if (typeof block.content === "string" || Array.isArray(block.content)) throw new Error("普通表格格式不正确，请保留原内容。");
    const grid: OrbisTableContent = block.content;
    result.table = { rows: grid.rows.map(row => row.cells.map(nativeCell)), column_widths: grid.columnWidths ?? [], header_rows: grid.headerRows ?? 0, header_columns: grid.headerCols ?? 0 };
  } else {
    if (typeof block.content !== "string" && !Array.isArray(block.content)) throw new Error("文本内容格式不正确。");
    result.content = nativeRuns(block.content);
  }
  return result;
}
export function nativeBlock(block: OrbisBlock): NativeBlock {
  return { ...nativePayload(block), id: block.id, children: block.children.map(nativeBlock) };
}

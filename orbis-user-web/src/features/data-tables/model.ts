export type FieldKind =
  | "text"
  | "number"
  | "select"
  | "multi_select"
  | "datetime"
  | "checkbox"
  | "url";
export type CellValue = string | number | boolean | string[] | null;
export type TableField = {
  id: string;
  name: string;
  kind: FieldKind;
  options: { id: string; label: string; color: string }[];
};
export type TableFilter = {
  field_id: string;
  operator:
    | "eq"
    | "ne"
    | "contains"
    | "empty"
    | "not_empty"
    | "gt"
    | "gte"
    | "lt"
    | "lte";
  value: CellValue;
};
export type TableView = {
  id: string;
  name: string;
  kind: "grid" | "kanban";
  field_ids: string[];
  widths: Record<string, number>;
  filters: TableFilter[];
  sorts: { field_id: string; descending: boolean }[];
  group_field_id: string | null;
};
export type TableDefinition = {
  title: string;
  fields: TableField[];
  views: TableView[];
  public_view_id: string;
  public_field_ids: string[];
};
export type TableRecord = { id: string; values: Record<string, CellValue> };
export type TablePage = {
  table_id: string;
  revision: number;
  content_version: number;
  definition: TableDefinition;
  view_id: string;
  records: TableRecord[];
  total: number;
  offset: number;
  next_offset: number;
  has_more: boolean;
  groups: { id: string | null; name: string; count: number }[];
};
export type TableChanges = {
  definition?: TableDefinition;
  upserts?: TableRecord[];
  deletes?: string[];
};
export type TableMutation = TableChanges & {
  operation_id: string;
  expected_document_version: number;
  expected_table_revision: number;
};
export type TableSnapshot = {
  title: string;
  view: string;
  revision: number;
  columns: string[];
  rows: string[][];
  total?: number;
  offset?: number;
  snapshot_id?: string;
  records_url?: string;
};
export const FIELD_LABELS: Record<FieldKind, string> = {
  text: "文本",
  number: "数字",
  select: "单选",
  multi_select: "多选",
  datetime: "日期时间",
  checkbox: "复选框",
  url: "链接",
};
export const TABLE_PAGE_SIZE = 100;
export const TABLE_ROW_HEIGHT = 40;
export const TABLE_COLUMN_WIDTH = 190;

/** UUIDv7 works on trusted LAN HTTP, where randomUUID may be unavailable. */
export function tableId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  let time = Date.now();
  for (let index = 5; index >= 0; index--) {
    bytes[index] = time % 256;
    time = Math.floor(time / 256);
  }
  bytes[6] = (bytes[6] & 15) | 112;
  bytes[8] = (bytes[8] & 63) | 128;
  const text = Array.from(bytes, (value) =>
    value.toString(16).padStart(2, "0"),
  ).join("");
  return `${text.slice(0, 8)}-${text.slice(8, 12)}-${text.slice(12, 16)}-${text.slice(16, 20)}-${text.slice(20)}`;
}

export function cellText(
  field: TableField,
  value: CellValue | undefined,
): string {
  if (value == null) return "";
  if (field.kind === "select")
    return field.options.find((option) => option.id === value)?.label ?? "";
  if (field.kind === "multi_select")
    return (value as string[])
      .map(
        (id) => field.options.find((option) => option.id === id)?.label ?? "",
      )
      .join("、");
  if (field.kind === "checkbox") return value ? "✓" : "";
  if (field.kind === "datetime")
    return new Intl.DateTimeFormat("zh-CN", {
      timeZone: "Asia/Shanghai",
      dateStyle: "short",
      timeStyle: "short",
    }).format(Number(value));
  return String(value);
}

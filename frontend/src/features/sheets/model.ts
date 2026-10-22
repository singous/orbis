import { z } from "zod";
import { newUUID } from "../../shared/ids";

export const kindSchema = z.enum([
  "text",
  "number",
  "select",
  "multi_select",
  "datetime",
  "person",
  "image",
  "attachment",
  "checkbox",
  "url",
  "email",
  "phone",
  "rating",
  "progress",
  "created_by",
  "created_at",
  "updated_by",
  "updated_at",
]);
export type Kind = z.infer<typeof kindSchema>;
export const KINDS: Record<
  Kind,
  {
    label: string;
    icon: string;
    system?: boolean;
    multiple?: boolean;
    numeric?: boolean;
  }
> = {
  text: { label: "文本", icon: "text" },
  number: { label: "数字", icon: "hash", numeric: true },
  select: { label: "单选", icon: "circle-check" },
  multi_select: { label: "多选", icon: "list-checks", multiple: true },
  datetime: { label: "日期", icon: "calendar", numeric: true },
  person: { label: "人员", icon: "user", multiple: true },
  image: { label: "图片", icon: "image", multiple: true },
  attachment: { label: "附件", icon: "paperclip", multiple: true },
  checkbox: { label: "复选框", icon: "square-check" },
  url: { label: "链接", icon: "link" },
  email: { label: "邮箱", icon: "mail" },
  phone: { label: "手机号码", icon: "phone" },
  rating: { label: "评分", icon: "star", numeric: true },
  progress: { label: "进度", icon: "chart-no-axes-column", numeric: true },
  created_by: { label: "创建人", icon: "user-plus", system: true },
  created_at: {
    label: "创建时间",
    icon: "calendar-plus",
    system: true,
    numeric: true,
  },
  updated_by: { label: "修改人", icon: "user-pen", system: true },
  updated_at: {
    label: "修改时间",
    icon: "calendar-clock",
    system: true,
    numeric: true,
  },
};
export type Value = string | number | boolean | string[] | null;
export const valueSchema = z.union([
  z.string(),
  z.number(),
  z.boolean(),
  z.array(z.string()),
  z.null(),
]);
export const fieldSchema = z.object({
  id: z.string(),
  name: z.string(),
  kind: kindSchema,
  options: z
    .array(z.object({ id: z.string(), label: z.string(), color: z.string() }))
    .nullable()
    .transform((v) => v ?? []),
  default: valueSchema,
  date_format: z.string().optional(),
  include_time: z.boolean().optional(),
});
export type Field = z.infer<typeof fieldSchema>;
export const viewSchema = z.object({
  text_colors: z.record(z.string()).default({}),
  highlight_duplicates: z.array(z.string()).default([]),
  id: z.string(),
  name: z.string(),
  kind: z.enum(["grid", "kanban"]),
  field_ids: z.array(z.string()),
  widths: z.record(z.number()),
  filters: z.array(
    z.object({
      field_id: z.string(),
      operator: z.string(),
      value: valueSchema,
    }),
  ),
  sorts: z.array(z.object({ field_id: z.string(), descending: z.boolean() })),
  group_field_id: z.string(),
  row_height: z.number(),
});
export type View = z.infer<typeof viewSchema>;
export const sheetSchema = z.object({
  document_id: z.string().uuid(),
  data_revision: z.number(),
  schema_version: z.number(),
  id: z.string(),
  workspace_id: z.string(),
  collection_id: z.string(),
  title: z.string(),
  definition: z.object({
    fields: z.array(fieldSchema),
    views: z.array(viewSchema),
  }),
  version: z.number(),
  created_at_ms: z.number(),
  updated_at_ms: z.number(),
});
export type Sheet = z.infer<typeof sheetSchema>;
export const recordSchema = z.object({
  id: z.string(),
  version: z.number(),
  position: z.number(),
  values: z.record(valueSchema),
  created_at_ms: z.number(),
  updated_at_ms: z.number(),
  created_by: z.string().nullable(),
  updated_by: z.string().nullable(),
});
export type Row = z.infer<typeof recordSchema>;
export type Patch = {
  id: string;
  version: number;
  values?: Record<string, Value>;
  delete?: boolean;
};
export type Changes = {
  operation_id: string;
  schema_version: number;
  records: Patch[];
};
export const formConfigSchema = z.object({
  title: z.string(),
  description: z.string(),
  fields: z.array(
    z.object({
      field_id: z.string(),
      required: z.boolean(),
      description: z.string(),
    }),
  ),
});
export const formSchema = z.object({
  id: z.string(),
  sheet_id: z.string(),
  version: z.number(),
  enabled: z.boolean(),
  config: formConfigSchema,
  token: z.string().optional(),
});
export type Form = z.infer<typeof formSchema>;
export const PAGE_SIZE = 100;
export const MAX_BATCH = 200;
export const COLORS = ["green", "amber", "blue", "purple", "pink", "gray"];
export function newField(kind: Kind = "text"): Field {
  return {
    id: newUUID(),
    name: KINDS[kind].label,
    kind,
    default: null,
    options:
      kind === "select" || kind === "multi_select"
        ? ["待开始", "进行中", "已完成"].map((label, i) => ({
            id: newUUID(),
            label,
            color: COLORS[i],
          }))
        : [],
  };
}
export function newView(sheet: Sheet, kind: View["kind"]): View {
  return {
    text_colors: {},
    highlight_duplicates: [],
    id: newUUID(),
    name: kind === "grid" ? "表格视图" : "看板视图",
    kind,
    field_ids: sheet.definition.fields.map((f) => f.id),
    widths: {},
    filters: [],
    sorts: [],
    group_field_id:
      kind === "kanban"
        ? (sheet.definition.fields.find((f) => f.kind === "select")?.id ?? "")
        : "",
    row_height: 40,
  };
}
export function cellText(field: Field, value: Value | undefined): string {
  if (value == null) return "";
  if (field.kind === "select")
    return field.options.find((o) => o.id === value)?.label ?? "";
  if (field.kind === "multi_select")
    return (value as string[])
      .map((id) => field.options.find((o) => o.id === id)?.label ?? "")
      .join("、");
  if (field.kind === "checkbox") return value ? "是" : "否";
  if (["datetime", "created_at", "updated_at"].includes(field.kind)) {
    const date = new Date(Number(value) + 8 * 3600000).toISOString();
    return (
      date
        .slice(0, 10)
        .replaceAll("-", field.date_format === "YYYY/MM/DD" ? "/" : "-") +
      (field.include_time || field.kind !== "datetime"
        ? " " + date.slice(11, 16)
        : "")
    );
  }
  return Array.isArray(value) ? value.join("、") : String(value);
}
export function parseCell(field: Field, text: string): Value {
  if (!text) return null;
  if (KINDS[field.kind].system) throw new Error("系统字段不可编辑");
  if (field.kind === "select") {
    const option = field.options.find((o) => o.label === text);
    if (!option) throw new Error(`${field.name}中没有“${text}”选项`);
    return option.id;
  }
  if (field.kind === "multi_select")
    return text.split(/[、,]/).map((label) => {
      const option = field.options.find((o) => o.label === label.trim());
      if (!option) throw new Error(`${field.name}中没有“${label}”选项`);
      return option.id;
    });
  if (field.kind === "checkbox") return ["是", "true", "1"].includes(text);
  if (field.kind === "datetime") {
    const normalized = /^\d{4}-\d{2}-\d{2}$/.test(text)
      ? `${text}T00:00:00+08:00`
      : /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(:\d{2})?$/.test(text)
        ? text.replace(" ", "T") + "+08:00"
        : text;
    const n = Date.parse(normalized);
    if (!Number.isFinite(n)) throw new Error("日期格式无效");
    return n;
  }
  if (KINDS[field.kind].numeric) {
    const n = Number(text);
    if (!Number.isFinite(n)) throw new Error("请输入有效数字");
    return n;
  }
  if (KINDS[field.kind].multiple) throw new Error("请使用人员或附件选择器");
  return text;
}

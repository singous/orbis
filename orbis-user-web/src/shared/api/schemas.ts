import { z } from "zod";

export const userSchema = z.object({
  id: z.string().uuid(),
  tenant_id: z.string().uuid().nullable(),
  email: z.string().email(),
  display_name: z.string().nullable().optional(),
  current_workspace_id: z.string().uuid().nullable(),
  status: z.string(),
  created_at_ms: z.number(),
  updated_at_ms: z.number(),
});

export type User = z.infer<typeof userSchema>;

export const workspaceSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  workspace_type: z.string(),
  role: z.enum(["owner", "admin", "editor", "normal"]),
  is_current: z.boolean(),
  created_at_ms: z.number(),
  updated_at_ms: z.number(),
});

export type Workspace = z.infer<typeof workspaceSchema>;

export const paginationSchema = z.object({
  page: z.number().int().min(1),
  page_size: z.number().int().min(1).max(100),
  total: z.number().int().min(0),
  total_pages: z.number().int().min(0),
  has_next: z.boolean(),
  has_previous: z.boolean(),
});

export function pageDataSchema<T extends z.ZodTypeAny>(itemSchema: T) {
  return z.object({
    items: z.array(itemSchema),
    pagination: paginationSchema,
  });
}

export type Pagination = z.infer<typeof paginationSchema>;
export type PageData<T> = { items: T[]; pagination: Pagination };

export const authResponseSchema = z.object({
  access_token: z.string(),
  refresh_token: z.string(),
  token_type: z.string().default("bearer"),
  user: userSchema,
  workspace: workspaceSchema.nullable(),
});

export type AuthResponse = z.infer<typeof authResponseSchema>;

export const noteBlocksV1Schema = z.object({
  schema_version: z.literal(1),
  editor: z.literal("tiptap"),
  doc: z.record(z.unknown()),
});

export const noteBlocksV2Schema = z.object({
  schema_version: z.literal(2),
  editor: z.literal("blocknote"),
  blocks: z.array(z.record(z.unknown())),
});

export const noteBlocksSchema = z.union([noteBlocksV1Schema, noteBlocksV2Schema]);

export type NoteBlocksV1 = z.infer<typeof noteBlocksV1Schema>;
export type NoteBlocksV2Stored = z.infer<typeof noteBlocksV2Schema>;

const resourceIdentitySchema = z.object({
  id: z.string().uuid(),
  tenant_id: z.string().uuid().nullable(),
  workspace_id: z.string().uuid(),
  owner_id: z.string().uuid(),
  status: z.string(),
  created_at_ms: z.number(),
  updated_at_ms: z.number(),
});

export const documentGroupSchema = resourceIdentitySchema.extend({
  name: z.string(),
  is_default: z.boolean(),
  sort_order: z.number(),
});

export const documentGroupListResponseSchema = pageDataSchema(documentGroupSchema);

export const notebookIconNameSchema = z.enum([
  "book", "notebook", "folder", "file-text", "lightbulb", "code", "palette", "rocket",
  "flask", "globe", "graduation-cap", "heart", "briefcase", "target", "coffee", "music",
]);

export const notebookIconColorSchema = z.enum(["blue", "mint", "violet", "amber", "rose", "cyan", "slate"]);

export const notebookIconSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("preset"), name: notebookIconNameSchema, color: notebookIconColorSchema }),
  z.object({ type: z.literal("image"), file_id: z.string().uuid() }),
]);

export type NotebookIconValue = z.infer<typeof notebookIconSchema>;
export type NotebookIconName = z.infer<typeof notebookIconNameSchema>;
export type NotebookIconColor = z.infer<typeof notebookIconColorSchema>;

export const notebookSchema = resourceIdentitySchema.extend({
  group_id: z.string().uuid(),
  title: z.string(),
  sort_order: z.number(),
  icon: notebookIconSchema.nullable().optional(),
});

export const notebookListResponseSchema = pageDataSchema(notebookSchema);

export const noteSchema = resourceIdentitySchema.extend({
  notebook_id: z.string().uuid(),
  parent_id: z.string().uuid().nullable(),
  sort_order: z.number(),
  title: z.string(),
  note_type: z.string(),
});

export const noteContentSchema = z.object({
  note_id: z.string().uuid(),
  blocks: noteBlocksSchema,
  plain_text: z.string(),
  content_version: z.number(),
  created_at_ms: z.number(),
  updated_at_ms: z.number(),
});

export const noteSearchItemSchema = noteSchema.extend({ plain_text: z.string() });

const noteTreeBaseSchema = noteSchema.omit({ note_type: true });

export type NoteTreeItem = z.infer<typeof noteTreeBaseSchema> & { children: NoteTreeItem[] };

export const noteTreeItemSchema: z.ZodType<NoteTreeItem> = noteTreeBaseSchema.extend({
  children: z.lazy(() => z.array(noteTreeItemSchema)),
});

export const noteSearchResponseSchema = pageDataSchema(noteSearchItemSchema);
export const noteTreeResponseSchema = z.object({ items: z.array(noteTreeItemSchema) });
export const markdownExportSchema = z.object({ filename: z.string(), markdown: z.string() });

export type NoteBlocks = z.infer<typeof noteBlocksSchema>;
export type Note = z.infer<typeof noteSchema>;
export type NoteContent = z.infer<typeof noteContentSchema>;
export type NoteSearchItem = z.infer<typeof noteSearchItemSchema>;
export type DocumentGroup = z.infer<typeof documentGroupSchema>;
export type Notebook = z.infer<typeof notebookSchema>;
export type MarkdownExport = z.infer<typeof markdownExportSchema>;

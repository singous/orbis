import { z } from "zod";

export const userSchema = z.object({
  id: z.string().uuid(), email: z.string().email(),
  display_name: z.string().nullable(), bio: z.string().nullable(),
  avatar_asset_id: z.string().uuid().nullable(), preferred_workspace_id: z.string().uuid().nullable(),
  profile_version: z.number().int().positive(), created_at_ms: z.number().int(), updated_at_ms: z.number().int(),
});
export type User = z.infer<typeof userSchema>;
export const workspaceSchema = z.object({
  id: z.string().uuid(), name: z.string(), role: z.enum(["owner", "admin", "editor", "viewer"]),
  created_at_ms: z.number().int(), updated_at_ms: z.number().int(),
});
export type Workspace = z.infer<typeof workspaceSchema>;
export const paginationSchema = z.object({
  page: z.number().int().min(1), page_size: z.number().int().min(1).max(100), total: z.number().int().min(0),
}).transform(page => ({ ...page, total_pages: Math.ceil(page.total / page.page_size),
  has_next: page.page * page.page_size < page.total, has_previous: page.page > 1 }));
export function pageDataSchema<T extends z.ZodTypeAny>(itemSchema: T) {
  return z.object({ items: z.array(itemSchema), pagination: paginationSchema });
}
export type Pagination = z.infer<typeof paginationSchema>;
export type PageData<T> = { items: T[]; pagination: Pagination };
export const authTokensSchema = z.object({
  access_token: z.string(), refresh_token: z.string(), token_type: z.string(), expires_at_ms: z.number().int(), user: userSchema,
});
export const authResponseSchema = authTokensSchema.extend({ workspace: workspaceSchema.nullable() });
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
  id: z.string().uuid(), workspace_id: z.string().uuid(),
  is_archived: z.boolean(), archived_at_ms: z.number().int().nullable(),
  created_at_ms: z.number().int(), updated_at_ms: z.number().int(),
});
export const documentGroupSchema = resourceIdentitySchema.extend({
  name: z.string(), is_default: z.boolean(), sort_order: z.number().int(), version: z.number().int().positive(),
});
export const documentGroupListResponseSchema = pageDataSchema(documentGroupSchema);
export const notebookIconNameSchema = z.enum([
  "book", "notebook", "folder", "file-text", "lightbulb", "code", "palette", "rocket",
  "flask", "globe", "graduation-cap", "heart", "briefcase", "target", "coffee", "music",
]);

export const notebookIconColorSchema = z.enum(["blue", "mint", "violet", "amber", "rose", "cyan", "slate"]);

export const notebookIconSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("preset"), name: notebookIconNameSchema, color: notebookIconColorSchema }),
  z.object({ type: z.literal("image"), asset_id: z.string().uuid() }),
]);

export type NotebookIconValue = z.infer<typeof notebookIconSchema>;
export type NotebookIconName = z.infer<typeof notebookIconNameSchema>;
export type NotebookIconColor = z.infer<typeof notebookIconColorSchema>;


export const notebookSchema = resourceIdentitySchema.extend({
  group_id: z.string().uuid(), title: z.string(), sort_order: z.number().int(),
  icon: notebookIconSchema.nullable(), metadata_version: z.number().int().positive(), directory_version: z.number().int().positive(),
});
export const notebookListResponseSchema = pageDataSchema(notebookSchema);
export const nativeNoteSchema = resourceIdentitySchema.extend({
  collection_id: z.string().uuid(), parent_id: z.string().uuid().nullable(), position: z.number().int().nonnegative(),
  title: z.string(), content_version: z.number().int().positive(),
  collaboration_available: z.boolean().optional(),
  sheet_id: z.string().uuid().nullable().optional(),
});
// The existing UI vocabulary is a local view model; wire fields remain native.
export const noteSchema = nativeNoteSchema.transform(value => ({ ...value, notebook_id: value.collection_id, sort_order: value.position }));

export const noteContentSchema = z.object({
  kind:z.literal("complete"),
  note_id: z.string().uuid(), blocks: noteBlocksSchema, content_version: z.number().int().positive(), title: z.string().nullable(),
});
export const noteContentPageSchema = noteContentSchema.extend({
  kind:z.literal("children"),
  next_cursor: z.string().nullable(), has_more: z.boolean(), read_position: z.number().int().nonnegative(),
});
export type NoteContentPage = z.infer<typeof noteContentPageSchema>;
export const blockLoadDescriptorSchema = z.object({
  id: z.string().uuid(), parent_id: z.string().uuid().nullable(), child_count: z.number().int().nonnegative(),
  has_children: z.boolean(), children_loaded: z.boolean(), payload_loaded: z.boolean(), payload_bytes: z.number().int().nonnegative(),
});
export const noteChildrenPageSchema = noteContentPageSchema.extend({ parent_id: z.string().uuid().nullable(), descriptors: z.array(blockLoadDescriptorSchema) });
export type NoteChildrenPage = z.infer<typeof noteChildrenPageSchema>;
export const noteBlockReadSchema = z.object({
  note_id:z.string().uuid(),content_version:z.number().int().positive(),block:z.record(z.unknown()),descriptor:blockLoadDescriptorSchema,
});

export const noteSearchItemSchema = nativeNoteSchema.extend({ plain_text: z.string() }).transform(value => ({ ...value, notebook_id: value.collection_id, sort_order: value.position }));
export type NoteTreeItem = z.infer<typeof noteSchema> & { children: NoteTreeItem[] };
export const noteTreeItemSchema: z.ZodType<NoteTreeItem, z.ZodTypeDef, unknown> = z.lazy(() => nativeNoteSchema.extend({ children: z.array(noteTreeItemSchema) }).transform(value => ({ ...value, notebook_id: value.collection_id, sort_order: value.position })));

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

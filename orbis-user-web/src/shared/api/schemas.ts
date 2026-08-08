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

export const authResponseSchema = z.object({
  access_token: z.string(),
  refresh_token: z.string(),
  token_type: z.string().default("bearer"),
  user: userSchema,
  workspace: workspaceSchema.nullable(),
});

export type AuthResponse = z.infer<typeof authResponseSchema>;

export const noteBlocksSchema = z.object({
  schema_version: z.literal(1),
  editor: z.literal("tiptap"),
  doc: z.record(z.unknown()),
});

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

export const documentGroupListResponseSchema = z.object({ items: z.array(documentGroupSchema) });

export const notebookSchema = resourceIdentitySchema.extend({
  group_id: z.string().uuid(),
  title: z.string(),
  sort_order: z.number(),
});

export const notebookListResponseSchema = z.object({ items: z.array(notebookSchema) });

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

export const noteSearchResponseSchema = z.object({ items: z.array(noteSearchItemSchema) });
export const noteTreeResponseSchema = z.object({ items: z.array(noteTreeItemSchema) });
export const markdownExportSchema = z.object({ filename: z.string(), markdown: z.string() });

export type NoteBlocks = z.infer<typeof noteBlocksSchema>;
export type Note = z.infer<typeof noteSchema>;
export type NoteContent = z.infer<typeof noteContentSchema>;
export type NoteSearchItem = z.infer<typeof noteSearchItemSchema>;
export type DocumentGroup = z.infer<typeof documentGroupSchema>;
export type Notebook = z.infer<typeof notebookSchema>;
export type MarkdownExport = z.infer<typeof markdownExportSchema>;

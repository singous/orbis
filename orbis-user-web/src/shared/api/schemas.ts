import { z } from "zod";

export const userSchema = z.object({
  id: z.string().uuid(),
  email: z.string().email(),
  display_name: z.string().nullable().optional(),
  status: z.string().optional(),
  created_at_ms: z.number(),
  updated_at_ms: z.number(),
});

export type User = z.infer<typeof userSchema>;

export const authResponseSchema = z.object({
  access_token: z.string(),
  refresh_token: z.string(),
  token_type: z.string().default("bearer"),
  user: userSchema,
});

export type AuthResponse = z.infer<typeof authResponseSchema>;

export const noteBlocksSchema = z.object({
  schema_version: z.literal(1),
  editor: z.literal("tiptap"),
  doc: z.record(z.unknown()),
});

export const noteSchema = z.object({
  id: z.string().uuid(),
  workspace_id: z.string().uuid(),
  owner_id: z.string().uuid(),
  title: z.string(),
  note_type: z.string(),
  blocks: noteBlocksSchema,
  plain_text: z.string(),
  content_version: z.number(),
  status: z.string(),
  created_at_ms: z.number(),
  updated_at_ms: z.number(),
});

export const noteListItemSchema = noteSchema.omit({ blocks: true });

export const noteListResponseSchema = z.object({
  items: z.array(noteListItemSchema),
});

export type NoteBlocks = z.infer<typeof noteBlocksSchema>;
export type Note = z.infer<typeof noteSchema>;
export type NoteListItem = z.infer<typeof noteListItemSchema>;

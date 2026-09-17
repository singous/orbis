import { z } from "zod";
import { noteBlocksSchema, pageDataSchema } from "../../shared/api/schemas";

export const commentSchema = z.object({
  id: z.string().uuid(), note_id: z.string().uuid(), parent_id: z.string().uuid().nullable(),
  author_id: z.string().uuid(), author_name: z.string(), body: z.string(), is_resolved: z.boolean(),
  created_at_ms: z.number().int(), updated_at_ms: z.number().int(),
});
export const revisionSummarySchema = z.object({
  id: z.string().uuid(), content_version: z.number().int().min(1), author_name: z.string(), created_at_ms: z.number().int(),
});
export const revisionSchema = revisionSummarySchema.extend({ blocks: noteBlocksSchema, plain_text: z.string() });
export const commentPageSchema = pageDataSchema(commentSchema);
export const revisionPageSchema = pageDataSchema(revisionSummarySchema);
export type DocumentComment = z.infer<typeof commentSchema>;

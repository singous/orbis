import { z } from "zod";
import { noteBlocksSchema,pageDataSchema } from "../../shared/api/schemas";
export const commentSchema=z.object({
  id:z.string().uuid(),workspace_id:z.string().uuid(),document_id:z.string().uuid(),parent_id:z.string().uuid().nullable(),
  author_id:z.string().uuid(),author_name:z.string(),body:z.string(),is_resolved:z.boolean(),resolved_at_ms:z.number().int().nullable(),version:z.number().int().positive(),
  created_at_ms:z.number().int(),updated_at_ms:z.number().int(),
}).transform(comment=>({...comment,note_id:comment.document_id}));
export const revisionWireSchema=z.object({
  document_id:z.string().uuid(),version:z.number().int().positive(),title:z.string(),title_recorded:z.boolean(),
  author_id:z.string().uuid().nullable(),author_name:z.string(),restored_from_version:z.number().int().positive().nullable(),created_at_ms:z.number().int(),
});
const revisionView=(value:z.infer<typeof revisionWireSchema>)=>({...value,id:String(value.version),content_version:value.version});
export const revisionSummarySchema=revisionWireSchema.transform(revisionView);
export const revisionSchema=revisionWireSchema.extend({blocks:noteBlocksSchema}).transform(value=>({...revisionView(value),blocks:value.blocks}));
export const commentPageSchema=pageDataSchema(commentSchema);
export const revisionPageSchema=pageDataSchema(revisionSummarySchema);
export type DocumentComment=z.infer<typeof commentSchema>;

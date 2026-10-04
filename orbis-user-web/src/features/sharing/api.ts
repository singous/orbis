import { z } from "zod";
import { apiBlobRequest, apiRequest } from "../../shared/api/api-client";
import {
  authRequestOptions,
  type AuthRequestOptions,
} from "../../shared/auth/use-auth-request";
import { SHARED_CONTENT_PAGE_SIZE } from "./sharing-config";

const shareSchema = z.object({
  id: z.string().uuid(),
  notebook_id: z.string().uuid(),
  root_note_id: z.string().uuid().nullable(),
  created_at_ms: z.number(),
  revoked_at_ms: z.number().nullable(),
  path: z.string().nullable().default(null),
});
export type DocumentShare = z.infer<typeof shareSchema>;
export type ShareTarget = {
  notebookId: string;
  noteId?: string;
  title: string;
};
const createdSchema = shareSchema.extend({
  token: z.string(),
  path: z.string(),
});
export const publicShareSchema = z.object({
  title: z.string(),
  root_note_id: z.string().nullable(),
  items: z.array(
    z.object({
      id: z.string(),
      parent_id: z.string().nullable(),
      title: z.string(),
      sort_order: z.number(),
      updated_at_ms: z.number(),
    }),
  ),
});
export type PublicShare = z.infer<typeof publicShareSchema>;
const descriptorSchema = z.object({
  id: z.string(),
  parent_id: z.string().nullable(),
  child_count: z.number(),
  has_children: z.boolean(),
  children_loaded: z.boolean(),
  payload_loaded: z.boolean().default(true),
  payload_bytes: z.number().default(0),
});
const blockSchema = z.object({
  note_id: z.string(),
  content_version: z.number(),
  block: z.record(z.unknown()),
  descriptor: descriptorSchema,
});
export type SharedBlock = z.infer<typeof blockSchema>;
const contentSchema = z.object({
  note_id: z.string(),
  title: z.string(),
  blocks: z
    .object({
      schema_version: z.literal(2),
      blocks: z.array(z.record(z.unknown())),
    })
    .passthrough(),
  content_version: z.number(),
  updated_at_ms: z.number(),
  parent_id: z.string().nullable(),
  offset: z.number(),
  next_offset: z.number(),
  total_blocks: z.number(),
  has_more: z.boolean(),
  descriptors: z.array(descriptorSchema),
  oversized_block: z.boolean(),
});
export type SharedContentPage = z.infer<typeof contentSchema>;

export async function listShares(
  target: ShareTarget,
  auth: AuthRequestOptions,
) {
  const params = new URLSearchParams({ notebook_id: target.notebookId });
  if (target.noteId) params.set("root_note_id", target.noteId);
  return z
    .object({ items: z.array(shareSchema) })
    .parse(await apiRequest(`/shares?${params}`, authRequestOptions(auth)))
    .items;
}
export async function createShare(
  target: ShareTarget,
  auth: AuthRequestOptions,
) {
  return createdSchema.parse(
    await apiRequest("/shares", {
      ...authRequestOptions(auth),
      method: "POST",
      body: {
        notebook_id: target.notebookId,
        root_note_id: target.noteId ?? null,
        acknowledge_public_scope: true,
      },
    }),
  );
}
export async function revokeShare(id: string, auth: AuthRequestOptions) {
  return shareSchema.parse(
    await apiRequest(`/shares/${encodeURIComponent(id)}/revoke`, {
      ...authRequestOptions(auth),
      method: "POST",
    }),
  );
}
export async function readPublicShare(token: string, signal?: AbortSignal) {
  return publicShareSchema.parse(
    await apiRequest(`/public/shares/${encodeURIComponent(token)}`, { signal }),
  );
}
export async function readSharedContent(
  token: string,
  noteId: string,
  options: {
    parentId?: string;
    offset?: number;
    version?: number;
    signal?: AbortSignal;
  } = {},
) {
  const params = new URLSearchParams({
    offset: String(options.offset ?? 0),
    limit: String(SHARED_CONTENT_PAGE_SIZE),
  });
  if (options.parentId) params.set("parent_id", options.parentId);
  if (options.version) params.set("expected_version", String(options.version));
  return contentSchema.parse(
    await apiRequest(
      `/public/shares/${encodeURIComponent(token)}/notes/${encodeURIComponent(noteId)}/content?${params}`,
      { signal: options.signal },
    ),
  );
}
export function readSharedFile(
  token: string,
  noteId: string,
  fileId: string,
  signal?: AbortSignal,
) {
  return apiBlobRequest(
    `/public/shares/${encodeURIComponent(token)}/notes/${encodeURIComponent(noteId)}/files/${encodeURIComponent(fileId)}`,
    { signal },
  );
}
export async function readSharedBlock(
  token: string,
  noteId: string,
  blockId: string,
  version: number,
  signal?: AbortSignal,
) {
  return blockSchema.parse(
    await apiRequest(
      `/public/shares/${encodeURIComponent(token)}/notes/${encodeURIComponent(noteId)}/blocks/${encodeURIComponent(blockId)}?expected_version=${version}`,
      { signal },
    ),
  );
}

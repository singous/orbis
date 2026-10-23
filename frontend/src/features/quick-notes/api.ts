import { z } from "zod";
import { apiRequest, workspacePath } from "../../shared/api/api-client";
import { authRequestOptions, type AuthRequestOptions } from "../../shared/auth/use-auth-request";
import { nativeBlockSchema, type NativeBlock } from "../content/codecs/api-content";

export const quickNoteSchema = z.object({
  id: z.string().uuid(), workspace_id: z.string().uuid(), owner_id: z.string().uuid(),
  version: z.number().int().positive(), blocks: z.array(nativeBlockSchema), tag_ids: z.array(z.string().uuid()),
  is_pinned: z.boolean(), created_at_ms: z.number().int(), updated_at_ms: z.number().int(), deleted_at_ms: z.number().int().nullable(),
});
export const quickNoteTagSchema = z.object({ id: z.string().uuid(), name: z.string(), version: z.number().int(), count: z.number().int(), created_at_ms: z.number().int(), updated_at_ms: z.number().int() });
const paginationSchema = z.object({ page: z.number().int(), page_size: z.number().int(), total: z.number().int() });
const summarySchema = z.object({ total: z.number().int(), untagged: z.number().int(), deleted: z.number().int() });
export type QuickNote = z.infer<typeof quickNoteSchema>;
export type QuickNoteTag = z.infer<typeof quickNoteTagSchema>;
export type NoteWrite = { operation_id: string; expected_version: number; blocks: NativeBlock[]; tag_ids: string[] };
export type NoteFilter = { q: string; tag: string; sort: "updated" | "created"; deleted: boolean };

export async function listQuickNotes(auth: AuthRequestOptions, filter: NoteFilter, page: number, signal?: AbortSignal) {
  const query = new URLSearchParams({ page: String(page), page_size: "20", sort: filter.sort, deleted: String(filter.deleted) });
  if (filter.q.trim()) query.set("q", filter.q.trim());
  if (filter.tag === "untagged") query.set("untagged", "true");
  else if (filter.tag) query.set("tag_id", filter.tag);
  return z.object({ items: z.array(quickNoteSchema), pagination: paginationSchema }).parse(await apiRequest(workspacePath(auth, `/quick-notes?${query}`), { ...authRequestOptions(auth), signal }));
}
export async function listQuickNoteTags(auth: AuthRequestOptions, signal?: AbortSignal) {
  return z.object({ items: z.array(quickNoteTagSchema), pagination: paginationSchema }).parse(await apiRequest(workspacePath(auth, "/quick-note-tags?page_size=100"), { ...authRequestOptions(auth), signal }));
}
export async function quickNoteSummary(auth: AuthRequestOptions, signal?: AbortSignal) {
  return summarySchema.parse(await apiRequest(workspacePath(auth, "/quick-notes/summary"), { ...authRequestOptions(auth), signal }));
}
export async function saveQuickNote(auth: AuthRequestOptions, id: string | null, body: NoteWrite) {
  return quickNoteSchema.parse(await apiRequest(workspacePath(auth, `/quick-notes${id ? `/${id}` : ""}`), { ...authRequestOptions(auth), method: id ? "PUT" : "POST", body }));
}
export async function patchQuickNote(auth: AuthRequestOptions, id: string, body: { operation_id: string; expected_version: number; is_pinned?: boolean; is_deleted?: boolean }) {
  return quickNoteSchema.parse(await apiRequest(workspacePath(auth, `/quick-notes/${id}`), { ...authRequestOptions(auth), method: "PATCH", body }));
}
export async function writeQuickNoteTag(auth: AuthRequestOptions, id: string | null, body: { operation_id: string; expected_version: number; name?: string }, remove = false) {
  const result = await apiRequest(workspacePath(auth, `/quick-note-tags${id ? `/${id}` : ""}`), { ...authRequestOptions(auth), method: remove ? "DELETE" : id ? "PUT" : "POST", body });
  return remove ? null : quickNoteTagSchema.parse(result);
}

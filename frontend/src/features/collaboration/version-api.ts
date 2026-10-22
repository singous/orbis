import { z } from "zod";
import { apiRequest, ApiError, workspacePath } from "../../shared/api/api-client";
import { authRequestOptions, type AuthRequestOptions } from "../../shared/auth/use-auth-request";
import { editorBlock, nativeBlockSchema } from "../content/codecs/api-content";
import { revisionWireSchema } from "./schemas";

const revisionNumber = z.number().int().positive().safe();
const versionDependencies = z.array(z.object({ kind: z.enum(["asset", "table", "sheet_link"]), id: z.string().uuid(), revision: revisionNumber.nullable() }));
export const documentVersionSchema = z.object({
  id: z.string().uuid(), document_id: z.string().uuid(), source_revision: revisionNumber,
  kind: z.enum(["automatic", "named", "before_restore", "restored"]), name: z.string().nullable(), description: z.string(),
  title: z.string(), title_recorded: z.boolean(), content_hash: z.string().regex(/^[a-f0-9]{64}$/), content_schema: z.literal("orbis.document-version.v1"),
  author_id: z.string().uuid().nullable(), author_name: z.string(), metadata_version: revisionNumber,
  captured_at_ms: z.number().int().safe(), created_at_ms: z.number().int().safe(), updated_at_ms: z.number().int().safe(),
});
const cursorPage = z.object({ next_cursor: z.string().nullable(), has_more: z.boolean() });
const versionPage = z.object({ items: z.array(documentVersionSchema), pagination: cursorPage, automatic_history_enabled: z.boolean() });
const nativeContent = z.object({ revision: revisionWireSchema, blocks: z.array(nativeBlockSchema) });
const versionContent = z.object({ version: documentVersionSchema, content: nativeContent, dependencies: versionDependencies });
const comparison = z.object({
  from: documentVersionSchema, to: documentVersionSchema,
  items: z.array(z.object({ block_id: z.string().uuid(), change: z.enum(["added", "removed", "modified", "moved"]), content_changed: z.boolean(), position_changed: z.boolean(), before_text: z.string().nullable(), after_text: z.string().nullable() })),
  pagination: cursorPage,
});
export type DocumentVersion = z.infer<typeof documentVersionSchema>;
export type SaveVersionInput = { source_revision: number; name: string; description: string };
export type EditVersionInput = { id: string; expected_metadata_version: number; name: string | null; description: string };
export type RestoreVersionInput = { id: string; expected_revision: number };

const versionsPath = (id: string, auth: AuthRequestOptions) => workspacePath(auth, `/documents/${encodeURIComponent(id)}/versions`);
export function documentVersionLabel(version: DocumentVersion) {
  if (version.name) return version.name;
  return ({ automatic: "自动历史", named: "已保存版本", before_restore: "恢复前的内容", restored: "恢复后的内容" })[version.kind];
}
export async function listDocumentVersions(id: string, cursor: string | null, auth: AuthRequestOptions, signal?: AbortSignal) {
  const params = new URLSearchParams({ page_size: "20" });
  if (cursor) params.set("cursor", cursor);
  const result = versionPage.parse(await apiRequest(`${versionsPath(id, auth)}?${params}`, { ...authRequestOptions(auth), signal }));
  if (result.items.some(version => version.document_id !== id)) throw new ApiError(502, "版本列表响应不一致。", "API_RESPONSE_INVALID");
  return result;
}
export async function readDocumentVersion(id: string, versionId: string, auth: AuthRequestOptions, signal?: AbortSignal) {
  const result = versionContent.parse(await apiRequest(`${versionsPath(id, auth)}/${encodeURIComponent(versionId)}/content`, { ...authRequestOptions(auth), signal }));
  if (result.version.id !== versionId || result.version.document_id !== id || result.content.revision.document_id !== id || result.content.revision.version !== result.version.source_revision) throw new ApiError(502, "版本内容响应不一致。", "API_RESPONSE_INVALID");
  return { version: result.version, dependencies: result.dependencies, blocks: { schema_version: 2 as const, editor: "blocknote" as const, blocks: result.content.blocks.map(editorBlock) } };
}
export async function saveDocumentVersion(id: string, input: SaveVersionInput, operationId: string, auth: AuthRequestOptions) {
  return documentVersionSchema.parse(await apiRequest(versionsPath(id, auth), { ...authRequestOptions(auth), method: "POST", body: { ...input, operation_id: operationId } }));
}
export async function editDocumentVersion(id: string, input: EditVersionInput, operationId: string, auth: AuthRequestOptions) {
  const { id: versionId, ...body } = input;
  return documentVersionSchema.parse(await apiRequest(`${versionsPath(id, auth)}/${encodeURIComponent(versionId)}`, { ...authRequestOptions(auth), method: "PUT", body: { ...body, operation_id: operationId } }));
}
export async function restoreDocumentVersion(id: string, input: RestoreVersionInput, operationId: string, auth: AuthRequestOptions) {
  const body = { operation_id: operationId, expected_revision: input.expected_revision };
  let unknown = false;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const result = nativeContent.parse(await apiRequest(`${versionsPath(id, auth)}/${encodeURIComponent(input.id)}/restore`, { ...authRequestOptions(auth), method: "POST", body }));
      if (result.revision.document_id !== id) throw new ApiError(502, "恢复响应不一致。", "API_RESPONSE_INVALID");
      return { kind: "complete" as const, note_id: id, content_version: result.revision.version, title: result.revision.title_recorded ? result.revision.title : null, blocks: { schema_version: 2 as const, editor: "blocknote" as const, blocks: result.blocks.map(editorBlock) } };
    } catch (error) {
      const definitive = error instanceof ApiError && error.status >= 400 && error.status < 500;
      if (definitive && !unknown) throw error;
      unknown = true;
      if (attempt === 1 || definitive) throw new ApiError(503, "恢复结果尚未确认，请重试原操作。", "DOCUMENT_WRITE_RESULT_UNKNOWN");
    }
  }
  throw new Error("Unreachable version restore state");
}
export async function compareDocumentVersions(id: string, from: string, to: string, cursor: string | null, auth: AuthRequestOptions, signal?: AbortSignal) {
  const params = new URLSearchParams({ from_id: from, page_size: "20" });
  if (cursor) params.set("cursor", cursor);
  const result = comparison.parse(await apiRequest(`${versionsPath(id, auth)}/${encodeURIComponent(to)}/compare?${params}`, { ...authRequestOptions(auth), signal }));
  if (result.from.id !== from || result.to.id !== to || result.from.document_id !== id || result.to.document_id !== id) throw new ApiError(502, "版本比较响应不一致。", "API_RESPONSE_INVALID");
  return result;
}

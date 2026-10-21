import {saveNoteBlockChanges} from "./document-operations-api";
import { z } from "zod";
import { ApiError, apiBlobRequest, apiRequest, workspacePath } from "../../shared/api/api-client";
import { documentGroupSchema, nativeNoteSchema, notebookSchema, noteSchema, pageDataSchema, type DocumentGroup, type Notebook, type NotebookIconValue, type Note, type NoteTreeItem, type PageData } from "../../shared/api/schemas";
import { authRequestOptions, type AuthRequestOptions } from "../../shared/auth/use-auth-request";
export type ResourceStatus = "active" | "archived";
export type CreateNotePayload = { notebook_id: string; title: string; parent_id: string | null; sort_order: number };
export type NoteOrderPayload = { parent_id: string | null; expected_note_ids: string[]; note_ids: string[]; expected_directory_version: number };
const CATALOG_PAGE_SIZE = 100;
const MAX_CATALOG_PAGES = 100;
function path(auth: AuthRequestOptions, suffix: string) { return workspacePath(auth, suffix); }
function query(suffix: string, values: Record<string, string | number | null | undefined>) {
  const params = new URLSearchParams();
  for (const [key,value] of Object.entries(values)) if (value !== null && value !== undefined) params.set(key,String(value));
  return `${suffix}?${params}`;
}
async function pages<S extends z.ZodTypeAny>(suffix: string, schema: S, auth: AuthRequestOptions, signal?: AbortSignal, all = true, firstPage = 1, pageSize = CATALOG_PAGE_SIZE): Promise<PageData<z.infer<S>>> {
  const items: z.infer<S>[] = [];
  for (let step = 0; step < MAX_CATALOG_PAGES; step += 1) {
    const page = firstPage + step;
    const url = suffix + (suffix.includes("?") ? "&" : "?") + new URLSearchParams({ page: String(page), page_size: String(pageSize) });
    const result = pageDataSchema(schema).parse(await apiRequest(path(auth,url), { ...authRequestOptions(auth), signal }));
    items.push(...result.items);
    if (!all || !result.pagination.has_next) return { ...result, items, pagination: { ...result.pagination, page: all ? 1 : result.pagination.page, has_next: all ? false : result.pagination.has_next, has_previous: all ? false : result.pagination.has_previous } };
  }
  throw new Error("目录内容过多，请缩小范围后重试。");
}
export function listDocumentGroups(auth: AuthRequestOptions, status: ResourceStatus = "active", signal?: AbortSignal) {
  return pages(query("/collection-groups", { archived: String(status === "archived") }),documentGroupSchema,auth,signal);
}
export async function getDocumentGroup(groupId: string, auth: AuthRequestOptions, signal?: AbortSignal): Promise<DocumentGroup> {
  return documentGroupSchema.parse(await apiRequest(path(auth,`/collection-groups/${groupId}`),{ ...authRequestOptions(auth),signal }));
}
export async function createDocumentGroup(payload: { name: string; sort_order: number }, auth: AuthRequestOptions): Promise<DocumentGroup> {
  return documentGroupSchema.parse(await apiRequest(path(auth,"/collection-groups"),{ ...authRequestOptions(auth),method:"POST",body:payload }));
}
export async function updateDocumentGroup(groupId: string, payload: { expected_version: number; name?: string; sort_order?: number }, auth: AuthRequestOptions): Promise<DocumentGroup> {
  return documentGroupSchema.parse(await apiRequest(path(auth,`/collection-groups/${groupId}`),{ ...authRequestOptions(auth),method:"PATCH",body:payload }));
}
export async function setDocumentGroupArchived(groupId: string, archived: boolean, expectedVersion: number, auth: AuthRequestOptions): Promise<DocumentGroup> {
  return documentGroupSchema.parse(await apiRequest(path(auth,`/collection-groups/${groupId}/archive`),{ ...authRequestOptions(auth),method:"PUT",body:{ archived,expected_version:expectedVersion } }));
}
export function listNotebooks(auth: AuthRequestOptions, groupId?: string, status: ResourceStatus = "active", options: { signal?: AbortSignal } = {}) {
  return pages(query("/collections",{ group_id:groupId,archived:String(status === "archived") }),notebookSchema,auth,options.signal);
}
export async function createNotebook(payload: { title: string; group_id?: string | null; sort_order: number; icon?: NotebookIconValue | null }, auth: AuthRequestOptions): Promise<Notebook> {
  return notebookSchema.parse(await apiRequest(path(auth,"/collections"),{ ...authRequestOptions(auth),method:"POST",body:payload }));
}
export async function getNotebook(collectionId: string, auth: AuthRequestOptions, signal?: AbortSignal): Promise<Notebook> {
  return notebookSchema.parse(await apiRequest(path(auth,`/collections/${collectionId}`),{ ...authRequestOptions(auth),signal }));
}
export async function updateNotebook(collectionId: string, payload: { expected_version: number; title?: string; group_id?: string | null; sort_order?: number; icon?: NotebookIconValue | null }, auth: AuthRequestOptions): Promise<Notebook> {
  return notebookSchema.parse(await apiRequest(path(auth,`/collections/${collectionId}`),{ ...authRequestOptions(auth),method:"PATCH",body:payload }));
}
export async function setNotebookArchived(collectionId: string, archived: boolean, expectedDirectoryVersion: number, auth: AuthRequestOptions): Promise<Notebook> {
  return notebookSchema.parse(await apiRequest(path(auth,`/collections/${collectionId}/archive`),{ ...authRequestOptions(auth),method:"PUT",body:{ archived,expected_directory_version:expectedDirectoryVersion } }));
}
export async function createNote(payload: CreateNotePayload, auth: AuthRequestOptions): Promise<Note> {
  return noteSchema.parse(await apiRequest(path(auth,`/collections/${payload.notebook_id}/documents`),{ ...authRequestOptions(auth),method:"POST",body:{ title:payload.title,parent_id:payload.parent_id } }));
}
export async function getNote(noteId: string, auth: AuthRequestOptions, signal?: AbortSignal): Promise<Note> {
  return noteSchema.parse(await apiRequest(path(auth,`/documents/${noteId}`),{ ...authRequestOptions(auth),signal }));
}
export async function setNoteArchived(noteId: string, archived: boolean, expectedDirectoryVersion: number, auth: AuthRequestOptions) {
  const result = z.object({ document:noteSchema,directory_version:z.number().int().positive() }).parse(await apiRequest(path(auth,`/documents/${noteId}/archive`),{ ...authRequestOptions(auth),method:"PUT",body:{ archived,expected_directory_version:expectedDirectoryVersion } }));
  return { ...result.document,directory_version:result.directory_version };
}
export async function updateNote(noteId: string, payload: { title?: string; parent_id?: string | null; sort_order?: number; expected_version?: number; expected_directory_version?: number; operation_id?: string }, auth: AuthRequestOptions): Promise<Note> {
  const location = payload.parent_id !== undefined || payload.sort_order !== undefined;
  if (payload.title !== undefined && location) throw new Error("请分别保存标题与目录位置。");
  if (payload.title !== undefined) {
    if (!payload.operation_id || !payload.expected_version) throw new Error("标题保存缺少原始版本和操作标识，请重新载入。");
    await saveNoteBlockChanges({noteId,operationId:payload.operation_id,expectedVersion:payload.expected_version,operations:[{type:"update_metadata",title:payload.title}]},auth);
    return getNote(noteId,auth);
  }
  if (!payload.expected_directory_version) throw new Error("目录版本尚未载入，请重新载入后重试。");
  return z.object({ document:noteSchema }).parse(await apiRequest(path(auth,`/documents/${noteId}/location`),{ ...authRequestOptions(auth),method:"PATCH",body:{ expected_directory_version:payload.expected_directory_version,...(payload.parent_id !== undefined ? { parent_id:payload.parent_id } : {}),...(payload.sort_order !== undefined ? { position:payload.sort_order } : {}) } })).document;
}
export async function getNoteTree(collectionId: string, auth: AuthRequestOptions, signal?: AbortSignal): Promise<{ items: NoteTreeItem[]; directory_version: number }> {
  const before = await getNotebook(collectionId,auth,signal);
  const listed = await pages(`/collections/${collectionId}/documents`,nativeNoteSchema,auth,signal);
  const after = await getNotebook(collectionId,auth,signal);
  if (before.directory_version !== after.directory_version) throw new ApiError(409,"目录正在更新，请重新载入。","DIRECTORY_VERSION_CONFLICT");
  const byId = new Map<string,NoteTreeItem>();
  for (const item of listed.items) byId.set(item.id,{ ...noteSchema.parse(item),children:[] });
  const roots: NoteTreeItem[] = [];
  for (const item of byId.values()) {
    if (item.parent_id === null) roots.push(item);
    else { const parent = byId.get(item.parent_id); if (!parent) throw new Error("目录结构不完整，请重新载入。"); parent.children.push(item); }
  }
  const sort = (siblings: NoteTreeItem[]) => { siblings.sort((a,b) => a.position-b.position || a.id.localeCompare(b.id)); for (const item of siblings) sort(item.children); };
  sort(roots);
  return { items:roots,directory_version:after.directory_version };
}
export async function reorderNotebookNotes(collectionId: string, payload: NoteOrderPayload, auth: AuthRequestOptions) {
  await apiRequest(path(auth,`/collections/${collectionId}/order`),{ ...authRequestOptions(auth),method:"PUT",body:{ expected_directory_version:payload.expected_directory_version,parent_id:payload.parent_id,document_ids:payload.note_ids } });
  return getNoteTree(collectionId,auth);
}
export async function browseNotes(auth: AuthRequestOptions, status: ResourceStatus = "active", options: { allPages?: boolean; signal?: AbortSignal; page?:number; pageSize?:number } = {}) {
  const result = await pages(status === "archived" ? "/documents/archive" : "/documents",status === "archived" ? nativeNoteSchema.transform(item => ({ ...item,summary:null as string | null })) : nativeNoteSchema.extend({ summary:z.string().refine(value => Array.from(value).length <= 240) }),auth,options.signal,options.allPages ?? false,options.page ?? 1,options.pageSize ?? 20);
  return { ...result,items:result.items.map(item => ({ ...noteSchema.parse(item),summary:item.summary })) };
}
export async function importMarkdown(payload: { notebook_id: string; title: string; markdown: string; parent_id: string | null; sort_order: number; operation_id: string }, auth: AuthRequestOptions): Promise<Note> {
  return z.object({ document:noteSchema }).parse(await apiRequest(path(auth,`/collections/${payload.notebook_id}/imports/markdown`),{ ...authRequestOptions(auth),method:"POST",body:{ operation_id:payload.operation_id,title:payload.title,markdown:payload.markdown,parent_id:payload.parent_id } })).document;
}
export async function exportMarkdown(noteId: string, auth: AuthRequestOptions) {
  const document = await getNote(noteId,auth);
  const blob = await apiBlobRequest(path(auth,`/documents/${noteId}/export/markdown?version=${document.content_version}`),authRequestOptions(auth));
  return { filename:document.title+".md",markdown:await blob.text() };
}

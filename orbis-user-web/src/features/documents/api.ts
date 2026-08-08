import { apiRequest } from "../../shared/api/api-client";
import {
  documentGroupListResponseSchema,
  documentGroupSchema,
  markdownExportSchema,
  notebookListResponseSchema,
  notebookSchema,
  noteContentSchema,
  noteSchema,
  noteSearchResponseSchema,
  noteTreeResponseSchema,
  type DocumentGroup,
  type MarkdownExport,
  type Notebook,
  type Note,
  type NoteBlocks,
  type NoteContent,
  type NoteSearchItem,
  type NoteTreeItem,
  type PageData,
} from "../../shared/api/schemas";

export type AuthRequestOptions = {
  accessToken: string;
  refreshToken: string | null;
  onTokenRefresh: (accessToken: string) => void;
  onUnauthorized: () => void;
};

export type ResourceStatus = "active" | "archived";

const DEFAULT_PAGE = "1";
const DEFAULT_PAGE_SIZE = "100";

function authOptions(auth: AuthRequestOptions) {
  return {
    token: auth.accessToken,
    refreshToken: auth.refreshToken,
    onTokenRefresh: auth.onTokenRefresh,
    onUnauthorized: auth.onUnauthorized,
  };
}

function queryPath(path: string, values: Record<string, string | null | undefined>): string {
  const params = new URLSearchParams();
  Object.entries(values).forEach(([key, value]) => {
    if (value) params.set(key, value);
  });
  const query = params.toString();
  return query ? `${path}?${query}` : path;
}

export async function listDocumentGroups(auth: AuthRequestOptions, status: ResourceStatus = "active"): Promise<PageData<DocumentGroup>> {
  return documentGroupListResponseSchema.parse(await apiRequest(queryPath("/document-groups", {
    status: status === "archived" ? status : null,
    page: DEFAULT_PAGE,
    page_size: DEFAULT_PAGE_SIZE,
  }), authOptions(auth)));
}

export async function createDocumentGroup(payload: { name: string; sort_order: number }, auth: AuthRequestOptions): Promise<DocumentGroup> {
  return documentGroupSchema.parse(await apiRequest("/document-groups", { method: "POST", body: payload, ...authOptions(auth) }));
}

export async function updateDocumentGroup(groupId: string, payload: { name?: string; sort_order?: number }, auth: AuthRequestOptions): Promise<DocumentGroup> {
  return documentGroupSchema.parse(await apiRequest(`/document-groups/${groupId}`, { method: "PATCH", body: payload, ...authOptions(auth) }));
}

export async function setDocumentGroupArchived(groupId: string, archived: boolean, auth: AuthRequestOptions): Promise<DocumentGroup> {
  return documentGroupSchema.parse(await apiRequest(`/document-groups/${groupId}/${archived ? "archive" : "restore"}`, { method: "POST", ...authOptions(auth) }));
}

export async function listNotebooks(
  auth: AuthRequestOptions,
  groupId?: string,
  status: ResourceStatus = "active",
  options: { includeInactiveParents?: boolean } = {},
): Promise<PageData<Notebook>> {
  return notebookListResponseSchema.parse(await apiRequest(queryPath("/notebooks", {
    group_id: groupId,
    status: status === "archived" ? status : null,
    include_inactive_parents: options.includeInactiveParents ? "true" : null,
    page: DEFAULT_PAGE,
    page_size: DEFAULT_PAGE_SIZE,
  }), authOptions(auth)));
}

export async function createNotebook(payload: { title: string; group_id?: string | null; sort_order: number }, auth: AuthRequestOptions): Promise<Notebook> {
  return notebookSchema.parse(await apiRequest("/notebooks", { method: "POST", body: payload, ...authOptions(auth) }));
}

export async function updateNotebook(notebookId: string, payload: { title?: string; group_id?: string | null; sort_order?: number }, auth: AuthRequestOptions): Promise<Notebook> {
  return notebookSchema.parse(await apiRequest(`/notebooks/${notebookId}`, { method: "PATCH", body: payload, ...authOptions(auth) }));
}

export async function setNotebookArchived(notebookId: string, archived: boolean, auth: AuthRequestOptions): Promise<Notebook> {
  return notebookSchema.parse(await apiRequest(`/notebooks/${notebookId}/${archived ? "archive" : "restore"}`, { method: "POST", ...authOptions(auth) }));
}

export type CreateNotePayload = { notebook_id: string; title: string; parent_id: string | null; sort_order: number };

export async function createNote(payload: CreateNotePayload, auth: AuthRequestOptions): Promise<Note> {
  return noteSchema.parse(await apiRequest("/notes", { method: "POST", body: payload, ...authOptions(auth) }));
}

export async function getNote(noteId: string, auth: AuthRequestOptions): Promise<Note> {
  return noteSchema.parse(await apiRequest(`/notes/${noteId}`, authOptions(auth)));
}

export async function updateNote(noteId: string, payload: { title?: string; parent_id?: string | null; sort_order?: number }, auth: AuthRequestOptions): Promise<Note> {
  return noteSchema.parse(await apiRequest(`/notes/${noteId}`, { method: "PATCH", body: payload, ...authOptions(auth) }));
}

export async function setNoteArchived(noteId: string, archived: boolean, auth: AuthRequestOptions): Promise<Note> {
  return noteSchema.parse(await apiRequest(`/notes/${noteId}/${archived ? "archive" : "restore"}`, { method: "POST", ...authOptions(auth) }));
}

export async function getNoteTree(notebookId: string, auth: AuthRequestOptions): Promise<{ items: NoteTreeItem[] }> {
  return noteTreeResponseSchema.parse(await apiRequest(`/notebooks/${notebookId}/notes/tree`, authOptions(auth)));
}

export async function getNoteContent(noteId: string, auth: AuthRequestOptions): Promise<NoteContent> {
  return noteContentSchema.parse(await apiRequest(`/notes/${noteId}/content`, authOptions(auth)));
}

export async function saveNoteContent(payload: { noteId: string; expectedVersion: number; blocks: NoteBlocks }, auth: AuthRequestOptions): Promise<NoteContent> {
  return noteContentSchema.parse(await apiRequest(`/notes/${payload.noteId}/content`, {
    method: "PUT",
    body: { expected_version: payload.expectedVersion, blocks: payload.blocks },
    ...authOptions(auth),
  }));
}

export async function searchNotes(query: string, auth: AuthRequestOptions, status: ResourceStatus = "active"): Promise<PageData<NoteSearchItem>> {
  return noteSearchResponseSchema.parse(await apiRequest(queryPath("/notes", {
    q: query.trim() || null,
    status: status === "archived" ? status : null,
    page: DEFAULT_PAGE,
    page_size: DEFAULT_PAGE_SIZE,
  }), authOptions(auth)));
}

export async function importMarkdown(payload: { notebook_id: string; title: string; markdown: string; parent_id: string | null; sort_order: number }, auth: AuthRequestOptions): Promise<Note> {
  return noteSchema.parse(await apiRequest("/notes/import/markdown", { method: "POST", body: payload, ...authOptions(auth) }));
}

export async function exportMarkdown(noteId: string, auth: AuthRequestOptions): Promise<MarkdownExport> {
  return markdownExportSchema.parse(await apiRequest(`/notes/${noteId}/markdown`, authOptions(auth)));
}

import { apiRequest } from "../../shared/api/api-client";
import { noteContentSchema } from "../../shared/api/schemas";
import { authRequestOptions, type AuthRequestOptions } from "../../shared/auth/use-auth-request";
import { commentPageSchema, commentSchema, revisionPageSchema, revisionSchema } from "./schemas";

const PAGE_SIZE = 20;
export type CreateComment = { body: string; parent_id?: string };
export type UpdateComment = { body?: string; is_resolved?: boolean };
const notePath = (noteId: string) => `/notes/${encodeURIComponent(noteId)}`;

export async function listComments(noteId: string, page: number, auth: AuthRequestOptions) {
  return commentPageSchema.parse(await apiRequest(`${notePath(noteId)}/comments?page=${page}&page_size=${PAGE_SIZE}`, authRequestOptions(auth)));
}
export async function createComment(noteId: string, payload: CreateComment, auth: AuthRequestOptions) {
  return commentSchema.parse(await apiRequest(`${notePath(noteId)}/comments`, { method: "POST", body: payload, ...authRequestOptions(auth) }));
}
export async function updateComment(noteId: string, commentId: string, payload: UpdateComment, auth: AuthRequestOptions) {
  return commentSchema.parse(await apiRequest(`${notePath(noteId)}/comments/${encodeURIComponent(commentId)}`, { method: "PATCH", body: payload, ...authRequestOptions(auth) }));
}
export async function listRevisions(noteId: string, page: number, auth: AuthRequestOptions) {
  return revisionPageSchema.parse(await apiRequest(`${notePath(noteId)}/revisions?page=${page}&page_size=${PAGE_SIZE}`, authRequestOptions(auth)));
}
export async function getRevision(noteId: string, revisionId: string, auth: AuthRequestOptions) {
  return revisionSchema.parse(await apiRequest(`${notePath(noteId)}/revisions/${encodeURIComponent(revisionId)}`, authRequestOptions(auth)));
}
export async function restoreRevision(noteId: string, revisionId: string, expectedVersion: number, auth: AuthRequestOptions) {
  return noteContentSchema.parse(await apiRequest(`${notePath(noteId)}/revisions/${encodeURIComponent(revisionId)}/restore`, { method: "POST", body: { expected_version: expectedVersion }, ...authRequestOptions(auth) }));
}

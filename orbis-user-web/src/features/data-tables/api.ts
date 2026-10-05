import { apiRequest } from "../../shared/api/api-client";
import {
  authRequestOptions,
  type AuthRequestOptions,
} from "../../shared/auth/use-auth-request";
import type { OrbisBlock } from "../notes/block-model";
import {
  TABLE_PAGE_SIZE,
  type TableChanges,
  type TableMutation,
  type TablePage,
} from "./model";

export type TableResult = {
  content_version: number;
  table_revision: number;
  table_id: string;
  block: OrbisBlock;
  inverse: TableChanges;
};
export function tablePath(noteId: string, tableId: string) {
  return `/notes/${noteId}/tables/${tableId}`;
}
export function readTable(
  noteId: string,
  tableId: string,
  auth: AuthRequestOptions | null,
  options: {
    viewId?: string;
    offset?: number;
    revision?: number;
    group?: string;
    shareToken?: string;
    signal?: AbortSignal;
  } = {},
): Promise<TablePage> {
  const query = new URLSearchParams({
    limit: String(TABLE_PAGE_SIZE),
    offset: String(options.offset ?? 0),
  });
  if (options.viewId) query.set("view_id", options.viewId);
  if (options.revision)
    query.set("expected_revision", String(options.revision));
  if (options.group) query.set("group", options.group);
  const path =
    (options.shareToken
      ? `/public/shares/${encodeURIComponent(options.shareToken)}`
      : "") + tablePath(noteId, tableId);
  return apiRequest(`${path}?${query}`, {
    ...(auth ? authRequestOptions(auth) : {}),
    signal: options.signal,
  }) as Promise<TablePage>;
}
export function createTable(
  noteId: string,
  payload: {
    operation_id: string;
    expected_document_version: number;
    block_id: string;
    source_table_id?: string;
    source_revision?: number;
  },
  auth: AuthRequestOptions,
): Promise<TableResult> {
  return apiRequest(`/notes/${noteId}/tables`, {
    method: "POST",
    body: payload,
    ...authRequestOptions(auth),
  }) as Promise<TableResult>;
}
export function mutateTable(
  noteId: string,
  tableId: string,
  payload: TableMutation,
  auth: AuthRequestOptions,
): Promise<TableResult> {
  return apiRequest(tablePath(noteId, tableId), {
    method: "PATCH",
    body: payload,
    ...authRequestOptions(auth),
  }) as Promise<TableResult>;
}

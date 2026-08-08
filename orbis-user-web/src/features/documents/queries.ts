import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useStore } from "zustand";

import { authStore } from "../../shared/auth/auth-store";
import {
  createDocumentGroup,
  createNote,
  createNotebook,
  exportMarkdown,
  getNote,
  getNoteContent,
  getNoteTree,
  importMarkdown,
  listDocumentGroups,
  listNotebooks,
  saveNoteContent,
  searchNotes,
  setDocumentGroupArchived,
  setNoteArchived,
  setNotebookArchived,
  updateDocumentGroup,
  updateNote,
  updateNotebook,
  type AuthRequestOptions,
  type CreateNotePayload,
  type ResourceStatus,
} from "./api";

export function useDocumentAuth(): AuthRequestOptions {
  const accessToken = useStore(authStore, (state) => state.accessToken);
  const refreshToken = useStore(authStore, (state) => state.refreshToken);
  const onTokenRefresh = useStore(authStore, (state) => state.setAccessToken);
  const onUnauthorized = useStore(authStore, (state) => state.clearSession);
  if (!accessToken) {
    throw new Error("Authenticated document access required");
  }
  return { accessToken, refreshToken, onTokenRefresh, onUnauthorized };
}

export function useDocumentGroups(status: ResourceStatus = "active") {
  const auth = useDocumentAuth();
  return useQuery({ queryKey: ["document-groups", status], queryFn: () => listDocumentGroups(auth, status) });
}

export function useNotebooks(groupId?: string, status: ResourceStatus = "active") {
  const auth = useDocumentAuth();
  return useQuery({ queryKey: ["notebooks", status, groupId ?? "all"], queryFn: () => listNotebooks(auth, groupId, status) });
}

export function useNoteTree(notebookId?: string) {
  const auth = useDocumentAuth();
  return useQuery({
    queryKey: ["note-tree", notebookId],
    enabled: Boolean(notebookId),
    queryFn: () => getNoteTree(notebookId as string, auth),
  });
}

export function useNote(noteId?: string) {
  const auth = useDocumentAuth();
  return useQuery({
    queryKey: ["note", noteId],
    enabled: Boolean(noteId),
    queryFn: () => getNote(noteId as string, auth),
  });
}

export function useNoteContent(noteId?: string) {
  const auth = useDocumentAuth();
  return useQuery({
    queryKey: ["note-content", noteId],
    enabled: Boolean(noteId),
    queryFn: () => getNoteContent(noteId as string, auth),
  });
}

export function useNoteSearch(query = "", status: ResourceStatus = "active") {
  const auth = useDocumentAuth();
  return useQuery({
    queryKey: ["note-search", status, query.trim()],
    queryFn: () => searchNotes(query, auth, status),
  });
}

function useRefreshDocuments() {
  const queryClient = useQueryClient();
  return async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["document-groups"] }),
      queryClient.invalidateQueries({ queryKey: ["notebooks"] }),
      queryClient.invalidateQueries({ queryKey: ["note-tree"] }),
      queryClient.invalidateQueries({ queryKey: ["note-search"] }),
    ]);
  };
}

export function useCreateDocumentGroup() {
  const auth = useDocumentAuth();
  const refresh = useRefreshDocuments();
  return useMutation({ mutationFn: (payload: { name: string; sort_order: number }) => createDocumentGroup(payload, auth), onSuccess: refresh });
}

export function useUpdateDocumentGroup() {
  const auth = useDocumentAuth();
  const refresh = useRefreshDocuments();
  return useMutation({ mutationFn: ({ id, ...payload }: { id: string; name?: string; sort_order?: number }) => updateDocumentGroup(id, payload, auth), onSuccess: refresh });
}

export function useArchiveDocumentGroup() {
  const auth = useDocumentAuth();
  const refresh = useRefreshDocuments();
  return useMutation({ mutationFn: ({ id, archived }: { id: string; archived: boolean }) => setDocumentGroupArchived(id, archived, auth), onSuccess: refresh });
}

export function useCreateNotebook() {
  const auth = useDocumentAuth();
  const refresh = useRefreshDocuments();
  return useMutation({ mutationFn: (payload: { title: string; group_id?: string | null; sort_order: number }) => createNotebook(payload, auth), onSuccess: refresh });
}

export function useUpdateNotebook() {
  const auth = useDocumentAuth();
  const refresh = useRefreshDocuments();
  return useMutation({ mutationFn: ({ id, ...payload }: { id: string; title?: string; group_id?: string | null; sort_order?: number }) => updateNotebook(id, payload, auth), onSuccess: refresh });
}

export function useArchiveNotebook() {
  const auth = useDocumentAuth();
  const refresh = useRefreshDocuments();
  return useMutation({ mutationFn: ({ id, archived }: { id: string; archived: boolean }) => setNotebookArchived(id, archived, auth), onSuccess: refresh });
}

export function useCreateNote() {
  const auth = useDocumentAuth();
  const refresh = useRefreshDocuments();
  return useMutation({ mutationFn: (payload: CreateNotePayload) => createNote(payload, auth), onSuccess: refresh });
}

export function useUpdateNote() {
  const auth = useDocumentAuth();
  const refresh = useRefreshDocuments();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...payload }: { id: string; title?: string; parent_id?: string | null; sort_order?: number }) => updateNote(id, payload, auth),
    onSuccess: async (note) => {
      queryClient.setQueryData(["note", note.id], note);
      await refresh();
    },
  });
}

export function useArchiveNote() {
  const auth = useDocumentAuth();
  const refresh = useRefreshDocuments();
  return useMutation({ mutationFn: ({ id, archived }: { id: string; archived: boolean }) => setNoteArchived(id, archived, auth), onSuccess: refresh });
}

export function useSaveNoteContent() {
  const auth = useDocumentAuth();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (payload: { noteId: string; expectedVersion: number; blocks: Parameters<typeof saveNoteContent>[0]["blocks"] }) => saveNoteContent(payload, auth),
    onSuccess: (content) => {
      queryClient.setQueryData(["note-content", content.note_id], content);
      void queryClient.invalidateQueries({ queryKey: ["note-search"] });
    },
  });
}

export function useImportMarkdown() {
  const auth = useDocumentAuth();
  const refresh = useRefreshDocuments();
  return useMutation({ mutationFn: (payload: Parameters<typeof importMarkdown>[0]) => importMarkdown(payload, auth), onSuccess: refresh });
}

export function useExportMarkdown() {
  const auth = useDocumentAuth();
  return useMutation({ mutationFn: (noteId: string) => exportMarkdown(noteId, auth) });
}

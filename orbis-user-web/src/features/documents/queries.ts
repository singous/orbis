import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import type { Notebook, NotebookIconValue, NoteTreeItem, PageData } from "../../shared/api/schemas";
import { useAuthRequest } from "../../shared/auth/use-auth-request";
import {
  createDocumentGroup,
  createNote,
  reorderNotebookNotes,
  createNotebook,
  exportMarkdown,
  getNote,
  getNotebook,
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
  type NoteOrderPayload,
  type ResourceStatus,
} from "./api";

export function useDocumentAuth(): AuthRequestOptions {
  return useAuthRequest();
}

export function useDocumentGroups(status: ResourceStatus = "active") {
  const auth = useDocumentAuth();
  return useQuery({ queryKey: ["document-groups", status], queryFn: () => listDocumentGroups(auth, status) });
}

export function useNotebooks(
  groupId?: string,
  status: ResourceStatus = "active",
  options: { includeInactiveParents?: boolean } = {},
) {
  const auth = useDocumentAuth();
  return useQuery({
    queryKey: ["notebooks", status, groupId ?? "all", options.includeInactiveParents ?? false],
    queryFn: ({ signal }) => listNotebooks(auth, groupId, status, { ...options, signal }),
  });
}

export function useNotebook(notebookId?: string) {
  const auth = useDocumentAuth();
  const client = useQueryClient();
  return useQuery({
    queryKey: ["notebook", notebookId],
    enabled: Boolean(notebookId),
    queryFn: ({ signal }) => getNotebook(notebookId!, auth, signal),
    initialData: () => client.getQueriesData<PageData<Notebook>>({ queryKey: ["notebooks", "active"] })
      .flatMap(([, value]) => value?.items ?? []).find(item => item.id === notebookId),
    // A list snapshot paints immediately while the detail verifies its freshness.
    initialDataUpdatedAt: 0,
  });
}

export function useNoteTree(notebookId?: string) {
  const auth = useDocumentAuth();
  return useQuery({
    queryKey: ["note-tree", notebookId],
    enabled: Boolean(notebookId),
    queryFn: ({ signal }) => getNoteTree(notebookId as string, auth, signal),
  });
}

function reorderTreeLevel(items: NoteTreeItem[], parentId: string | null, noteIds: string[]): NoteTreeItem[] {
  if (parentId === null) {
    const byId = new Map(items.map((note) => [note.id, note]));
    return noteIds.map((id, index) => ({ ...byId.get(id)!, sort_order: index }));
  }
  return items.map((note) => note.id === parentId
    ? { ...note, children: reorderTreeLevel(note.children, null, noteIds) }
    : { ...note, children: reorderTreeLevel(note.children, parentId, noteIds) });
}

export function useReorderNotes(notebookId: string) {
  const auth = useDocumentAuth();
  const queryClient = useQueryClient();
  const queryKey = ["note-tree", notebookId];
  return useMutation({
    mutationKey: ["note-reorder", notebookId],
    mutationFn: (payload: NoteOrderPayload) => reorderNotebookNotes(notebookId, payload, auth),
    onMutate: async (payload) => {
      await queryClient.cancelQueries({ queryKey });
      const previous = queryClient.getQueryData<{ items: NoteTreeItem[] }>(queryKey);
      queryClient.setQueryData<{ items: NoteTreeItem[] }>(queryKey, (tree) => tree
        ? { items: reorderTreeLevel(tree.items, payload.parent_id, payload.note_ids) }
        : tree);
      return { previous };
    },
    onSuccess: (tree) => queryClient.setQueryData(queryKey, tree),
    onError: async (_error, _payload, context) => {
      queryClient.setQueryData(queryKey, context?.previous);
      await queryClient.invalidateQueries({ queryKey });
    },
  });
}

export function useNote(noteId?: string) {
  const auth = useDocumentAuth();
  return useQuery({
    queryKey: ["note", noteId],
    enabled: Boolean(noteId),
    queryFn: ({ signal }) => getNote(noteId as string, auth, signal),
  });
}

export function useNoteContent(noteId?: string) {
  const auth = useDocumentAuth();
  return useQuery({
    queryKey: ["note-content", noteId],
    enabled: Boolean(noteId),
    queryFn: ({ signal }) => getNoteContent(noteId as string, auth, signal),
  });
}

type UseNoteSearchOptions = {
  enabled?: boolean;
  allPages?: boolean;
};

export function useNoteSearch(
  query = "",
  status: ResourceStatus = "active",
  options: UseNoteSearchOptions = {},
) {
  const auth = useDocumentAuth();
  return useQuery({
    queryKey: options.allPages ? ["note-search", status, query.trim(), "all"] : ["note-search", status, query.trim()],
    enabled: options.enabled ?? true,
    queryFn: () => searchNotes(query, auth, status, { allPages: options.allPages }),
  });
}

function useRefreshDocuments() {
  const queryClient = useQueryClient();
  return async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["document-groups"] }),
      queryClient.invalidateQueries({ queryKey: ["notebooks"] }),
      queryClient.invalidateQueries({ queryKey: ["notebook"] }),
      queryClient.invalidateQueries({ queryKey: ["note-tree"] }),
      queryClient.invalidateQueries({ queryKey: ["note-search"] }),
      queryClient.invalidateQueries({ queryKey: ["global-search"] }),
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
  return useMutation({ mutationFn: (payload: { title: string; group_id?: string | null; sort_order: number; icon?: NotebookIconValue | null }) => createNotebook(payload, auth), onSuccess: refresh });
}

export function useUpdateNotebook() {
  const auth = useDocumentAuth();
  const refresh = useRefreshDocuments();
  return useMutation({ mutationFn: ({ id, ...payload }: { id: string; title?: string; group_id?: string | null; sort_order?: number; icon?: NotebookIconValue | null }) => updateNotebook(id, payload, auth), onSuccess: refresh });
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
    onSuccess: (note, payload) => {
      queryClient.setQueryData(["note", note.id], note);
      if (payload.parent_id !== undefined || payload.sort_order !== undefined) return refresh();
      const updateTitle = (items: NoteTreeItem[]): NoteTreeItem[] => items.map(item => item.id === note.id
        ? { ...item, title: note.title, updated_at_ms: note.updated_at_ms }
        : { ...item, children: updateTitle(item.children) });
      queryClient.setQueryData<{ items: NoteTreeItem[] }>(["note-tree", note.notebook_id], tree => tree ? { ...tree, items: updateTitle(tree.items) } : tree);
      // Reconcile the affected list in the background; a title save must not
      // delay the body write behind unrelated workspace directory requests.
      void queryClient.invalidateQueries({ queryKey: ["note-tree", note.notebook_id] });
      void queryClient.invalidateQueries({ queryKey: ["note-search"] });
      void queryClient.invalidateQueries({ queryKey: ["global-search"] });
    },
  });
}

export function useArchiveNote() {
  const auth = useDocumentAuth();
  const refresh = useRefreshDocuments();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, archived }: { id: string; archived: boolean }) => setNoteArchived(id, archived, auth),
    onSuccess: async (_note, { id }) => {
      queryClient.removeQueries({ queryKey: ["note", id], exact: true });
      queryClient.removeQueries({ queryKey: ["note-content", id], exact: true });
      await refresh();
    },
  });
}

export function useSaveNoteContent() {
  const auth = useDocumentAuth();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (payload: { noteId: string; expectedVersion: number; blocks: Parameters<typeof saveNoteContent>[0]["blocks"] }) => saveNoteContent(payload, auth),
    onSuccess: (content) => {
      queryClient.setQueryData(["note-content", content.note_id], content);
      void queryClient.invalidateQueries({ queryKey: ["collaboration", content.note_id, "revisions"] });
      void queryClient.invalidateQueries({ queryKey: ["note-search"] });
      void queryClient.invalidateQueries({ queryKey: ["global-search"] });
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

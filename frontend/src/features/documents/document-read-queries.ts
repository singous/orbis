import { queryOptions, type QueryClient } from "@tanstack/react-query";
import type { Note, NoteChildrenPage, NoteContent } from "../../shared/api/schemas";
import { getNote, getNoteChildrenPage, type AuthRequestOptions } from "./api";

export function noteQueryOptions(noteId: string | undefined, auth: AuthRequestOptions, silent = false) {
  return queryOptions({
    queryKey: ["note", noteId],
    meta: { silent },
    enabled: Boolean(noteId),
    queryFn: ({ signal }) => getNote(noteId!, auth, signal),
  });
}

export function firstNotePageQueryOptions(
  client: QueryClient,
  noteId: string | undefined,
  auth: AuthRequestOptions,
  pageSize: number,
  prefetchedNote?: Note,
) {
  const silent = Boolean(prefetchedNote);
  return queryOptions<NoteContent | NoteChildrenPage>({
    queryKey: ["note-content-pages", noteId],
    meta: { silent },
    enabled: Boolean(noteId),
    queryFn: async ({ signal }) => {
      const note = prefetchedNote ?? await client.fetchQuery(noteQueryOptions(noteId, auth));
      signal.throwIfAborted();
      const page = await getNoteChildrenPage(noteId!, auth, { limit: pageSize, version: note.content_version, signal });
      return { ...page, title: note.title };
    },
  });
}

import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useAuthRequest } from "../../shared/auth/use-auth-request";
import { createComment, getRevision, listComments, listRevisions, restoreRevision, updateComment, type CreateComment, type UpdateComment } from "./api";

export const collaborationKeys = {
  comments: (noteId: string) => ["collaboration", noteId, "comments"] as const,
  revisions: (noteId: string) => ["collaboration", noteId, "revisions"] as const,
};
const nextPage = (lastPage: { pagination: { has_next: boolean; page: number } }) => lastPage.pagination.has_next ? lastPage.pagination.page + 1 : undefined;
export function useComments(noteId: string) {
  const auth = useAuthRequest();
  return useInfiniteQuery({ queryKey: collaborationKeys.comments(noteId), initialPageParam: 1, queryFn: ({ pageParam }) => listComments(noteId, pageParam, auth), getNextPageParam: nextPage });
}
export function useCreateComment(noteId: string) {
  const auth = useAuthRequest();
  const client = useQueryClient();
  return useMutation({ mutationFn: (payload: CreateComment) => createComment(noteId, payload, auth), onSuccess: () => client.invalidateQueries({ queryKey: collaborationKeys.comments(noteId) }) });
}
export function useUpdateComment(noteId: string) {
  const auth = useAuthRequest();
  const client = useQueryClient();
  return useMutation({ mutationFn: ({ commentId, ...payload }: UpdateComment & { commentId: string }) => updateComment(noteId, commentId, payload, auth), onSuccess: () => client.invalidateQueries({ queryKey: collaborationKeys.comments(noteId) }) });
}
export function useRevisions(noteId: string) {
  const auth = useAuthRequest();
  return useInfiniteQuery({ queryKey: collaborationKeys.revisions(noteId), initialPageParam: 1, queryFn: ({ pageParam }) => listRevisions(noteId, pageParam, auth), getNextPageParam: nextPage });
}
export function useRevision(noteId: string, revisionId: string | null) {
  const auth = useAuthRequest();
  return useQuery({ queryKey: ["collaboration", noteId, "revision", revisionId], enabled: revisionId !== null, queryFn: () => getRevision(noteId, revisionId!, auth), staleTime: Infinity });
}
export function useRestoreRevision(noteId: string) {
  const auth = useAuthRequest();
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ revisionId, expectedVersion }: { revisionId: string; expectedVersion: number }) => restoreRevision(noteId, revisionId, expectedVersion, auth),
    onSuccess: (content) => {
      client.setQueryData(["note-content", noteId], content);
      void client.invalidateQueries({ queryKey: collaborationKeys.revisions(noteId) });
      void client.invalidateQueries({ queryKey: ["note-search"] });
      void client.invalidateQueries({ queryKey: ["note", noteId] });
    },
  });
}

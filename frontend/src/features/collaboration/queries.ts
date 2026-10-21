import { ApiError } from "../../shared/api/api-client";
import { useRef } from "react";
import { newUUID } from "../../shared/ids";
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
  return useInfiniteQuery({ queryKey: collaborationKeys.comments(noteId), initialPageParam: 1, queryFn: ({ pageParam,signal }) => listComments(noteId, pageParam, auth,signal), getNextPageParam: nextPage });
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
  return useInfiniteQuery({ queryKey: collaborationKeys.revisions(noteId), initialPageParam: 1, queryFn: ({ pageParam,signal }) => listRevisions(noteId, pageParam, auth,signal), getNextPageParam: nextPage });
}
export function useRevision(noteId: string, revisionId: string | null) {
  const auth = useAuthRequest();
  return useQuery({ queryKey: ["collaboration", noteId, "revision", revisionId], enabled: revisionId !== null, queryFn: ({signal}) => getRevision(noteId, revisionId!, auth,signal), staleTime: Infinity });
}
export function useRestoreRevision(noteId: string) {
  const auth = useAuthRequest();
  const client = useQueryClient();
  const pending=useRef<{intent:string;operationId:string;uncertain:boolean}|null>(null);
  return useMutation({
    mutationFn: ({ revisionId, expectedVersion }: { revisionId: string; expectedVersion: number }) => {
      const intent=JSON.stringify([noteId,revisionId,expectedVersion]);
      if(pending.current&&pending.current.intent!==intent)throw new Error("上次恢复结果尚未确认，请先重试原操作。");
      pending.current??={intent,operationId:newUUID(),uncertain:false};
      const operationId=pending.current.operationId;
      return restoreRevision(noteId,revisionId,expectedVersion,operationId,auth).catch(error=>{
        if(pending.current?.uncertain)throw new ApiError(503,"上次恢复结果尚未确认，请保留并重试原操作。","DOCUMENT_WRITE_RESULT_UNKNOWN","",{operation_id:operationId});
        if(!(error instanceof ApiError)||error.status>=500)pending.current!.uncertain=true;
        throw error;
      });
    },
    onError:error=>{if(error instanceof ApiError && error.status>=400 && error.status<500&&!pending.current?.uncertain)pending.current=null;},
    onSuccess: (content) => {
      pending.current=null;
      client.setQueryData(["note-content", noteId], content);
      void client.invalidateQueries({ queryKey: collaborationKeys.revisions(noteId) });
      void client.invalidateQueries({ queryKey: ["note-search"] });
      void client.invalidateQueries({ queryKey: ["note", noteId] });
    },
  });
}

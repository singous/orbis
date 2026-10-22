import { useRef } from "react";
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ApiError } from "../../shared/api/api-client";
import { useAuthRequest, type AuthRequestOptions } from "../../shared/auth/use-auth-request";
import { newUUID } from "../../shared/ids";
import { compareDocumentVersions, editDocumentVersion, listDocumentVersions, readDocumentVersion, restoreDocumentVersion, saveDocumentVersion } from "./version-api";

export const versionKeys = {
  list: (id: string) => ["document-versions", id] as const,
  content: (id: string, version: string | null) => ["document-version-content", id, version] as const,
};
export function useDocumentVersions(id: string) {
  const auth = useAuthRequest();
  return useInfiniteQuery({ queryKey: versionKeys.list(id), initialPageParam: null as string | null, queryFn: ({ pageParam, signal }) => listDocumentVersions(id, pageParam, auth, signal), getNextPageParam: page => page.pagination.has_more ? page.pagination.next_cursor : undefined, refetchInterval: 15_000 });
}
export function useDocumentVersion(id: string, version: string | null) {
  const auth = useAuthRequest();
  return useQuery({ queryKey: versionKeys.content(id, version), enabled: version !== null, queryFn: ({ signal }) => readDocumentVersion(id, version!, auth, signal) });
}
export function useDocumentVersionComparison(id: string, from: string | null, to: string | null) {
  const auth = useAuthRequest();
  return useInfiniteQuery({ queryKey: ["document-version-comparison", id, from, to], enabled: from !== null && to !== null, initialPageParam: null as string | null, queryFn: ({ pageParam, signal }) => compareDocumentVersions(id, from!, to!, pageParam, auth, signal), getNextPageParam: page => page.pagination.has_more ? page.pagination.next_cursor : undefined });
}

// Keep the exact request and operation ID while its persistence result is uncertain.
function useVersionWrite<Input, Result>(id: string, write: (id: string, input: Input, operation: string, auth: AuthRequestOptions) => Promise<Result>, onSaved?: (result: Result) => void) {
  const auth = useAuthRequest();
  const client = useQueryClient();
  const pending = useRef<{ intent: string; operation: string; uncertain: boolean } | null>(null);
  return useMutation({
    mutationFn: async (input: Input) => {
      const intent = JSON.stringify(input);
      if (pending.current && pending.current.intent !== intent) throw new Error("上次操作结果尚未确认，请先重试原操作。");
      pending.current ??= { intent, operation: newUUID(), uncertain: false };
      try { return await write(id, input, pending.current.operation, auth); }
      catch (error) {
        const definitive = error instanceof ApiError && error.status >= 400 && error.status < 500;
        if (!definitive) pending.current.uncertain = true;
        if (pending.current.uncertain) throw new ApiError(503, "操作结果尚未确认，请重试原操作。", "DOCUMENT_WRITE_RESULT_UNKNOWN");
        pending.current = null;
        throw error;
      }
    },
    onSuccess: result => {
      pending.current = null;
      void client.invalidateQueries({ queryKey: versionKeys.list(id) });
      void client.invalidateQueries({ queryKey: ["document-version-content", id] });
      onSaved?.(result);
    },
  });
}
export function useSaveDocumentVersion(id: string) { return useVersionWrite(id, saveDocumentVersion); }
export function useEditDocumentVersion(id: string) { return useVersionWrite(id, editDocumentVersion); }
export function useRestoreDocumentVersion(id: string) {
  const client = useQueryClient();
  return useVersionWrite(id, restoreDocumentVersion, result => {
    client.setQueryData(["note-content", id], result);
    void client.invalidateQueries({ queryKey: ["note", id] });
    void client.invalidateQueries({ queryKey: ["note-search"] });
    void client.invalidateQueries({ queryKey: ["collaboration", id, "revisions"] });
  });
}

import type { QueryFunctionContext } from "@tanstack/react-query";
import type { AuthRequestOptions } from "../../shared/auth/use-auth-request";
import { listQuickNoteTags, quickNoteSummary } from "./api";

export function quickNoteTagsQueryOptions(auth: AuthRequestOptions, sessionKey: string) {
  return {
    queryKey: ["quick-notes", sessionKey, "tags"],
    queryFn: ({ signal }: QueryFunctionContext) => listQuickNoteTags(auth, signal),
  };
}

export function quickNoteSummaryQueryOptions(auth: AuthRequestOptions, sessionKey: string) {
  return {
    queryKey: ["quick-notes", sessionKey, "summary"],
    queryFn: ({ signal }: QueryFunctionContext) => quickNoteSummary(auth, signal),
  };
}

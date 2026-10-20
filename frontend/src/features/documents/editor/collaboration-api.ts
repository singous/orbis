import { z } from "zod";
import { ApiError, apiRequest, workspacePath } from "../../../shared/api/api-client";
import { authRequestOptions, type AuthRequestOptions } from "../../../shared/auth/use-auth-request";
import type { CollaborationState } from "./collaboration-provider";

const stateSchema = z.object({
  document_id: z.string().uuid(), epoch: z.string().uuid(),
  protocol_version: z.literal(1), content_version: z.number().int().positive(),
  state: z.string().nullable().optional(), state_vector: z.string().nullable().optional(),
  updates: z.array(z.string()).nullable().optional(), updated_at_ms: z.number().int().nonnegative(),
});
const BOOTSTRAP_BUSY_RETRY_LIMIT = 4;
const BOOTSTRAP_BUSY_RETRY_DELAY_MS = 150;

function retryAfter(delay: number, signal?: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    const abort = () => { clearTimeout(timer); signal?.removeEventListener("abort", abort); reject(signal?.reason ?? new DOMException("The request was aborted", "AbortError")); };
    const timer = setTimeout(() => { signal?.removeEventListener("abort", abort); resolve(); }, delay);
    signal?.addEventListener("abort", abort, { once: true });
    if (signal?.aborted) abort();
  });
}

export async function getDocumentCollaboration(noteId: string, auth: AuthRequestOptions, options: { activate?: boolean; signal?: AbortSignal } = {}): Promise<CollaborationState> {
  for (let attempt = 0; ; attempt += 1) {
    try {
      const result = stateSchema.parse(await apiRequest(workspacePath(auth, `/documents/${noteId}/collaboration`), {
        ...authRequestOptions(auth), method: options.activate ? "POST" : "GET", signal: options.signal,
      }));
      return { ...result, state: result.state ?? undefined, state_vector: result.state_vector ?? undefined, updates: result.updates ?? undefined };
    } catch (error) {
      // Activation returns the same persisted state when retried. A short burst
      // of first-open editors must respect the server's bounded command pool.
      if (!options.activate || !(error instanceof ApiError) || error.code !== "DOCUMENT_OPERATIONS_BUSY" || attempt >= BOOTSTRAP_BUSY_RETRY_LIMIT) throw error;
      await retryAfter(BOOTSTRAP_BUSY_RETRY_DELAY_MS * 2 ** attempt, options.signal);
    }
  }
}

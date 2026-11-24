import { withRequestFeedback } from "../../../shared/api/request-feedback";
import { z } from "zod";
import { ApiError, apiNegotiatedRequest, workspacePath } from "../../../shared/api/api-client";
import { authRequestOptions, type AuthRequestOptions } from "../../../shared/auth/use-auth-request";
import type { CollaborationState } from "./collaboration-provider";
import { resumedSnapshot, type CachedCollaborationSnapshot } from "./collaboration-snapshot-cache";

const stateSchema = z.object({
  document_id: z.string().uuid(), epoch: z.string().uuid(),
  protocol_version: z.literal(1), content_version: z.number().int().positive(),
  state: z.union([z.string(), z.instanceof(Uint8Array)]).nullable().optional(), state_vector: z.string().nullable().optional(),
  updates: z.array(z.string()).nullable().optional(), updated_at_ms: z.number().int().nonnegative(),
});
const BOOTSTRAP_BUSY_RETRY_LIMIT = 4;
const BOOTSTRAP_BUSY_RETRY_DELAY_MS = 150;
const SNAPSHOT_TYPE = "application/vnd.orbis.yjs";
const MAX_STATE_BYTES = 32 << 20;
const MAX_SNAPSHOT_METADATA_BYTES = 4096;

async function readBinarySnapshot(response: Response) {
  const bytes = await response.arrayBuffer();
  const invalid = () => new ApiError(502, "协作快照格式不正确", "API_RESPONSE_INVALID");
  if (bytes.byteLength <= 4) throw invalid();
  const length = new DataView(bytes).getUint32(0);
  const bodyOffset = 4 + length;
  if (length > MAX_SNAPSHOT_METADATA_BYTES || bodyOffset >= bytes.byteLength || bytes.byteLength - bodyOffset > MAX_STATE_BYTES) throw invalid();
  let metadata: unknown;
  try { metadata = JSON.parse(new TextDecoder().decode(new Uint8Array(bytes, 4, length))); }
  catch { throw invalid(); }
  const result = stateSchema.safeParse(metadata);
  if (!result.success || result.data.state || result.data.updates?.length) throw invalid();
  return { ...result.data, state: new Uint8Array(bytes, bodyOffset) };
}

function retryAfter(delay: number, signal?: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    const abort = () => { clearTimeout(timer); signal?.removeEventListener("abort", abort); reject(signal?.reason ?? new DOMException("The request was aborted", "AbortError")); };
    const timer = setTimeout(() => { signal?.removeEventListener("abort", abort); resolve(); }, delay);
    signal?.addEventListener("abort", abort, { once: true });
    if (signal?.aborted) abort();
  });
}

export async function getDocumentCollaboration(noteId: string, auth: AuthRequestOptions, options: { activate?: boolean; signal?: AbortSignal; base?: { epoch: string; content_version: number } } = {}): Promise<CollaborationState> {
  return withRequestFeedback({ ...auth, feedback: { ...auth.feedback, error: auth.feedback?.error ?? (error => !(error instanceof ApiError && error.code === "COLLABORATION_NOT_ENABLED")) } }, async auth => {
  for (let attempt = 0; ; attempt += 1) {
    try {
      const query = options.base ? `?${new URLSearchParams({ epoch: options.base.epoch, after_version: String(options.base.content_version) })}` : "";
      const result = stateSchema.parse(await apiNegotiatedRequest(workspacePath(auth, `/documents/${noteId}/collaboration${query}`), {
        ...authRequestOptions(auth), method: options.activate ? "POST" : "GET", signal: options.signal,
      }, SNAPSHOT_TYPE, readBinarySnapshot));
      if (result.document_id !== noteId) throw new ApiError(502, "协作响应属于其他文档", "API_RESPONSE_INVALID");
      return { ...result, state: result.state ?? undefined, state_vector: result.state_vector ?? undefined, updates: result.updates ?? undefined };
    } catch (error) {
      // Activation returns the same persisted state when retried. A short burst
      // of first-open editors must respect the server's bounded command pool.
      if (!options.activate || !(error instanceof ApiError) || error.code !== "DOCUMENT_OPERATIONS_BUSY" || attempt >= BOOTSTRAP_BUSY_RETRY_LIMIT) throw error;
      await retryAfter(BOOTSTRAP_BUSY_RETRY_DELAY_MS * 2 ** attempt, options.signal);
    }
  }

  });
}

export async function openDocumentCollaboration(
  noteId: string, auth: AuthRequestOptions, activate: boolean, signal: AbortSignal,
  cached: CachedCollaborationSnapshot | undefined,
): Promise<CollaborationState> {
  signal.throwIfAborted();
  if (cached?.document_id === noteId) {
    try {
      const reply = await getDocumentCollaboration(noteId, auth, { activate, signal, base: cached });
      if (reply.state) return reply;
      const resumed = resumedSnapshot(cached, reply);
      if (resumed) return resumed;
    } catch (error) {
      if (!(error instanceof ApiError && error.code === "COLLABORATION_NOT_ENABLED" && activate)) throw error;
    }
  }
  return getDocumentCollaboration(noteId, auth, { activate, signal });
}

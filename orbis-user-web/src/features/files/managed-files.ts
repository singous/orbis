import { z } from "zod";

import { apiBlobRequest, apiRequest } from "../../shared/api/api-client";
import { authRequestOptions, type AuthRequestOptions } from "../../shared/auth/use-auth-request";

const FILE_REFERENCE = /^orbis-file:([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/;
const uploadSchema = z.object({ id: z.string().uuid(), upload_status: z.literal("completed") });

export function fileReference(id: string): string {
  const reference = `orbis-file:${id}`;
  if (!FILE_REFERENCE.test(reference)) throw new Error("文件标识无效");
  return reference;
}

export function parseFileReference(value: string): string | null {
  return FILE_REFERENCE.exec(value)?.[1] ?? null;
}

export async function uploadManagedFile(file: File, auth: AuthRequestOptions, signal?: AbortSignal): Promise<string> {
  const body = new FormData();
  body.append("file", file);
  const uploaded = uploadSchema.parse(await apiRequest("/files", { method: "POST", body, signal, ...authRequestOptions(auth) }));
  return fileReference(uploaded.id);
}

/** One editor or preview owns this cache; no private object URLs survive disposal. */
export function createManagedFiles(getAuth: () => AuthRequestOptions | null) {
  const pending = new Map<string, Promise<string>>();
  const objectUrls = new Set<string>();
  const abort = new AbortController();
  let disposed = false;
  const ensureActive = () => {
    if (disposed) throw new DOMException("File session disposed", "AbortError");
  };
  return {
    async upload(file: File): Promise<string> {
      ensureActive();
      const auth = getAuth();
      if (!auth) throw new Error("请先登录后上传文件");
      const reference = await uploadManagedFile(file, auth, abort.signal);
      ensureActive();
      if (!getAuth()) throw new DOMException("File session changed", "AbortError");
      return reference;
    },
    async resolve(value: string): Promise<string> {
      ensureActive();
      const id = parseFileReference(value);
      if (!id) {
        if (value.startsWith("orbis-file:")) throw new Error("文件标识无效");
        return value;
      }
      const auth = getAuth();
      if (!auth) throw new Error("请先登录后读取文件");
      const existing = pending.get(id);
      if (existing) return existing;
      const result = apiBlobRequest(`/files/${id}/content`, { signal: abort.signal, ...authRequestOptions(auth) }).then((blob) => {
        ensureActive();
        if (!getAuth()) throw new DOMException("File session changed", "AbortError");
        const url = URL.createObjectURL(blob);
        objectUrls.add(url);
        return url;
      }).catch((error: unknown) => { pending.delete(id); throw error; });
      pending.set(id, result);
      return result;
    },
    dispose() {
      disposed = true;
      abort.abort();
      for (const url of objectUrls) URL.revokeObjectURL(url);
      objectUrls.clear();
      pending.clear();
    },
  };
}

export type ManagedFiles = ReturnType<typeof createManagedFiles>;

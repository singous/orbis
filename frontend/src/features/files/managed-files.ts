import { z } from "zod";

import { apiBlobRequest, apiRequest, workspacePath } from "../../shared/api/api-client";
import { authRequestOptions, type AuthRequestOptions } from "../../shared/auth/use-auth-request";

const FILE_REFERENCE = /^orbis-file:([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/;
const uploadSchema = z.object({ id: z.string().uuid(), size_bytes: z.number().int().nonnegative(), sha256: z.string().length(64) });

export function fileReference(id: string): string {
  const reference = `orbis-file:${id}`;
  if (!FILE_REFERENCE.test(reference)) throw new Error("文件标识无效");
  return reference;
}

export function parseFileReference(value: string): string | null {
  return FILE_REFERENCE.exec(value)?.[1] ?? null;
}

export type ManagedFilePath = "/assets" | "/quick-note-assets";
export async function uploadManagedFile(file: File, auth: AuthRequestOptions, signal?: AbortSignal, path: ManagedFilePath = "/assets"): Promise<string> {
  const body = new FormData();
  body.append("file", file);
  const uploaded = uploadSchema.parse(await apiRequest(workspacePath(auth, path), { method: "POST", body, signal, ...authRequestOptions(auth) }));
  return fileReference(uploaded.id);
}

export function createObjectURLCache() {
  const pending = new Map<string, Promise<string>>();
  const objectUrls = new Set<string>();
  return {
    resolve(id: string, readBlob: () => Promise<Blob>, verifyCurrent: () => void): Promise<string> {
      const existing = pending.get(id);
      if (existing) return existing;
      const request = readBlob().then((blob) => {
        // 校验与创建 URL 之间不跨异步边界，避免销毁后的响应生成新 URL。
        verifyCurrent();
        const url = URL.createObjectURL(blob);
        objectUrls.add(url);
        return url;
      }).catch((error: unknown) => { pending.delete(id); throw error; });
      pending.set(id, request);
      return request;
    },
    dispose() {
      for (const url of objectUrls) URL.revokeObjectURL(url);
      objectUrls.clear();
      pending.clear();
    },
  };
}

/** One editor or preview owns this cache; no private object URLs survive disposal. */
export function createManagedFiles(getAuth: () => AuthRequestOptions | null, path: ManagedFilePath = "/assets") {
  const cache = createObjectURLCache();
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
      const reference = await uploadManagedFile(file, auth, abort.signal, path);
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
      return cache.resolve(id, () => apiBlobRequest(workspacePath(auth, `${path}/${id}/content`), { signal: abort.signal, ...authRequestOptions(auth) }), () => {
        ensureActive();
        if (!getAuth()) throw new DOMException("File session changed", "AbortError");
      });
    },
    dispose() {
      disposed = true;
      abort.abort();
      cache.dispose();
    },
  };
}

export type ManagedFiles = ReturnType<typeof createManagedFiles>;

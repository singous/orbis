import { useEffect, useMemo, type ReactNode } from "react";
import { FileContentContext } from "../files/FileContent";
import { parseFileReference } from "../files/managed-files";
import { readSharedFile } from "./api";

/** Anonymous resources are scoped to the live link and current document. */
export function PublicShareFiles({
  token,
  noteId,
  children,
}: {
  token: string;
  noteId: string;
  children: ReactNode;
}) {
  const files = useMemo(() => {
    const controller = new AbortController();
    const pending = new Map<string, Promise<string>>();
    const urls = new Set<string>();
    let disposed = false;
    return {
      consumers: 0,
      scope: `share:${token}:${noteId}`,
      async resolve(reference: string) {
        const id = parseFileReference(reference);
        if (!id || disposed) throw new Error("分享附件不可用");
        const existing = pending.get(id);
        if (existing) return existing;
        const request = readSharedFile(token, noteId, id, controller.signal)
          .then((blob) => {
            if (disposed)
              throw new DOMException("Share reader disposed", "AbortError");
            const url = URL.createObjectURL(blob);
            urls.add(url);
            return url;
          })
          .catch((error: unknown) => {
            pending.delete(id);
            throw error;
          });
        pending.set(id, request);
        return request;
      },
      dispose() {
        disposed = true;
        controller.abort();
        for (const url of urls) URL.revokeObjectURL(url);
        pending.clear();
        urls.clear();
      },
    };
  }, [token, noteId]);
  useEffect(() => {
    files.consumers += 1;
    return () => {
      files.consumers -= 1;
      queueMicrotask(() => {
        if (!files.consumers) files.dispose();
      });
    };
  }, [files]);
  return (
    <FileContentContext.Provider value={files}>
      {children}
    </FileContentContext.Provider>
  );
}

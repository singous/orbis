import { useEffect, useMemo, type ReactNode } from "react";
import { FileContentContext } from "../files/FileContent";
import { createObjectURLCache, parseFileReference } from "../files/managed-files";
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
    const cache = createObjectURLCache();
    let disposed = false;
    return {
      consumers: 0,
      scope: `share:${token}:${noteId}`,
      async resolve(reference: string) {
        const id = parseFileReference(reference);
        if (!id || disposed) throw new Error("分享附件不可用");
        return cache.resolve(id, () => readSharedFile(token, noteId, id, controller.signal), () => {
          if (disposed)
            throw new DOMException("Share reader disposed", "AbortError");
        });
      },
      dispose() {
        disposed = true;
        controller.abort();
        cache.dispose();
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

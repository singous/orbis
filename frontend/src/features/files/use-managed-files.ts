import { useContext, useEffect, useMemo, useRef } from "react";
import { useStore } from "zustand";
import { QueryClientContext } from "@tanstack/react-query";

import { authStore, getAuthSessionKey } from "../../shared/auth/auth-store";
import { useOptionalAuthRequest } from "../../shared/auth/use-auth-request";
import { createManagedFiles, type ManagedFilePath } from "./managed-files";

/** Stable editor callbacks always use the current login/workspace-scoped cache. */
export function useManagedFiles(path: ManagedFilePath = "/assets") {
  const queryClient = useContext(QueryClientContext);
  const queryClientRef = useRef(queryClient);
  queryClientRef.current = queryClient;
  const auth = useOptionalAuthRequest();
  const authRef = useRef(auth);
  authRef.current = auth;
  const sessionKey = useStore(authStore, getAuthSessionKey);
  const scope = useMemo(() => ({
    consumers: 0,
    files: createManagedFiles(() => getAuthSessionKey(authStore.getState()) === sessionKey ? authRef.current : null, path),
  }), [sessionKey, path]);
  const current = useRef(scope);
  current.current = scope;
  useEffect(() => {
    scope.consumers += 1;
    return () => {
      scope.consumers -= 1;
      // React StrictMode immediately remounts effects. Dispose after that same
      // microtask so its mounted reader never receives an already-revoked URL.
      queueMicrotask(() => { if (!scope.consumers) scope.files.dispose(); });
    };
  }, [scope]);
  const operations = useMemo(() => ({
    resolve: (value: string) => current.current.files.resolve(value),
    upload: async (file: File) => {
      const scope = current.current;
      const client = queryClientRef.current;
      const result = await scope.files.upload(file);
      if (path === "/assets" && scope === current.current) void client?.invalidateQueries({ queryKey: ["global-search"] });
      return result;
    },
  }), [path]);
  return useMemo(() => ({ ...operations, scope: sessionKey }), [operations, sessionKey]);
}

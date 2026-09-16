import { useEffect, useMemo, useRef } from "react";
import { useStore } from "zustand";

import { authStore, getAuthSessionKey } from "../../shared/auth/auth-store";
import { useOptionalAuthRequest } from "../../shared/auth/use-auth-request";
import { createManagedFiles } from "./managed-files";

/** Stable editor callbacks always use the current login/workspace-scoped cache. */
export function useManagedFiles() {
  const auth = useOptionalAuthRequest();
  const authRef = useRef(auth);
  authRef.current = auth;
  const sessionKey = useStore(authStore, getAuthSessionKey);
  const scope = useMemo(() => ({
    consumers: 0,
    files: createManagedFiles(() => getAuthSessionKey(authStore.getState()) === sessionKey ? authRef.current : null),
  }), [sessionKey]);
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
  return useMemo(() => ({
    resolve: (value: string) => current.current.files.resolve(value),
    upload: (file: File) => current.current.files.upload(file),
  }), []);
}

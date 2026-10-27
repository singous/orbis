import { MutationCache, QueryCache, QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useEffect, useState, type ReactNode } from "react";
import { useStore } from "zustand";

import { clearToasts, Toaster } from "../shared/ui/Toast";
import { AUTH_STORAGE_KEY, authStore, getAuthSessionKey } from "../shared/auth/auth-store";
import { markErrorHandled, reportRequestError } from "../shared/api/request-feedback";

function SessionProviders({ children }: { children: ReactNode }) {
  const [queryClient] = useState(() => new QueryClient({
    queryCache: new QueryCache({ onError: (error, query) => {
      if (query.meta?.silent === true) markErrorHandled(error);
      else reportRequestError(error);
    } }),
    mutationCache: new MutationCache({ onError: reportRequestError }),
    defaultOptions: {
      queries: {
        retry: false,
        refetchOnWindowFocus: query => query.state.status !== "error",
        staleTime: 15_000,
      },
    },
  }));
  useEffect(() => () => queryClient.clear(), [queryClient]);
  return (
    <QueryClientProvider client={queryClient}>
      {children}
    </QueryClientProvider>
  );
}

export function AppProviders({ children }: { children: ReactNode }) {
  useEffect(() => authStore.subscribe((next, previous) => {
    if (getAuthSessionKey(next) !== getAuthSessionKey(previous)) clearToasts();
  }), []);
  useEffect(() => {
    const sync = (event: StorageEvent) => { if (event.key === AUTH_STORAGE_KEY || event.key === null) authStore.getState().syncSession(); };
    window.addEventListener("storage", sync);
    return () => window.removeEventListener("storage", sync);
  }, []);
  const sessionKey = useStore(authStore, getAuthSessionKey);
  // Remount observers too: pending mutations retain the client of their session.
  return <><SessionProviders key={sessionKey}>{children}</SessionProviders><Toaster /></>;
}

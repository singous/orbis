import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useEffect, useState, type ReactNode } from "react";
import { useStore } from "zustand";

import { Toaster } from "../shared/ui/Toast";
import { AUTH_STORAGE_KEY, authStore, getAuthSessionKey } from "../shared/auth/auth-store";

function SessionProviders({ children }: { children: ReactNode }) {
  const [queryClient] = useState(() => new QueryClient({
    defaultOptions: {
      queries: {
        retry: 1,
        staleTime: 15_000,
      },
    },
  }));
  useEffect(() => () => queryClient.clear(), [queryClient]);
  return (
    <QueryClientProvider client={queryClient}>
      {children}
      <Toaster />
    </QueryClientProvider>
  );
}

export function AppProviders({ children }: { children: ReactNode }) {
  useEffect(() => {
    const sync = (event: StorageEvent) => { if (event.key === AUTH_STORAGE_KEY || event.key === null) authStore.getState().syncSession(); };
    window.addEventListener("storage", sync);
    return () => window.removeEventListener("storage", sync);
  }, []);
  const sessionKey = useStore(authStore, getAuthSessionKey);
  // Remount observers too: pending mutations retain the client of their session.
  return <SessionProviders key={sessionKey}>{children}</SessionProviders>;
}

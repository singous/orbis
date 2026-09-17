import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useEffect, useState, type ReactNode } from "react";
import { useStore } from "zustand";

import { Toaster } from "../shared/ui/Toast";
import { authStore, getAuthSessionKey } from "../shared/auth/auth-store";

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
  const sessionKey = useStore(authStore, getAuthSessionKey);
  // Remount observers too: pending mutations retain the client of their session.
  return <SessionProviders key={sessionKey}>{children}</SessionProviders>;
}

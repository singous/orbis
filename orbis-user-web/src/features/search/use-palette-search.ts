import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useStore } from "zustand";

import { authStore, getAuthSessionKey } from "../../shared/auth/auth-store";
import { useOptionalAuthRequest } from "../../shared/auth/use-auth-request";
import { searchWorkspace, type SearchFilters } from "./api";
import { SEARCH_DEBOUNCE_MS } from "./search-state";

const PALETTE_SCOPE_STALE_TIME_MS = 60_000;
const discoveryFilters: SearchFilters = { q: "", range: "current", type: "all", status: "active", page: 1 };

export type PaletteSearchOptions = { enabled: boolean; composing?: boolean };

/** Keyword input is deferred; settled-keyword refinements use the new scope immediately. */
export function usePaletteSearch(filters: SearchFilters, { enabled, composing = false }: PaletteSearchOptions) {
  const auth = useOptionalAuthRequest();
  const sessionKey = useStore(authStore, getAuthSessionKey);
  const queryClient = useQueryClient();
  const active = enabled && Boolean(auth);
  const q = filters.q.trim();
  const [settled, setSettled] = useState(() => ({ sessionKey, q: "" }));
  const pendingInput = active && (composing || settled.sessionKey !== sessionKey || settled.q !== q);
  const normalizedFilters: SearchFilters = { ...filters, q };

  useEffect(() => {
    if (!active || !q) {
      setSettled(current => current.sessionKey === sessionKey && !current.q ? current : { sessionKey, q: "" });
      return;
    }
    if (composing) return;
    const timer = window.setTimeout(() => setSettled({ sessionKey, q }), SEARCH_DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
  }, [active, composing, q, sessionKey]);

  // Raw filters own the observer even during debounce, so old-scope data cannot flash.
  const results = useQuery({
    queryKey: ["global-search", sessionKey, "palette", normalizedFilters],
    queryFn: ({ signal }) => searchWorkspace(normalizedFilters, auth!, signal),
    enabled: active && !pendingInput && Boolean(q),
    retry: false,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  });
  const scopes = useQuery({
    queryKey: ["global-search-scopes", sessionKey, "palette"],
    queryFn: ({ signal }) => searchWorkspace(discoveryFilters, auth!, signal),
    enabled: active,
    staleTime: PALETTE_SCOPE_STALE_TIME_MS,
    retry: false,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  });

  useEffect(() => {
    if (!active || pendingInput) void queryClient.cancelQueries({ queryKey: ["global-search", sessionKey, "palette"] });
    if (!active) void queryClient.cancelQueries({ queryKey: ["global-search-scopes", sessionKey, "palette"], exact: true });
  }, [active, pendingInput, queryClient, sessionKey]);

  return {
    results,
    scopes,
    pendingInput,
    searchedFilters: active && !pendingInput && q ? normalizedFilters : null,
  };
}

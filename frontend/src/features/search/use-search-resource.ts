import { useQuery } from "@tanstack/react-query";
import { useStore } from "zustand";
import { authStore, getAuthSessionKey } from "../../shared/auth/auth-store";
import { useAuthRequest } from "../../shared/auth/use-auth-request";
import { lookupSearchResource, type SearchType } from "./api";

/** Exact lookup is authorized separately from whichever list pages are loaded. */
export function useSearchResource(type: SearchType, id: string, status: "active" | "archived") {
  const auth = useAuthRequest();
  const sessionKey = useStore(authStore, getAuthSessionKey);
  return useQuery({
    queryKey: ["global-search", sessionKey, "resource", type, id, status],
    queryFn: ({ signal }) => lookupSearchResource(type, id, status, auth, signal),
    retry: false,
  });
}

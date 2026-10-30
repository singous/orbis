import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useStore } from "zustand";
import { authStore, getAuthSessionKey } from "../../shared/auth/auth-store";
import { useAuthRequest } from "../../shared/auth/use-auth-request";
import { listQuickNotes, listQuickNoteTags, quickNoteSummary } from "../quick-notes/api";

export function useHomeQuickNotes() {
  const auth = useAuthRequest();
  const sessionKey = useStore(authStore, getAuthSessionKey);
  const client = useQueryClient();
  const prefix = ["quick-notes", sessionKey];
  const summary = useQuery({ queryKey: [...prefix, "summary"], queryFn: ({ signal }) => quickNoteSummary(auth, signal) });
  const tags = useQuery({ queryKey: [...prefix, "tags"], queryFn: ({ signal }) => listQuickNoteTags(auth, signal) });
  const recent = useQuery({ queryKey: [...prefix, "home"], queryFn: ({ signal }) => listQuickNotes(auth, { q: "", tag: "", sort: "updated", deleted: false }, 1, signal) });
  return { summary, tags, recent, refresh: () => { void client.invalidateQueries({ queryKey: prefix }); } };
}

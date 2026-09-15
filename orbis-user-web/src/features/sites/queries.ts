import { useQuery } from "@tanstack/react-query";
import { useAuthRequest } from "../../shared/auth/use-auth-request";
import { getSite, listPublishableNotes, listSiteReleases, listSites } from "./api";

export function useSites(page = 1) {
  const auth = useAuthRequest();
  return useQuery({ queryKey: ["sites", page], queryFn: () => listSites(auth, page) });
}
export function useSite(id: string) {
  const auth = useAuthRequest();
  return useQuery({ queryKey: ["site", id], queryFn: () => getSite(id, auth), enabled: Boolean(id) });
}
export function useSiteReleases(id: string, page = 1) {
  const auth = useAuthRequest();
  return useQuery({ queryKey: ["site-releases", id, page], queryFn: () => listSiteReleases(id, auth, page), enabled: Boolean(id) });
}
export function usePublishableNotes(query: string, page = 1) {
  const auth = useAuthRequest();
  return useQuery({ queryKey: ["publishable-notes", query, page], queryFn: () => listPublishableNotes(query, page, auth) });
}

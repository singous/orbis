import { apiRequest } from "../../shared/api/api-client";
import { authRequestOptions, type AuthRequestOptions } from "../../shared/auth/use-auth-request";
import { noteSearchResponseSchema } from "../../shared/api/schemas";
import { siteListSchema, sitePreviewSchema, siteReleaseListSchema, siteSchema, siteSnapshotSchema, siteSourcesSchema, type SiteConfig } from "./schemas";

export async function listSites(auth: AuthRequestOptions, page = 1) {
  return siteListSchema.parse(await apiRequest(`/sites?page=${page}&page_size=20`, authRequestOptions(auth)));
}
export async function getSite(id: string, auth: AuthRequestOptions) {
  return siteSchema.parse(await apiRequest(`/sites/${id}`, authRequestOptions(auth)));
}
export async function createSite(config: SiteConfig, auth: AuthRequestOptions) {
  return siteSchema.parse(await apiRequest("/sites", { ...authRequestOptions(auth), method: "POST", body: config }));
}
export async function saveSite(id: string, config: SiteConfig, expectedVersion: number, auth: AuthRequestOptions) {
  return siteSchema.parse(await apiRequest(`/sites/${id}`, { ...authRequestOptions(auth), method: "PUT", body: { ...config, expected_version: expectedVersion } }));
}
export async function previewSite(id: string, auth: AuthRequestOptions) {
  return sitePreviewSchema.parse(await apiRequest(`/sites/${id}/preview`, authRequestOptions(auth)));
}
export async function getSiteSources(id: string, auth: AuthRequestOptions) {
  return siteSourcesSchema.parse(await apiRequest(`/sites/${id}/sources`, authRequestOptions(auth)));
}
export async function publishSite(id: string, auth: AuthRequestOptions, expectedSourceFingerprint?: string) {
  return siteSnapshotSchema.parse(await apiRequest(`/sites/${id}/publish`, {
    ...authRequestOptions(auth),
    method: "POST",
    ...(expectedSourceFingerprint ? { body: { expected_source_fingerprint: expectedSourceFingerprint } } : {}),
  }));
}
export async function listSiteReleases(id: string, auth: AuthRequestOptions, page = 1) {
  return siteReleaseListSchema.parse(await apiRequest(`/sites/${id}/releases?page=${page}&page_size=20`, authRequestOptions(auth)));
}
export async function activateSiteRelease(id: string, releaseId: string, auth: AuthRequestOptions) {
  return siteSchema.parse(await apiRequest(`/sites/${id}/releases/${releaseId}/activate`, { ...authRequestOptions(auth), method: "POST" }));
}
export async function unpublishSite(id: string, auth: AuthRequestOptions) {
  return siteSchema.parse(await apiRequest(`/sites/${id}/unpublish`, { ...authRequestOptions(auth), method: "POST" }));
}
export async function getPublicSite(slug: string) {
  return siteSnapshotSchema.parse(await apiRequest(`/public/sites/${encodeURIComponent(slug)}`));
}
export async function listPublishableNotes(query: string, page: number, auth: AuthRequestOptions) {
  const params = new URLSearchParams({ q: query.trim(), page: String(page), page_size: "20" });
  return noteSearchResponseSchema.parse(await apiRequest(`/notes?${params}`, authRequestOptions(auth)));
}

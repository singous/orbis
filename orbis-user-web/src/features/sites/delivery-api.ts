import { ApiError, apiRequest } from "../../shared/api/api-client";
import { publicPageDeliverySchema, publicSearchSchema, siteManifestSchema } from "./delivery-schemas";

export function encodedPagePath(slug: string) {
  return slug.split("/").map(encodeURIComponent).join("/");
}

function expectedRelease(releaseId: string | null) {
  return releaseId ? `?${new URLSearchParams({ expected_release_id: releaseId })}` : "";
}

function verifyRelease(actual: string | null, expected: string | null) {
  if (actual !== expected) throw new ApiError(409, "发布版本已变化，请刷新文档。", "SITE_RELEASE_CHANGED");
}

export async function getSiteManifest(slug: string, signal?: AbortSignal) {
  return siteManifestSchema.parse(await apiRequest(`/public/sites/${encodeURIComponent(slug)}/manifest`, { signal }));
}

export async function getPublicPage(slug: string, pageSlug: string, releaseId: string | null, signal?: AbortSignal) {
  const data = publicPageDeliverySchema.parse(await apiRequest(`/public/sites/${encodeURIComponent(slug)}/pages/${encodedPagePath(pageSlug)}${expectedRelease(releaseId)}`, { signal }));
  verifyRelease(data.release_id, releaseId);
  return data;
}

export async function getPublicSearch(slug: string, releaseId: string | null, signal?: AbortSignal) {
  const data = publicSearchSchema.parse(await apiRequest(`/public/sites/${encodeURIComponent(slug)}/search${expectedRelease(releaseId)}`, { signal }));
  verifyRelease(data.release_id, releaseId);
  return data;
}

export async function getPublicMarkdown(slug: string, pageSlug: string, releaseId: string | null): Promise<string> {
  const response = await fetch(`/s/${encodeURIComponent(slug)}/pages/${encodedPagePath(pageSlug)}.md${expectedRelease(releaseId)}`, { cache: "no-store" });
  if (!response.ok) throw new ApiError(response.status, response.status === 409 ? "发布版本已变化，请刷新后再复制。" : "无法读取页面 Markdown，请重试。", response.status === 409 ? "SITE_RELEASE_CHANGED" : "SITE_EXPORT_FAILED");
  if (!(response.headers.get("Content-Type") || "").match(/^text\/(markdown|plain)(?:;|$)/i)) throw new Error("未收到有效的页面 Markdown");
  return response.text();
}

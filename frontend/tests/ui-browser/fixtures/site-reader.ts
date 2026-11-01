import { expect, type Page } from "@playwright/test";

export const releaseId = "00000000-0000-4000-8000-000000000001";
const workspaceId = "00000000-0000-4000-8000-000000000002";
export const siteId = "00000000-0000-4000-8000-000000000003";
export const user = { id: "00000000-0000-4000-8000-000000000004", email: "reader@example.com", display_name: "阅读成员", bio: null, avatar_asset_id: null, preferred_workspace_id: workspaceId, profile_version: 1, created_at_ms: 1, updated_at_ms: 1 };
export const workspace = { id: workspaceId, name: "阅读工作空间", role: "owner", created_at_ms: 1, updated_at_ms: 1 };
const pages = [
  { slug: "start", title: "快速开始", group: "指南", parent_slug: null, section: "指南", description: "了解安装与使用方式", updated_at_ms: 1 },
  { slug: "guides/install", title: "安装指南", group: "指南", parent_slug: "start", section: "指南", description: "", updated_at_ms: 1 },
];
const branding = { logo_url: null, links: [{ label: "产品首页", url: "https://example.com" }], footer_links: [{ label: "联系我们", url: "https://example.com/contact" }], cta: { label: "开始使用", url: "https://example.com/start" }, theme: "system" };
export const manifest = { name: "公开手册", slug: "guide", description: "知识指南", site_kind: "handbook", accent_color: "#0f766e", branding, redirects: {}, release_id: releaseId, release_number: 1, published_at_ms: 1, pages };
export const publishedPages = pages.map((metadata, index) => ({ ...metadata, plain_text: index ? "安装专用正文" : "当前页面正文", blocks: [
  { id: `heading-${index}`, type: "heading", props: { level: 2 }, content: [{ text: "开始阅读", marks: [], href: null }], children: [] },
  { id: `paragraph-${index}`, type: "paragraph", props: {}, content: [{ text: index ? "安装专用正文" : "当前页面正文", marks: [], href: null }], children: [] },
] }));

export async function readerHTTP(page: Page, baseURL: string | undefined) {
  const requests: string[] = [];
  page.on("request", request => requests.push(new URL(request.url()).pathname));
  // React delivery uses Vite's document entry and the real API response parsers.
  await page.route("**/s/guide**", async route => route.fulfill({ response: await route.fetch({ url: `${baseURL}/login` }) }));
  await page.route("**/api/v1/**", async route => {
    const url = new URL(route.request().url());
    expect(route.request().method()).toBe("GET");
    let data: unknown;
    if (url.pathname.endsWith("/manifest")) data = manifest;
    else if (url.pathname.endsWith("/search")) {
      expect(url.searchParams.get("release_id")).toBe(releaseId);
      data = { release_id: releaseId, items: [{ slug: "start", title: "快速开始", plain_text: "安装流程" }, { slug: "guides/install", title: "安装指南", plain_text: "安装专用正文" }], pagination: { page: 1, page_size: 100, total: 2 } };
    } else if (url.pathname.includes("/public/sites/guide/pages/")) {
      expect(url.searchParams.get("release_id")).toBe(releaseId);
      data = url.pathname.endsWith("/start") ? publishedPages[0] : publishedPages[1];
    } else if (url.pathname.endsWith(`/sites/${siteId}/preview`)) data = { snapshot: { ...manifest, release_id: null, release_number: null, published_at_ms: null }, pages: publishedPages, source_fingerprint: "a".repeat(64) };
    else if (url.pathname.endsWith("/me")) data = user;
    else throw new Error(`Unexpected reader request: ${url.pathname}`);
    await route.fulfill({ json: { code: "OK", message: "", request_id: "reader-chrome", data } });
  });
  return requests;
}

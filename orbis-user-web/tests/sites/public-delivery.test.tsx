import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, expect, it, vi } from "vitest";
import { PublicSiteDelivery as PublicSitePage } from "../../src/features/sites/PublicSiteDelivery";

const firstRelease = "0190a111-1111-7111-8111-111111111111";
const nextRelease = "0190a111-1111-7111-8111-111111111112";
const meta = (slug: string, title: string) => ({ slug, title, group: "指南", parent_slug: null, section: "指南", description: "", updated_at_ms: 1 });
const manifest = { name: "开发者文档", slug: "guide", description: "知识指南", site_kind: "handbook", accent_color: "#0f766e", branding: { logo_url: null, links: [], footer_links: [], cta: null, theme: "system" }, redirects: {}, release_id: firstRelease, release_number: 1, published_at_ms: 1, pages: [meta("start", "快速开始"), meta("guides/install", "安装指南")] };
const body = (slug: string, title: string, text: string) => ({ ...meta(slug, title), plain_text: text, blocks: { schema_version: 2, editor: "blocknote", blocks: [{ id: "public-0", type: "paragraph", props: {}, content: [{ type: "text", text }], children: [] }] } });
const firstPage = body("start", "快速开始", "当前页面正文");
const secondPage = body("guides/install", "安装指南", "安装专用正文");
const response = (data: unknown, status = 200, code = "OK") => new Response(JSON.stringify({ code, message: code, request_id: "test", data }), { status, headers: { "Content-Type": "application/json" } });
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
function reader() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}><MemoryRouter initialEntries={["/s/guide/start"]}><Routes><Route path="/s/:slug/*" element={<PublicSitePage />} /></Routes></MemoryRouter></QueryClientProvider>);
}

it("uses validated server bootstrap content while API reads are still pending", () => {
  const bootstrap = document.createElement("script");
  bootstrap.id = "orbis-site-bootstrap";
  bootstrap.type = "application/json";
  bootstrap.textContent = JSON.stringify({ manifest: { ...manifest, canonical_base_url: "https://docs.example.com/s/guide" }, page: { release_id: firstRelease, page: firstPage } });
  document.body.appendChild(bootstrap);
  vi.stubGlobal("fetch", vi.fn(() => new Promise<Response>(() => {})));
  reader();
  expect(screen.getByText("当前页面正文")).toBeVisible();
  expect(document.querySelector('link[rel="canonical"]')).toHaveAttribute("href", "https://docs.example.com/s/guide/start");
  expect(document.getElementById("orbis-site-bootstrap")).toBeNull();
});

it("loads navigation and only the current body, fetching the separate search index on demand", async () => {
  const urls: string[] = [];
  vi.stubGlobal("fetch", vi.fn(async (input: string) => {
    urls.push(input);
    const url = new URL(input, "https://example.com");
    if (url.pathname.endsWith("/manifest")) return response({ ...manifest, canonical_base_url: "https://docs.example.com/s/guide" });
    if (url.pathname.endsWith("/pages/start")) {
      expect(url.searchParams.get("expected_release_id")).toBe(firstRelease);
      return response({ release_id: firstRelease, page: firstPage });
    }
    if (decodeURIComponent(url.pathname).endsWith("/pages/guides/install")) return response({ release_id: firstRelease, page: secondPage });
    if (url.pathname.endsWith("/search")) return response({ release_id: firstRelease, pages: [firstPage, secondPage].map(({ blocks: _blocks, ...page }) => page) });
    return response(null, 404, "SITE_NOT_FOUND");
  }));
  reader();
  await screen.findByText("当前页面正文");
  expect(urls.some((url) => /\/search|\/guides/.test(url))).toBe(false);
  expect(urls).not.toContain("/api/public/sites/guide");
  await userEvent.click(screen.getByRole("button", { name: "搜索文档", exact: true }));
  await userEvent.type(screen.getByRole("combobox", { name: "搜索文档", exact: true }), "安装专用正文");
  await userEvent.click(await screen.findByRole("option", { name: /安装指南/ }));
  await screen.findByText("安装专用正文");
  expect(screen.queryByText("当前页面正文")).not.toBeInTheDocument();
  expect(urls.filter((url) => url.includes("/search"))).toHaveLength(1);
  expect(document.querySelector('link[rel="canonical"]')).toHaveAttribute("href", "https://docs.example.com/s/guide/guides/install");
  expect(document.querySelector('meta[property="og:url"]')).toHaveAttribute("content", "https://docs.example.com/s/guide/guides/install");
});

it("refreshes a changed release before combining page content with navigation", async () => {
  let manifestReads = 0;
  const urls: string[] = [];
  vi.stubGlobal("fetch", vi.fn(async (input: string) => {
    urls.push(input);
    const url = new URL(input, "https://example.com");
    if (url.pathname.endsWith("/manifest")) {
      manifestReads += 1;
      return response(manifestReads === 1 ? manifest : { ...manifest, release_id: nextRelease, release_number: 2 });
    }
    if (url.pathname.endsWith("/pages/start")) return url.searchParams.get("expected_release_id") === firstRelease
      ? response(null, 409, "SITE_RELEASE_CHANGED")
      : response({ release_id: nextRelease, page: { ...firstPage, plain_text: "新版本正文", blocks: body("start", "快速开始", "新版本正文").blocks } });
    return response(null, 404, "SITE_NOT_FOUND");
  }));
  reader();
  await screen.findByText("新版本正文");
  await waitFor(() => expect(manifestReads).toBe(2));
  expect(urls.filter((url) => url.includes("/pages/start"))).toHaveLength(2);
  expect(screen.queryByText("当前页面正文")).not.toBeInTheDocument();
});

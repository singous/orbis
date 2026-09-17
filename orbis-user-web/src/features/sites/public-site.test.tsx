import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, expect, it, vi } from "vitest";
import { PublicSitePage, SitePreviewPage } from "./PublicSitePage";
import { authStore } from "../../shared/auth/auth-store";
import { SiteReader } from "./SiteReader";
import type { SiteSnapshot } from "./schemas";

const snapshot: SiteSnapshot = { name: "公开手册", slug: "guide", description: "", site_kind: "handbook", accent_color: "#0f766e", release_id: "r1", release_number: 1, published_at_ms: 1, pages: [
  { slug: "a", title: "第一篇", group: "起步", plain_text: "已发布正文", blocks: { schema_version: 2, blocks: [{ type: "paragraph", content: "已发布正文" }] } },
  { slug: "b", title: "第二篇", group: "进阶", plain_text: "", blocks: {} },
  { slug: "c", title: "第三篇", group: "起步", plain_text: "", blocks: {} },
] };
afterEach(() => { cleanup(); vi.unstubAllGlobals(); authStore.getState().clearSession(); });

it("removes an old authenticated preview when current content fails publication validation", async () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  client.setQueryData(["site-preview", "site-id"], snapshot);
  authStore.setState({ accessToken: "preview-test-token", refreshToken: null });
  vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ code: "SITE_CONTENT_UNSAFE", message: "文档包含不可公开的链接", request_id: "test", data: null }), { status: 422, headers: { "Content-Type": "application/json" } })));
  render(<QueryClientProvider client={client}><MemoryRouter initialEntries={["/sites/site-id/preview"]}><Routes><Route path="/sites/:siteId/preview" element={<SitePreviewPage />} /></Routes></MemoryRouter></QueryClientProvider>);
  await screen.findByRole("heading", { name: "暂时无法打开站点" });
  expect(screen.getByText("文档包含不可公开的链接")).toBeInTheDocument();
  expect(screen.queryByText("已发布正文")).not.toBeInTheDocument();
  client.clear();
});

it("stops displaying a cached release after a refresh reports that it was withdrawn", async () => {
  const client = new QueryClient({ defaultOptions: { queries: { staleTime: Infinity, retry: false } } });
  client.setQueryData(["public-site", "guide"], snapshot);
  vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ code: "SITE_NOT_FOUND", message: "站点不存在", request_id: "test", data: null }), { status: 404, headers: { "Content-Type": "application/json" } })));
  render(<QueryClientProvider client={client}><MemoryRouter initialEntries={["/s/guide"]}><Routes><Route path="/s/:slug" element={<PublicSitePage />} /></Routes></MemoryRouter></QueryClientProvider>);
  expect(screen.getByRole("heading", { name: "第一篇" })).toBeInTheDocument();
  await act(async () => { await client.invalidateQueries({ queryKey: ["public-site", "guide"] }); });
  await waitFor(() => expect(screen.getByRole("heading", { name: "站点尚未发布或已撤回" })).toBeInTheDocument());
  expect(screen.queryByText("已发布正文")).not.toBeInTheDocument();
  client.clear();
});

it("retains the configured page order when a navigation group appears again", () => {
  render(<MemoryRouter><SiteReader snapshot={snapshot} basePath="/s/guide" /></MemoryRouter>);
  const navigation = screen.getByRole("navigation", { name: /^站点导航$/ });
  expect(within(navigation).getAllByRole("link").map((link) => link.textContent)).toEqual(["第一篇", "第二篇", "第三篇"]);
  expect(screen.getByRole("link", { name: /下一篇.*第二篇/ })).toHaveAttribute("href", "/s/guide/b");
});

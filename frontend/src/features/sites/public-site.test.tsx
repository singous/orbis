import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, expect, it, vi } from "vitest";
import { PublicSitePage, SitePreviewPage } from "./PublicSitePage";
import { authStore } from "../../shared/auth/auth-store";
import { SiteReader } from "./SiteReader";
import type { SitePreview, SiteSnapshot } from "./schemas";

const WORKSPACE_ID="0190a111-1111-7111-8111-111111111115",SITE_ID="0190a111-1111-7111-8111-111111111116",RELEASE_ID="0190a111-1111-7111-8111-111111111117";
const snapshot: SiteSnapshot = { name: "公开手册", slug: "guide", description: "", site_kind: "handbook", accent_color: "#0f766e", release_id: "r1", release_number: 1, published_at_ms: 1, pages: [
  { slug: "a", title: "第一篇", group: "起步", plain_text: "已发布正文", blocks: { schema_version: 2, blocks: [{ type: "paragraph", content: "已发布正文" }] } },
  { slug: "b", title: "第二篇", group: "进阶", plain_text: "", blocks: {} },
  { slug: "c", title: "第三篇", group: "起步", plain_text: "", blocks: {} },
] };
const logoReference = "orbis-file:0190a111-1111-7111-8111-111111111111";
const headerReference = "orbis-file:0190a111-1111-7111-8111-111111111112";
const footerReference = "orbis-file:0190a111-1111-7111-8111-111111111113";
const ctaReference = "orbis-file:0190a111-1111-7111-8111-111111111114";
const brandedSnapshot: SitePreview = {
  ...snapshot,
  release_id: null,
  release_number: null,
  published_at_ms: null,
  source_fingerprint: "a".repeat(64),
  branding: {
    logo_url: logoReference,
    links: [{ label: "顶栏附件", url: headerReference }, { label: "阅读第二篇", url: "/s/guide/b" }],
    footer_links: [{ label: "页脚附件", url: footerReference }],
    cta: { label: "行动附件", url: ctaReference },
    theme: "light",
  },
};
function wirePage(page:SiteSnapshot["pages"][number]){
  const text=page.plain_text??"";
  return {slug:page.slug,title:page.title,group:page.group??null,parent_slug:page.parent_slug??null,section:page.section??null,description:page.description??"",updated_at_ms:page.updated_at_ms??null,plain_text:text,blocks:text?[{id:"public-0",type:"paragraph",props:{},content:[{text,marks:[],href:null}],children:[]}]:[]};
}
function wireManifest(value:SiteSnapshot){return {...value,branding:value.branding??{logo_url:null,links:[],footer_links:[],cta:null,theme:"system"},release_id:value.release_id?RELEASE_ID:null,pages:value.pages.map(page=>{const {blocks:_blocks,plain_text:_text,...metadata}=wirePage(page);return metadata;}),redirects:value.redirects??{}};}
function wirePreview(value:SitePreview){
  const url=(value:string)=>value.startsWith("orbis-file:")?`/api/v1/workspaces/${WORKSPACE_ID}/assets/${value.slice(11)}/content`:value;
  const branding=value.branding!;
  return {snapshot:{...wireManifest(value),branding:{...branding,logo_url:branding.logo_url?url(branding.logo_url):null,links:branding.links.map(item=>({...item,url:url(item.url)})),footer_links:branding.footer_links.map(item=>({...item,url:url(item.url)})),cta:branding.cta?{...branding.cta,url:url(branding.cta.url)}:null}},pages:value.pages.map(wirePage),source_fingerprint:value.source_fingerprint};
}
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks(); authStore.getState().clearSession(); });

it("removes an old authenticated preview when current content fails publication validation", async () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  client.setQueryData(["site-preview", SITE_ID], snapshot);
  authStore.setState({accessToken:"preview-test-token",refreshToken:null,workspace:{id:WORKSPACE_ID,name:"预览空间",role:"owner",created_at_ms:1,updated_at_ms:1}});
  vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ code: "SITE_CONTENT_UNSAFE", message: "文档包含不可公开的链接", request_id: "test", data: null }), { status: 422, headers: { "Content-Type": "application/json" } })));
  render(<QueryClientProvider client={client}><MemoryRouter initialEntries={[`/sites/${SITE_ID}/preview`]}><Routes><Route path="/sites/:siteId/preview" element={<SitePreviewPage />} /></Routes></MemoryRouter></QueryClientProvider>);
  await screen.findByRole("heading", { name: "暂时无法打开站点" });
  expect(screen.getByText("文档包含不可公开的链接")).toBeInTheDocument();
  expect(screen.queryByText("已发布正文")).not.toBeInTheDocument();
  expect(document.querySelector('meta[name="robots"]')).toHaveAttribute("content", "noindex, nofollow");
  client.clear();
});

it("stops displaying a cached release after a refresh reports that it was withdrawn", async () => {
  const client = new QueryClient({ defaultOptions: { queries: { staleTime: Infinity, retry: false } } });
  client.setQueryData(["public-site", "guide", "manifest"], { ...snapshot, pages: snapshot.pages.map(({ blocks: _blocks, plain_text: _text, ...page }) => page) });
  client.setQueryData(["public-site", "guide", "page", "r1", "a"], { release_id: "r1", page: snapshot.pages[0] });
  vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ code: "SITE_NOT_FOUND", message: "站点不存在", request_id: "test", data: null }), { status: 404, headers: { "Content-Type": "application/json" } })));
  render(<QueryClientProvider client={client}><MemoryRouter initialEntries={["/s/guide"]}><Routes><Route path="/s/:slug" element={<PublicSitePage />} /></Routes></MemoryRouter></QueryClientProvider>);
  expect(screen.getByRole("heading", { name: "第一篇" })).toBeInTheDocument();
  await act(async () => { await client.invalidateQueries({ queryKey: ["public-site", "guide"] }); });
  await waitFor(() => expect(screen.getByRole("heading", { name: "站点尚未发布或已撤回" })).toBeInTheDocument());
  expect(screen.queryByText("已发布正文")).not.toBeInTheDocument();
  expect(document.querySelector('meta[name="robots"]')).toHaveAttribute("content", "noindex, nofollow");
  client.clear();
});

it("retains the configured page order when a navigation group appears again", () => {
  render(<MemoryRouter><SiteReader snapshot={snapshot} basePath="/s/guide" /></MemoryRouter>);
  const navigation = screen.getByRole("navigation", { name: /^站点导航$/ });
  expect(within(navigation).getAllByRole("link").map((link) => link.textContent)).toEqual(["第一篇", "第二篇", "第三篇"]);
  expect(screen.getByRole("link", { name: /下一篇.*第二篇/ })).toHaveAttribute("href", "/s/guide/b");
});

it("resolves preview branding through the authenticated query and keeps note links inside preview", async () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  authStore.setState({accessToken:"preview-branding-token",refreshToken:null,workspace:{id:WORKSPACE_ID,name:"预览空间",role:"owner",created_at_ms:1,updated_at_ms:1}});
  const objectUrl = vi.fn((blob: Blob) => `blob:${blob.type}`);
  Object.defineProperty(URL, "createObjectURL", { configurable: true, value: objectUrl });
  Object.defineProperty(URL, "revokeObjectURL", { configurable: true, value: vi.fn() });
  const fetchMock = vi.fn(async (input: RequestInfo | URL, options?: RequestInit) => {
    const path = String(input);
    if (path === `/api/v1/workspaces/${WORKSPACE_ID}/sites/${SITE_ID}/preview`) {
      return new Response(JSON.stringify({ code: "OK", message: "请求成功", request_id: "test", data: wirePreview(brandedSnapshot) }), { status: 200, headers: { "Content-Type": "application/json" } });
    }
    const type = path.endsWith("111111111111/content") ? "image/png"
      : path.endsWith("111111111112/content") ? "application/x-header"
      : path.endsWith("111111111113/content") ? "application/x-footer"
      : "application/x-cta";
    expect(options?.headers).toMatchObject({ authorization: "Bearer preview-branding-token" });
    return new Response(new Blob([path], { type }), { status: 200, headers: { "Content-Type": type } });
  });
  vi.stubGlobal("fetch", fetchMock);

  const view = render(
    <QueryClientProvider client={client}><MemoryRouter initialEntries={[`/sites/${SITE_ID}/preview`]}><Routes>
      <Route path="/sites/:siteId/preview/:pageSlug?" element={<SitePreviewPage />} />
    </Routes></MemoryRouter></QueryClientProvider>,
  );

  await waitFor(() => expect(view.container.querySelector(".site-reader-brand img")).toBeInTheDocument());
  const logo = view.container.querySelector<HTMLImageElement>(".site-reader-brand img");
  expect(logo).toHaveAttribute("src", "blob:image/png");
  const download = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
  expect(fetchMock.mock.calls.map(([path]) => path).some(path => String(path).includes(headerReference.slice("orbis-file:".length)))).toBe(false);
  await userEvent.click(screen.getByRole("button", { name: "顶栏附件" }));
  expect(await screen.findByRole("link", { name: "顶栏附件" })).toHaveAttribute("href", "blob:application/x-header");
  expect(screen.getByRole("link", { name: "顶栏附件" })).toHaveAttribute("download");
  await userEvent.click(screen.getByRole("button", { name: "页脚附件" }));
  expect(await screen.findByRole("link", { name: "页脚附件" })).toHaveAttribute("href", "blob:application/x-footer");
  expect(screen.getByRole("link", { name: "阅读第二篇" })).toHaveAttribute("href", `/sites/${SITE_ID}/preview/b`);
  await userEvent.click(screen.getByRole("button", { name: "行动附件" }));
  const cta = await screen.findByRole("link", { name: "行动附件" });
  expect(cta).toHaveAttribute("href", "blob:application/x-cta");
  expect(cta).toHaveAttribute("download");
  expect(download).toHaveBeenCalledTimes(3);
  expect(fetchMock).toHaveBeenCalledWith(`/api/v1/workspaces/${WORKSPACE_ID}/sites/${SITE_ID}/preview`, expect.objectContaining({ headers: expect.objectContaining({ authorization: "Bearer preview-branding-token" }) }));
  client.clear();
});

it("does not resolve private branding references in the anonymous reader", async () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const fetchMock = vi.fn(async (path: string) => new Response(JSON.stringify({ code: "OK", message: "请求成功", request_id: "test", data: path.endsWith("/manifest")?wireManifest({...brandedSnapshot,release_id:RELEASE_ID,release_number:2,published_at_ms:2}):wirePage(snapshot.pages[0]) }), { status: 200, headers: { "Content-Type": "application/json" } }));
  vi.stubGlobal("fetch", fetchMock);

  const view = render(<QueryClientProvider client={client}><MemoryRouter initialEntries={["/s/guide"]}><Routes><Route path="/s/:slug/:pageSlug?" element={<PublicSitePage />} /></Routes></MemoryRouter></QueryClientProvider>);

  await screen.findByText("已发布正文");
  expect(view.container.querySelector(".site-reader-brand img")).not.toBeInTheDocument();
  expect(screen.queryByRole("link", { name: "顶栏附件" })).not.toBeInTheDocument();
  expect(screen.queryByRole("link", { name: "页脚附件" })).not.toBeInTheDocument();
  expect(screen.getByRole("link", { name: "阅读第二篇" })).toHaveAttribute("href", "/s/guide/b");
  expect(screen.queryByRole("link", { name: "行动附件" })).not.toBeInTheDocument();
  expect(fetchMock.mock.calls.map(([path]) => path)).toEqual(["/api/v1/public/sites/guide/manifest", `/api/v1/public/sites/guide/pages/a?release_id=${RELEASE_ID}`]);
  client.clear();
});

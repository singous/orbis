import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { authStore } from "../../shared/auth/auth-store";
import { NotebookPage } from "../documents/NotebookPage";
import { SiteEditorPage } from "./SiteEditorPage";
import { SitesPage } from "./SitesPage";
import type { wireSiteConfig } from "./site-codec";

const WORKSPACE_ID = "018ff7c4-a5b6-7000-8000-000000000001";
const SITE_ID = "018ff7c4-a5b6-7000-8000-000000000002";
const NOTEBOOK_ID = "018ff7c4-a5b6-7000-8000-000000000003";
const GROUP_ID = "018ff7c4-a5b6-7000-8000-000000000004";
const PARENT_ID = "018ff7c4-a5b6-7000-8000-000000000005";
const CHILD_ID = "018ff7c4-a5b6-7000-8000-000000000006";
const OTHER_NOTEBOOK_ID = "018ff7c4-a5b6-7000-8000-000000000007";
const INVALID_NOTEBOOK_ID = "018ff7c4-a5b6-7000-8000-000000000008";
const FINGERPRINT = "a".repeat(64);

const branding = { logo_url: null, links: [], footer_links: [], cta: null, theme: "system" as const };
const notebookSource = {
  kind: "collections" as const,
  collections: [{ collection_id: NOTEBOOK_ID, root_document_id: null, label: null }],
  excluded_document_ids: [],
  page_overrides: [],
};
const manualSource = { kind: "manual" as const, collections: [], excluded_document_ids: [], page_overrides: [] };
const baseSite: ReturnType<typeof wireSiteConfig> & { id: string; workspace_id: string; version: number; published_release_id: string | null; published_slug: string | null; created_at_ms: number; updated_at_ms: number } = {
  workspace_id:WORKSPACE_ID,
  id: SITE_ID,
  name: "产品手册",
  slug: "guide",
  description: "产品知识",
  site_kind: "handbook" as const,
  accent_color: "#0f766e",
  navigation: [],
  source: notebookSource,
  branding:{logo:null,links:[],footer_links:[],cta:null,theme:"system"},
  version: 2,
  published_release_id: null,
  published_slug: null,
  created_at_ms: 1,
  updated_at_ms: 2,
};
const notebook = {
  id: NOTEBOOK_ID,
  tenant_id: null,
  workspace_id: WORKSPACE_ID,
  owner_id: WORKSPACE_ID,
  is_archived:false,archived_at_ms:null,content_version:2,metadata_version:1,directory_version:7,
  created_at_ms: 1,
  updated_at_ms: 2,
  group_id: GROUP_ID,
  title: "产品知识库",
  sort_order: 0,
  icon: null,
};
const parent = {
  id: PARENT_ID,
  tenant_id: null,
  workspace_id: WORKSPACE_ID,
  owner_id: WORKSPACE_ID,
  is_archived:false,archived_at_ms:null,content_version:2,metadata_version:1,directory_version:7,
  created_at_ms: 1,
  updated_at_ms: 10,
  collection_id: NOTEBOOK_ID,
  parent_id: null,
  sort_order: 0,position:0,
  title: "开始使用",
  children: [],
};
const child = { ...parent, id: CHILD_ID, parent_id: PARENT_ID, title: "安装客户端", children: [] };
const sourcePage = {
  document_id: PARENT_ID,content_version:2,
  slug: "getting-started",
  title: "开始使用",
  group: null,
  parent_slug: null,
  section: "产品知识库",
  description: "",
  updated_at_ms: 10,
};

function page(items: unknown[], currentPage = 1, hasNext = false) {
  return {
    items,
    pagination: {
      page: currentPage,
      page_size: 100,
      total:hasNext?currentPage*100+1:(currentPage-1)*100+items.length,
      total_pages: hasNext ? currentPage + 1 : currentPage,
      has_next: hasNext,
      has_previous: currentPage > 1,
    },
  };
}

function response(data: unknown, status = 200, code = "OK", message = "成功") {
  return new Response(JSON.stringify({ code, message, request_id: SITE_ID, data }), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

type RequestRecord = { path: string; method: string; body: Record<string, unknown> };
let requests: RequestRecord[];
let siteResponse: typeof baseSite;
let publishConflict: boolean;
let notebooksSpanPages: boolean;
let emptyPreview: boolean;
let notebookFailuresRemaining: number;

function installFetch() {
  vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
    const path = String(url);
    const method = init?.method ?? "GET";
    const body = init?.body ? JSON.parse(String(init.body)) as Record<string, unknown> : {};
    requests.push({ path, method, body });

    if (path === `/api/v1/workspaces/${WORKSPACE_ID}/sites/${SITE_ID}` && method === "GET") return response(siteResponse);
    if (path === `/api/v1/workspaces/${WORKSPACE_ID}/sites/${SITE_ID}` && method === "PUT") {
      siteResponse = { ...baseSite, ...body, version: 3 } as typeof baseSite;
      return response(siteResponse);
    }
    if (path === `/api/v1/workspaces/${WORKSPACE_ID}/sites/${SITE_ID}/sources`) {
      return response({
        pages: emptyPreview ? [] : [sourcePage],
        excluded_count: 0,
        source_fingerprint: FINGERPRINT,
        changes: { added: emptyPreview ? [] : [sourcePage], modified: [], removed: [] },
      });
    }
    if(path===`/api/v1/workspaces/${WORKSPACE_ID}/sites/${SITE_ID}/preview`){
      const pages=emptyPreview?[]:[{...sourcePage,plain_text:"冻结正文",blocks:[{id:"public-0",type:"paragraph",props:{},content:[{text:"冻结正文",marks:[],href:null}],children:[]}]}];
      return response({snapshot:{name:"产品手册",slug:"guide",description:"产品知识",site_kind:"handbook",accent_color:"#0f766e",branding,pages:pages.map(({blocks:_blocks,plain_text:_text,...metadata})=>metadata),redirects:{},release_id:null,release_number:null,published_at_ms:null},pages,source_fingerprint:FINGERPRINT});
    }

    if (path === `/api/v1/workspaces/${WORKSPACE_ID}/sites/${SITE_ID}/publish` && method === "POST") {
      if (publishConflict) return response(null, 409, "SITE_SOURCE_CONFLICT", "来源内容已变化，请重新预览");
      return response({site:{...baseSite,version:3,published_release_id:SITE_ID,published_slug:"guide"},release:{id:SITE_ID,release_number:1,published_at_ms:10,is_active:true}});
    }
    if (path.includes(`/api/v1/workspaces/${WORKSPACE_ID}/sites/${SITE_ID}/releases`)) return response(page([]));
    if (path.startsWith(`/api/v1/workspaces/${WORKSPACE_ID}/collections?`)) {
      if (notebookFailuresRemaining > 0) {
        notebookFailuresRemaining -= 1;
        return response(null, 503, "NOTEBOOK_LIST_UNAVAILABLE", "笔记本列表暂不可用");
      }
      const pageNumber = Number(new URL(path, "http://orbis.test").searchParams.get("page") ?? "1");
      if (notebooksSpanPages) return response(page(pageNumber === 1 ? [{ ...notebook, id: OTHER_NOTEBOOK_ID, title: "第一页笔记本" }] : [notebook], pageNumber, pageNumber === 1));
      return response(page([notebook]));
    }
    if(path===`/api/v1/workspaces/${WORKSPACE_ID}/collections/${NOTEBOOK_ID}`)return response(notebook);
    if(path.startsWith(`/api/v1/workspaces/${WORKSPACE_ID}/collections/${NOTEBOOK_ID}/documents?`))return response(page([parent,child]));
    if (path.startsWith(`/api/v1/workspaces/${WORKSPACE_ID}/documents?`)) return response(page([]));
    if (path.startsWith(`/api/v1/workspaces/${WORKSPACE_ID}/sites?`)) return response(page([]));
    return response(page([]));
  }));
}

function renderRoute(route: string, element: React.ReactNode, pattern: string) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[route]}>
        <Routes><Route path={pattern} element={element} /></Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  requests = [];
  siteResponse = baseSite;
  publishConflict = false;
  notebooksSpanPages = false;
  emptyPreview = false;
  notebookFailuresRemaining = 0;
  authStore.setState({
    accessToken: "test-token",
    refreshToken: "refresh-token",
    workspace: { id: WORKSPACE_ID, name: "测试空间", role: "owner", created_at_ms: 1, updated_at_ms: 1 },
  });
  installFetch();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  authStore.getState().clearSession();
});

describe("notebook-backed site management", () => {
  it("builds a real note tree and sends subtree exclusions and page overrides", async () => {
    renderRoute(`/sites/${SITE_ID}`, <SiteEditorPage />, "/sites/:siteId");

    expect(await screen.findByRole("heading", { name: "内容来源" })).toBeVisible();
    expect((await screen.findAllByText("产品知识库"))[0]).toBeVisible();
    const parentToggle = await screen.findByRole("checkbox", { name: "公开 开始使用" });
    const childToggle = screen.getByRole("checkbox", { name: "公开 安装客户端" });
    await userEvent.click(parentToggle);
    expect(childToggle).toBeDisabled();
    expect(screen.getByText("受上级排除影响")).toBeVisible();

    await userEvent.click(screen.getByRole("button", { name: "设置 开始使用 的公开信息" }));
    fireEvent.change(screen.getByRole("textbox", { name: "公开标题：开始使用" }), {target:{value:"快速开始"}});
    fireEvent.change(screen.getByRole("textbox", { name: "公开路径：开始使用" }), {target:{value:"quick-start"}});
    fireEvent.change(screen.getByRole("textbox", { name: "公开简介：开始使用" }), {target:{value:"先从这里开始"}});
    await userEvent.click(screen.getByRole("button", { name: "保存设置" }));

    await waitFor(() => {
      const saved = requests.find((request) => request.method === "PUT")?.body;
      expect(saved?.source).toEqual({
        ...notebookSource,
        excluded_document_ids: [PARENT_ID],
        page_overrides: [{ document_id: PARENT_ID, title: "快速开始", slug: "quick-start", description: "先从这里开始" }],
      });
    });
  });

  it("publishes the exact shown preview fingerprint and keeps it after a 409", async () => {
    publishConflict = true;
    renderRoute(`/sites/${SITE_ID}`, <SiteEditorPage />, "/sites/:siteId");

    await userEvent.click(await screen.findByRole("button", { name: "发布站点" }));
    const dialog = await screen.findByRole("dialog", { name: "确认发布站点" });
    expect(within(dialog).getAllByText("冻结正文")).not.toHaveLength(0);
    expect(within(dialog).getByText("新增 1")).toBeVisible();
    await userEvent.click(within(dialog).getByRole("button", { name: "确认发布" }));

    expect(await within(dialog).findByRole("alert")).toHaveTextContent("来源内容已变化");
    const publishRequests = requests.filter((request) => request.path.endsWith("/publish"));
    expect(publishRequests).toHaveLength(1);
    expect(publishRequests[0].body).toEqual({expected_source_fingerprint:FINGERPRINT,expected_version:2,operation_id:expect.any(String)});
    expect(requests.filter((request) => request.path.endsWith("/preview"))).toHaveLength(1);
    expect(within(dialog).getByRole("button", { name: "重新预览" })).toBeVisible();
  });

  it("keeps ordinary members read-only", async () => {
    authStore.setState((state) => ({ workspace: state.workspace ? { ...state.workspace, role: "viewer" } : null }));
    renderRoute(`/sites/${SITE_ID}`, <SiteEditorPage />, "/sites/:siteId");

    expect(await screen.findByRole("textbox", { name: "站点名称" })).toBeDisabled();
    expect(await screen.findByRole("checkbox", { name: "公开 开始使用" })).toBeDisabled();
    expect(screen.queryByRole("button", { name: "保存设置" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "发布站点" })).not.toBeInTheDocument();
  });

  it("preserves an old manual site's path and optional config while saving", async () => {
    const navigation = [{ document_id: PARENT_ID, slug: "kept-path", title: "开始使用", group: null }];
    siteResponse = { ...baseSite, navigation, source: manualSource };
    renderRoute(`/sites/${SITE_ID}`, <SiteEditorPage />, "/sites/:siteId");

    const name = await screen.findByRole("textbox", { name: "站点名称" });
    await userEvent.clear(name);
    await userEvent.type(name, "旧站点新名称");
    await userEvent.click(screen.getByRole("button", { name: "保存设置" }));

    await waitFor(() => expect(requests.find((request) => request.method === "PUT")?.body).toMatchObject({
      navigation,
      source: manualSource,
    }));
  });

  it("publishes a converted manual site's shown fingerprint and keeps the preview after a 409", async () => {
    const navigation = [{ document_id: PARENT_ID, slug: "kept-path", title: "开始使用", group: null }];
    const { source: _source, branding: _branding, ...legacySite } = baseSite;
    siteResponse = { ...legacySite, navigation,source:manualSource,branding:{...branding,logo:null} };
    publishConflict = true;
    renderRoute(`/sites/${SITE_ID}`, <SiteEditorPage />, "/sites/:siteId");

    await userEvent.click(await screen.findByRole("button", { name: "发布站点" }));
    const dialog = await screen.findByRole("dialog", { name: "确认发布站点" });
    expect(within(dialog).getAllByText("冻结正文")).not.toHaveLength(0);
    await userEvent.click(within(dialog).getByRole("button", { name: "确认发布" }));

    expect(await within(dialog).findByRole("alert")).toHaveTextContent("来源内容已变化");
    expect(requests.find((request) => request.path.endsWith("/publish"))?.body).toEqual({expected_source_fingerprint:FINGERPRINT,expected_version:2,operation_id:expect.any(String)});
    expect(requests.filter((request) => request.path.endsWith("/preview"))).toHaveLength(1);
    expect(within(dialog).getAllByText("冻结正文")).not.toHaveLength(0);
    expect(within(dialog).getByRole("button", { name: "重新预览" })).toBeVisible();
  });

  it("allows notebook mode with an empty manual navigation but blocks an empty resolved preview", async () => {
    emptyPreview = true;
    renderRoute(`/sites/${SITE_ID}`, <SiteEditorPage />, "/sites/:siteId");

    const publishButton = await screen.findByRole("button", { name: "发布站点" });
    expect(publishButton).toBeEnabled();
    await userEvent.click(publishButton);
    const dialog = await screen.findByRole("dialog", { name: "确认发布站点" });
    expect(within(dialog).getByText("来源中没有可发布页面")).toBeVisible();
    expect(within(dialog).getByRole("button", { name: "确认发布" })).toBeDisabled();
  });

  it("keeps a scoped root excluded until the user explicitly clears its hidden global ancestor", async () => {
    siteResponse = {
      ...baseSite,
      source: {
        ...notebookSource,
        collections: [{ collection_id: NOTEBOOK_ID, root_document_id: CHILD_ID, label: null }],
        excluded_document_ids: [PARENT_ID],
      },
    };
    renderRoute(`/sites/${SITE_ID}`, <SiteEditorPage />, "/sites/:siteId");

    const childToggle = await screen.findByRole("checkbox", { name: "公开 安装客户端" });
    expect(childToggle).not.toBeChecked();
    expect(childToggle).toBeDisabled();
    expect(screen.getByText(/隐藏上级“开始使用”已被全局排除/)).toBeVisible();
    expect(screen.getByText(/会影响所有包含该文档的来源范围/)).toBeVisible();

    const name = screen.getByRole("textbox", { name: "站点名称" });
    await userEvent.type(name, "保留排除");
    await userEvent.click(screen.getByRole("button", { name: "保存设置" }));
    await waitFor(() => expect(requests.filter((request) => request.method === "PUT").at(-1)?.body.source).toMatchObject({ excluded_document_ids: [PARENT_ID] }));

    await userEvent.click(screen.getByRole("button", { name: "清除全局排除 开始使用" }));
    expect(childToggle).toBeEnabled();
    expect(childToggle).toBeChecked();
    await userEvent.click(screen.getByRole("button", { name: "保存设置" }));
    await waitFor(() => expect(requests.filter((request) => request.method === "PUT").at(-1)?.body.source).toMatchObject({ excluded_document_ids: [] }));
  });

  it("does not auto-bind a notebook after the last invalid source is deliberately removed and the list refetches", async () => {
    notebookFailuresRemaining = 1;
    siteResponse = {
      ...baseSite,
      source: {
        ...notebookSource,
        collections: [{ collection_id: INVALID_NOTEBOOK_ID, root_document_id: null, label: null }],
      },
    };
    renderRoute(`/sites/${SITE_ID}`, <SiteEditorPage />, "/sites/:siteId");

    expect(await screen.findByRole("button", { name: /来源笔记本 1/ })).toHaveTextContent("当前来源不可用");
    await userEvent.click(screen.getByRole("button", { name: "移除来源 1" }));
    expect(screen.queryByRole("button", { name: /来源笔记本 1/ })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "重试" }));

    expect(await screen.findByRole("button", { name: "添加来源" })).toBeVisible();
    expect(screen.queryByRole("button", { name: /来源笔记本 1/ })).not.toBeInTheDocument();
  });
});

describe("notebook entry points", () => {
  it("opens a notebook-prefilled site draft without creating a site", async () => {
    notebooksSpanPages = true;
    renderRoute(`/sites?notebook=${NOTEBOOK_ID}`, <SitesPage />, "/sites");

    const dialog = await screen.findByRole("dialog", { name: "创建文档站点" });
    expect(within(dialog).getByRole("radio", { name: "关联笔记本" })).toBeChecked();
    await waitFor(() => expect(within(dialog).getByRole("button", { name: /来源笔记本 1/ })).toHaveTextContent("产品知识库"));
    expect(await within(dialog).findAllByText("产品知识库")).not.toHaveLength(0);
    expect(requests.some((request) => request.method === "POST" && request.path === `/api/v1/workspaces/${WORKSPACE_ID}/sites`)).toBe(false);
  });

  it("links notebook management to a prefilled site draft", async () => {
    renderRoute(`/documents/collections/${NOTEBOOK_ID}`, <NotebookPage />, "/documents/collections/:collectionId");

    await userEvent.click(await screen.findByRole("button", { name: "笔记本操作" }));
    const link = screen.getByRole("menuitem", { name: "创建文档站点" });
    expect(link).toHaveAttribute("href", `/sites?notebook=${NOTEBOOK_ID}`);
  });
});

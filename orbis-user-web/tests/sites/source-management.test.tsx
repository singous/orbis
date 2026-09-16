import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { authStore } from "../../src/shared/auth/auth-store";
import { NotebookPage } from "../../src/features/documents/NotebookPage";
import { SiteEditorPage } from "../../src/features/sites/SiteEditorPage";
import { SitesPage } from "../../src/features/sites/SitesPage";

const WORKSPACE_ID = "018ff7c4-a5b6-7000-8000-000000000001";
const SITE_ID = "018ff7c4-a5b6-7000-8000-000000000002";
const NOTEBOOK_ID = "018ff7c4-a5b6-7000-8000-000000000003";
const GROUP_ID = "018ff7c4-a5b6-7000-8000-000000000004";
const PARENT_ID = "018ff7c4-a5b6-7000-8000-000000000005";
const CHILD_ID = "018ff7c4-a5b6-7000-8000-000000000006";
const OTHER_NOTEBOOK_ID = "018ff7c4-a5b6-7000-8000-000000000007";
const FINGERPRINT = "a".repeat(64);

const branding = { logo_url: null, links: [], footer_links: [], cta: null, theme: "system" } as const;
const notebookSource = {
  kind: "notebooks" as const,
  notebooks: [{ notebook_id: NOTEBOOK_ID, root_note_id: null, label: null }],
  excluded_note_ids: [],
  page_overrides: [],
};
const manualSource = { kind: "manual" as const, notebooks: [], excluded_note_ids: [], page_overrides: [] };
const baseSite = {
  id: SITE_ID,
  name: "产品手册",
  slug: "guide",
  description: "产品知识",
  site_kind: "handbook" as const,
  accent_color: "#0f766e",
  navigation: [],
  source: notebookSource,
  branding,
  config_version: 2,
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
  status: "active",
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
  status: "active",
  created_at_ms: 1,
  updated_at_ms: 10,
  notebook_id: NOTEBOOK_ID,
  parent_id: null,
  sort_order: 0,
  title: "开始使用",
  children: [],
};
const child = { ...parent, id: CHILD_ID, parent_id: PARENT_ID, title: "安装客户端", children: [] };
const sourcePage = {
  note_id: PARENT_ID,
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
      total: items.length + (hasNext ? 1 : 0),
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
let siteResponse: typeof baseSite | (Omit<typeof baseSite, "source" | "branding"> & { navigation: typeof baseSite.navigation });
let publishConflict: boolean;
let notebooksSpanPages: boolean;
let emptyPreview: boolean;

function installFetch() {
  vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
    const path = String(url);
    const method = init?.method ?? "GET";
    const body = init?.body ? JSON.parse(String(init.body)) as Record<string, unknown> : {};
    requests.push({ path, method, body });

    if (path === `/api/sites/${SITE_ID}` && method === "GET") return response(siteResponse);
    if (path === `/api/sites/${SITE_ID}` && method === "PUT") {
      siteResponse = { ...baseSite, ...body, config_version: 3 } as typeof baseSite;
      return response(siteResponse);
    }
    if (path === `/api/sites/${SITE_ID}/sources`) {
      return response({
        pages: emptyPreview ? [] : [sourcePage],
        excluded_count: 0,
        source_fingerprint: FINGERPRINT,
        changes: { added: emptyPreview ? [] : [sourcePage], modified: [], removed: [] },
      });
    }
    if (path === `/api/sites/${SITE_ID}/preview`) {
      return response({
        name: "产品手册",
        slug: "guide",
        description: "产品知识",
        site_kind: "handbook",
        accent_color: "#0f766e",
        branding,
        pages: emptyPreview ? [] : [{ ...sourcePage, blocks: { schema_version: 2, editor: "blocknote", blocks: [{ id: "block", type: "paragraph", content: [{ type: "text", text: "冻结正文", styles: {} }] }] }, plain_text: "冻结正文" }],
        redirects: {},
        release_id: null,
        release_number: null,
        published_at_ms: null,
        source_fingerprint: FINGERPRINT,
      });
    }
    if (path === `/api/sites/${SITE_ID}/publish` && method === "POST") {
      if (publishConflict) return response(null, 409, "SITE_SOURCE_CONFLICT", "来源内容已变化，请重新预览");
      return response({
        name: "产品手册", slug: "guide", description: "产品知识", site_kind: "handbook", accent_color: "#0f766e", branding,
        pages: [], redirects: {}, release_id: SITE_ID, release_number: 1, published_at_ms: 10,
      });
    }
    if (path.includes(`/api/sites/${SITE_ID}/releases`)) return response(page([]));
    if (path.startsWith("/api/notebooks?")) {
      const pageNumber = Number(new URL(path, "http://orbis.test").searchParams.get("page") ?? "1");
      if (notebooksSpanPages) return response(page(pageNumber === 1 ? [{ ...notebook, id: OTHER_NOTEBOOK_ID, title: "第一页笔记本" }] : [notebook], pageNumber, pageNumber === 1));
      return response(page([notebook]));
    }
    if (path === `/api/notebooks/${NOTEBOOK_ID}/notes/tree`) return response({ items: [{ ...parent, children: [child] }] });
    if (path.startsWith("/api/notes?")) return response(page([]));
    if (path.startsWith("/api/sites?")) return response(page([]));
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
  authStore.setState({
    accessToken: "test-token",
    refreshToken: "refresh-token",
    workspace: { id: WORKSPACE_ID, name: "测试空间", workspace_type: "private", role: "owner", is_current: true, created_at_ms: 1, updated_at_ms: 1 },
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
    await userEvent.type(screen.getByRole("textbox", { name: "公开标题：开始使用" }), "快速开始");
    await userEvent.type(screen.getByRole("textbox", { name: "公开路径：开始使用" }), "quick-start");
    await userEvent.type(screen.getByRole("textbox", { name: "公开简介：开始使用" }), "先从这里开始");
    await userEvent.click(screen.getByRole("button", { name: "保存设置" }));

    await waitFor(() => {
      const saved = requests.find((request) => request.method === "PUT")?.body;
      expect(saved?.source).toEqual({
        ...notebookSource,
        excluded_note_ids: [PARENT_ID],
        page_overrides: [{ note_id: PARENT_ID, title: "快速开始", slug: "quick-start", description: "先从这里开始" }],
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
    expect(publishRequests[0].body).toEqual({ expected_source_fingerprint: FINGERPRINT });
    expect(requests.filter((request) => request.path.endsWith("/preview"))).toHaveLength(1);
    expect(within(dialog).getByRole("button", { name: "重新预览" })).toBeVisible();
  });

  it("keeps ordinary members read-only", async () => {
    authStore.setState((state) => ({ workspace: state.workspace ? { ...state.workspace, role: "normal" } : null }));
    renderRoute(`/sites/${SITE_ID}`, <SiteEditorPage />, "/sites/:siteId");

    expect(await screen.findByRole("textbox", { name: "站点名称" })).toBeDisabled();
    expect(await screen.findByRole("checkbox", { name: "公开 开始使用" })).toBeDisabled();
    expect(screen.queryByRole("button", { name: "保存设置" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "发布站点" })).not.toBeInTheDocument();
  });

  it("preserves an old manual site's path and optional config while saving", async () => {
    const navigation = [{ note_id: PARENT_ID, slug: "kept-path", title: "开始使用", group: null }];
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

  it("publishes a legacy manual site without adding a fingerprint body", async () => {
    const navigation = [{ note_id: PARENT_ID, slug: "kept-path", title: "开始使用", group: null }];
    const { source: _source, branding: _branding, ...legacySite } = baseSite;
    siteResponse = { ...legacySite, navigation };
    renderRoute(`/sites/${SITE_ID}`, <SiteEditorPage />, "/sites/:siteId");

    await userEvent.click(await screen.findByRole("button", { name: "发布站点" }));
    const dialog = await screen.findByRole("dialog", { name: "确认发布站点" });
    await userEvent.click(within(dialog).getByRole("button", { name: "确认发布" }));

    await waitFor(() => expect(requests.find((request) => request.path.endsWith("/publish"))?.body).toEqual({}));
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
});

describe("notebook entry points", () => {
  it("opens a notebook-prefilled site draft without creating a site", async () => {
    notebooksSpanPages = true;
    renderRoute(`/sites?notebook=${NOTEBOOK_ID}`, <SitesPage />, "/sites");

    const dialog = await screen.findByRole("dialog", { name: "创建文档站点" });
    expect(within(dialog).getByRole("radio", { name: "关联笔记本" })).toBeChecked();
    await waitFor(() => expect(within(dialog).getByRole("combobox", { name: "来源笔记本 1" })).toHaveValue(NOTEBOOK_ID));
    expect(await within(dialog).findAllByText("产品知识库")).not.toHaveLength(0);
    expect(requests.some((request) => request.method === "POST" && request.path === "/api/sites")).toBe(false);
  });

  it("links notebook management to a prefilled site draft", async () => {
    renderRoute(`/documents/collections/${NOTEBOOK_ID}`, <NotebookPage />, "/documents/collections/:collectionId");

    const link = await screen.findByRole("link", { name: "创建文档站点" });
    expect(link).toHaveAttribute("href", `/sites?notebook=${NOTEBOOK_ID}`);
  });
});

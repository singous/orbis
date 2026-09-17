import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Link, MemoryRouter, useLocation } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { authStore } from "../../shared/auth/auth-store";
import { DocumentShell } from "../documents/DocumentShell";
import { WorkspaceShell } from "./WorkspaceShell";

const originalMatchMedia = window.matchMedia;

function setViewport(width: number) {
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    value: (query: string) => ({
      matches: width <= Number(query.match(/max-width:\s*(\d+)px/)?.[1] ?? 0),
      media: query,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
    }),
  });
}

function Providers({ children, client }: { children: React.ReactNode; client?: QueryClient }) {
  return (
    <QueryClientProvider client={client ?? new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      {children}
    </QueryClientProvider>
  );
}

const user = {
  id: "018ff7c4-a5b6-7000-000000000001",
  tenant_id: null,
  email: "owner@orbis.test",
  display_name: "Orbis Owner",
  current_workspace_id: "018ff7c4-a5b6-7000-000000000002",
  status: "active",
  created_at_ms: 1,
  updated_at_ms: 1,
};

const workspace = {
  id: "018ff7c4-a5b6-7000-000000000002",
  name: "Orbis Workspace",
  workspace_type: "team",
  role: "owner" as const,
  is_current: true,
  created_at_ms: 1,
  updated_at_ms: 1,
};

function CurrentPath() {
  const location = useLocation();
  return <output aria-label="current path">{location.pathname}{location.search}</output>;
}

function renderShell(initialEntry = "/documents", contextPanel?: React.ReactNode, sectionMenu?: React.ReactNode) {
  return render(
    <Providers>
      <MemoryRouter initialEntries={[initialEntry]}>
        <WorkspaceShell sectionTitle="测试工作台" sectionMenu={sectionMenu} contextPanel={contextPanel}>
          <div>文档内容</div>
        </WorkspaceShell>
        <CurrentPath />
      </MemoryRouter>
    </Providers>,
  );
}

describe("WorkspaceShell", () => {
  beforeEach(() => {
    window.localStorage.clear();
    setViewport(1440);
    act(() => {
      authStore.setState({ accessToken: "access-token", refreshToken: "refresh-token", user, workspace });
    });
  });

  afterEach(() => {
    cleanup();
    act(() => authStore.getState().clearSession());
    Object.defineProperty(window, "matchMedia", { configurable: true, value: originalMatchMedia });
  });

  it.each([["/home", "首页导航"], ["/documents", "文档导航"], ["/sites", "站点导航"]])("provides secondary navigation by default on %s", (path, navigationName) => {
    renderShell(path);

    expect(screen.getByRole("navigation", { name: "业务板块" })).toBeInTheDocument();
    expect(screen.getByRole("navigation", { name: navigationName })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "收起侧栏" })).toBeInTheDocument();
  });

  it.each([
    ["/home", "首页导航", ["工作台"]],
    ["/sites", "站点导航", ["我的站点"]],
    ["/sites/guide", "站点导航", ["我的站点"]],
    ["/knowledge", "知识库导航", ["知识中心"]],
    ["/memory", "记忆导航", ["长期记忆"]],
    ["/settings/account", "设置导航", ["个人资料", "成员管理"]],
  ] as const)("limits the secondary menu to its own area on %s", (path, label, links) => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(<Providers client={client}><MemoryRouter initialEntries={[path]}><WorkspaceShell>内容</WorkspaceShell></MemoryRouter></Providers>);

    const menu = screen.getByRole("navigation", { name: label });
    expect(within(menu).getAllByRole("link").map((link) => link.textContent)).toEqual(links);
    expect(screen.queryByRole("button", { name: "新建资产" })).not.toBeInTheDocument();
    expect(client.getQueryCache().getAll()).toHaveLength(0);
  });

  it("keeps the area selected while switching its internal pages and replaces menus between areas", async () => {
    const actor = userEvent.setup();
    renderShell("/documents");
    const rail = screen.getByRole("navigation", { name: "业务板块" });
    await actor.click(within(screen.getByRole("navigation", { name: "文档导航" })).getByRole("link", { name: "最近编辑" }));

    expect(within(rail).getByRole("link", { name: "在线文档" })).toHaveAttribute("aria-current", "page");
    expect(within(screen.getByRole("navigation", { name: "文档导航" })).getByRole("link", { name: "最近编辑" })).toHaveAttribute("aria-current", "page");
    expect(within(screen.getByRole("navigation", { name: "文档导航" })).getByRole("link", { name: "文档概览" })).not.toHaveAttribute("aria-current");
    await actor.click(within(rail).getByRole("link", { name: "站点" }));

    expect(within(rail).getByRole("link", { name: "站点" })).toHaveAttribute("aria-current", "page");
    expect(within(rail).getByRole("link", { name: "在线文档" })).not.toHaveAttribute("aria-current");
    expect(screen.queryByRole("navigation", { name: "文档导航" })).not.toBeInTheDocument();
    expect(screen.getByRole("navigation", { name: "站点导航" })).toHaveTextContent("我的站点");
    expect(screen.queryByRole("link", { name: "归档" })).not.toBeInTheDocument();
  });

  it("switches areas with the sidebar collapsed and expands the destination menu", async () => {
    const actor = userEvent.setup();
    renderShell("/documents/recent");
    await actor.click(screen.getByRole("button", { name: "收起侧栏" }));
    await actor.click(within(screen.getByRole("navigation", { name: "业务板块" })).getByRole("link", { name: "站点" }));
    expect(window.localStorage.getItem("orbis.sidebarCollapsed")).toBe("1");
    await actor.click(screen.getByRole("button", { name: "展开侧栏" }));
    expect(screen.getByRole("navigation", { name: "站点导航" })).toBeVisible();
    expect(screen.queryByRole("navigation", { name: "文档导航" })).not.toBeInTheDocument();
  });

  it.each(["/collections/notebook-id", "/documents/note-id", "/documents/search"])("keeps nested document routes in the document area on %s", (path) => {
    renderShell(path);
    expect(within(screen.getByRole("navigation", { name: "业务板块" })).getByRole("link", { name: "在线文档" })).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("navigation", { name: "文档导航" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "新建资产" })).toBeInTheDocument();
  });

  it("provides settings navigation on account settings", () => {
    renderShell("/settings/account");

    expect(screen.getByRole("navigation", { name: "设置导航" })).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "主工作区" })).toHaveTextContent("文档内容");
  });

  it("uses a supplied section menu in place of the default secondary navigation", () => {
    renderShell("/documents", undefined, <nav aria-label="测试功能"><Link to="/documents">文档概览</Link></nav>);

    expect(screen.getByRole("navigation", { name: "业务板块" })).toBeInTheDocument();
    expect(screen.getByRole("navigation", { name: "测试功能" })).toBeInTheDocument();
    expect(screen.queryByRole("navigation", { name: "文档导航" })).not.toBeInTheDocument();
    expect(screen.getByText("测试工作台")).toBeInTheDocument();
  });

  it("preserves labelled business links while secondary navigation is collapsed", async () => {
    const actor = userEvent.setup();
    renderShell();

    await actor.click(screen.getByRole("button", { name: "收起侧栏" }));

    expect(window.localStorage.getItem("orbis.sidebarCollapsed")).toBe("1");
    expect(screen.queryByRole("navigation", { name: "文档导航" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "展开侧栏" })).toHaveFocus();
    const rail = screen.getByRole("navigation", { name: "业务板块" });
    expect(within(rail).getByRole("link", { name: "在线文档" })).toHaveAttribute("href", "/documents");
    expect(within(screen.getByRole("complementary", { name: "应用导航" })).getByRole("link", { name: "搜索" })).toHaveAttribute("href", "/documents/search");

    await actor.click(screen.getByRole("button", { name: "展开侧栏" }));
    expect(screen.getByRole("navigation", { name: "文档导航" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "收起侧栏" })).toHaveFocus();
    expect(window.localStorage.getItem("orbis.sidebarCollapsed")).not.toBe("1");
  });

  it("restores the persisted secondary-navigation preference", () => {
    window.localStorage.setItem("orbis.sidebarCollapsed", "1");
    renderShell();

    expect(screen.getByRole("button", { name: "展开侧栏" })).toBeInTheDocument();
    expect(screen.queryByRole("navigation", { name: "文档导航" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "打开用户菜单" })).toBeInTheDocument();
  });

  it("submits global search as an encoded document-search query", async () => {
    const actor = userEvent.setup();
    renderShell("/home");

    await actor.type(screen.getByRole("searchbox", { name: "全局搜索" }), "设计 规范{Enter}");

    const destination = new URL(screen.getByRole("status", { name: "current path" }).textContent ?? "", "https://orbis.test");
    expect(destination.pathname).toBe("/documents/search");
    expect(destination.searchParams.get("q")).toBe("设计 规范");
  });

  it("keeps the optional context panel inside the main workspace column", () => {
    renderShell("/documents", <div>上下文内容</div>);

    const mainWorkspace = screen.getByRole("region", { name: "主工作区" });
    const contextPanel = screen.getByRole("complementary", { name: "上下文面板" });
    expect(mainWorkspace).toContainElement(contextPanel);
    expect(contextPanel).toHaveTextContent("上下文内容");
  });

  it("keeps search and user access available while mobile navigation is closed", () => {
    setViewport(390);
    renderShell();

    expect(screen.queryByRole("navigation", { name: "业务板块" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "打开主导航" })).toHaveAttribute("aria-expanded", "false");
    expect(screen.getByRole("button", { name: "打开用户菜单" })).toBeInTheDocument();
    expect(screen.getByRole("searchbox", { name: "全局搜索" })).toBeInTheDocument();
    expect(screen.queryByRole("navigation", { name: "文档导航" })).not.toBeInTheDocument();
  });

  it("opens mobile navigation even when the desktop sidebar preference is collapsed", async () => {
    window.localStorage.setItem("orbis.sidebarCollapsed", "1");
    setViewport(390);
    const actor = userEvent.setup();
    renderShell();

    await actor.click(screen.getByRole("button", { name: "打开主导航" }));

    expect(screen.getByRole("navigation", { name: "业务板块" })).toBeInTheDocument();
    expect(screen.getByRole("navigation", { name: "文档导航" })).toBeInTheDocument();
    expect(window.localStorage.getItem("orbis.sidebarCollapsed")).toBe("1");
  });

  it("closes the mobile navigation through Escape, backdrop and navigation links", async () => {
    setViewport(390);
    const actor = userEvent.setup();
    renderShell("/home", undefined, <nav aria-label="测试功能"><Link to="/documents/recent">最近编辑</Link></nav>);
    const trigger = screen.getByRole("button", { name: "打开主导航" });

    await actor.click(trigger);
    expect(trigger).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByRole("navigation", { name: "测试功能" })).toBeInTheDocument();
    await actor.keyboard("{Escape}");
    expect(trigger).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByRole("navigation", { name: "测试功能" })).not.toBeInTheDocument();

    await actor.click(trigger);
    await actor.click(screen.getByRole("button", { name: "关闭主导航" }));
    expect(trigger).toHaveAttribute("aria-expanded", "false");

    await actor.click(trigger);
    await actor.click(screen.getByRole("link", { name: "最近编辑" }));
    expect(trigger).toHaveAttribute("aria-expanded", "false");
    expect(screen.getByRole("status", { name: "current path" })).toHaveTextContent("/documents/recent");
  });

  it("keeps search shortcuts inside the mobile drawer until it is dismissed", async () => {
    setViewport(390);
    const actor = userEvent.setup();
    renderShell();
    const navigationTrigger = screen.getByRole("button", { name: "打开主导航" });
    const search = screen.getByRole("searchbox", { name: "全局搜索" });

    await actor.click(navigationTrigger);
    const drawerFocus = document.activeElement;
    expect(search.closest("header")).toHaveAttribute("inert");

    await actor.keyboard("{Meta>}k{/Meta}");
    expect(document.activeElement).toBe(drawerFocus);
    await actor.keyboard("{Control>}k{/Control}");
    expect(document.activeElement).toBe(drawerFocus);
    expect(navigationTrigger).toHaveAttribute("aria-expanded", "true");

    await actor.keyboard("{Escape}");
    expect(search.closest("header")).not.toHaveAttribute("inert");
    await actor.keyboard("{Control>}k{/Control}");
    expect(search).toHaveFocus();
  });

  it("dismisses a nested quick-create menu before closing its mobile drawer", async () => {
    setViewport(390);
    const actor = userEvent.setup();
    renderShell();
    const navigationTrigger = screen.getByRole("button", { name: "打开主导航" });

    await actor.click(navigationTrigger);
    const createTrigger = screen.getByRole("button", { name: "新建资产" });
    createTrigger.focus();
    await actor.keyboard("{Enter}");
    expect(screen.getByRole("menu")).toBeInTheDocument();

    await actor.keyboard("{Escape}");
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
    expect(navigationTrigger).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByRole("navigation", { name: "文档导航" })).toBeInTheDocument();
    expect(createTrigger).toHaveFocus();

    await actor.keyboard("{Escape}");
    expect(navigationTrigger).toHaveAttribute("aria-expanded", "false");
    expect(navigationTrigger).toHaveFocus();
  });

  it("collapses the mobile document context drawer when its panel is closed", async () => {
    setViewport(390);
    const actor = userEvent.setup();
    render(
      <Providers>
        <MemoryRouter initialEntries={["/documents"]}>
          <DocumentShell contextPanel={<nav aria-label="测试文档目录">文档目录</nav>}>
            <div>文档内容</div>
          </DocumentShell>
        </MemoryRouter>
      </Providers>,
    );
    const trigger = screen.getByRole("button", { name: "打开文档目录" });

    await actor.click(trigger);
    expect(trigger).toHaveAttribute("aria-expanded", "true");
    await actor.click(screen.getByRole("button", { name: "收起上下文面板" }));
    expect(trigger).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByRole("navigation", { name: "测试文档目录" })).not.toBeInTheDocument();

    await actor.click(trigger);
    expect(trigger).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByRole("navigation", { name: "测试文档目录" })).toBeInTheDocument();
  });

  it("keeps mobile navigation and context drawers mutually exclusive", async () => {
    setViewport(390);
    const actor = userEvent.setup();
    renderShell("/documents", <div>上下文内容</div>);
    const navigation = screen.getByRole("button", { name: "打开主导航" });
    const context = screen.getByRole("button", { name: "打开文档目录" });

    await actor.click(navigation);
    await actor.click(context);
    expect(navigation).toHaveAttribute("aria-expanded", "false");
    expect(context).toHaveAttribute("aria-expanded", "true");

    await actor.click(navigation);
    expect(navigation).toHaveAttribute("aria-expanded", "true");
    expect(context).toHaveAttribute("aria-expanded", "false");
  });

  it("hides workspace members from a normal user menu", async () => {
    act(() => authStore.setState({ workspace: { ...workspace, role: "normal" } }));
    const actor = userEvent.setup();
    renderShell();

    await actor.click(screen.getByRole("button", { name: "打开用户菜单" }));
    expect(screen.queryByRole("link", { name: "工作空间成员" })).not.toBeInTheDocument();
  });

  it("preserves navigation and logout semantics in the user menu", async () => {
    const actor = userEvent.setup();
    renderShell();

    await actor.click(screen.getByRole("button", { name: "打开用户菜单" }));
    expect(screen.getByRole("link", { name: "工作空间成员" })).toHaveAttribute("href", "/settings/members");
    expect(screen.getByRole("link", { name: "账号" })).toHaveAttribute("href", "/settings/account");
    expect(screen.getByRole("button", { name: "退出登录" })).toBeInTheDocument();
  });

  it("closes user actions on Escape and returns focus to the trigger", async () => {
    const actor = userEvent.setup();
    renderShell();
    const trigger = screen.getByRole("button", { name: "打开用户菜单" });

    await actor.click(trigger);
    screen.getByRole("link", { name: "账号" }).focus();
    await actor.keyboard("{Escape}");

    expect(trigger).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByRole("link", { name: "账号" })).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
  });

  it("clears the session and returns to login when the user logs out", async () => {
    const actor = userEvent.setup();
    renderShell();

    await actor.click(screen.getByRole("button", { name: "打开用户菜单" }));
    await actor.click(screen.getByRole("button", { name: "退出登录" }));

    expect(authStore.getState().accessToken).toBeNull();
    expect(screen.getByRole("status", { name: "current path" })).toHaveTextContent("/login");
  });

  it("routes knowledge and memory entries to their placeholder pages", () => {
    renderShell();
    const rail = screen.getByRole("navigation", { name: "业务板块" });

    expect(within(rail).getByRole("link", { name: "知识库" })).toHaveAttribute("href", "/knowledge");
    expect(within(rail).getByRole("link", { name: "记忆" })).toHaveAttribute("href", "/memory");
  });

  it("opens quick create by keyboard and returns focus after Escape", async () => {
    const actor = userEvent.setup();
    renderShell();
    const trigger = screen.getByRole("button", { name: "新建资产" });

    trigger.focus();
    await actor.keyboard("{Enter}");
    expect(screen.getByRole("menu")).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: "笔记本" })).toBeInTheDocument();
    await actor.keyboard("{Escape}");
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
  });
});

import { readFileSync } from "node:fs";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Link, MemoryRouter, useLocation } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { authStore } from "../../shared/auth/auth-store";
import { useThemeStore } from "../../shared/theme/theme-store";
import { DocumentShell } from "../documents/DocumentShell";
import { WorkspaceShell } from "./WorkspaceShell";

const workspaceStyles = readFileSync("src/styles/index.css", "utf8");

function Providers({ children }: { children: React.ReactNode }) {
  return (
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
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
  return <output aria-label="current path">{useLocation().pathname}</output>;
}

function renderShell(initialEntry = "/documents", contextPanel?: React.ReactNode, sectionMenu?: React.ReactNode) {
  return render(
    <Providers>
      <MemoryRouter initialEntries={[initialEntry]}>
        <WorkspaceShell
          sectionTitle="测试工作台"
          sectionMenu={sectionMenu}
          contextPanel={contextPanel}
        >
          <div>文档内容</div>
        </WorkspaceShell>
        <CurrentPath />
      </MemoryRouter>
    </Providers>,
  );
}

function renderDocumentShell(initialEntry = "/documents") {
  return render(
    <Providers>
      <MemoryRouter initialEntries={[initialEntry]}>
        <DocumentShell><div>文档内容</div></DocumentShell>
        <CurrentPath />
      </MemoryRouter>
    </Providers>,
  );
}

function mobileDisplayFor(selector: string): string | null {
  const mediaStart = workspaceStyles.search(/@media[^{]*640px/);
  const mobileStyles = mediaStart >= 0 ? workspaceStyles.slice(mediaStart) : "";
  const selectorStart = mobileStyles.indexOf(`${selector} {`);
  const selectorEnd = selectorStart >= 0 ? mobileStyles.indexOf("}", selectorStart) : -1;
  const declarations = selectorEnd >= 0 ? mobileStyles.slice(selectorStart, selectorEnd) : "";
  return declarations.match(/display\s*:\s*([^;}]+)/)?.[1].trim() ?? null;
}

describe("WorkspaceShell", () => {
  beforeEach(() => {
    act(() => {
      authStore.setState({
        accessToken: "access-token",
        refreshToken: "refresh-token",
        user,
        workspace,
      });
    });
  });

  afterEach(() => {
    act(() => authStore.getState().clearSession());
  });

  it("renders only the business rail when a workspace page supplies no section menu", () => {
    render(
      <Providers>
        <MemoryRouter>
          <WorkspaceShell><div>工作区内容</div></WorkspaceShell>
        </MemoryRouter>
      </Providers>,
    );

    expect(screen.getByRole("navigation", { name: "业务板块" })).toBeInTheDocument();
    expect(screen.queryByRole("navigation", { name: "在线文档功能" })).not.toBeInTheDocument();
    expect(screen.queryByText("在线云文档")).not.toBeInTheDocument();
    expect(document.querySelector(".workspace-shell")).not.toHaveClass("has-section-menu");
  });

  it("renders a supplied section title and menu beside the business rail", () => {
    renderShell("/documents", undefined, <nav aria-label="测试功能"><Link to="/documents">文档概览</Link></nav>);

    expect(screen.getByRole("navigation", { name: "业务板块" })).toBeInTheDocument();
    expect(screen.getByRole("navigation", { name: "测试功能" })).toBeInTheDocument();
    expect(screen.getByText("测试工作台")).toBeInTheDocument();
    expect(document.querySelector(".workspace-shell")).toHaveClass("has-section-menu");
  });

  it("exposes search and the area tabs on the business rail", () => {
    render(
      <Providers>
        <MemoryRouter initialEntries={["/documents"]}>
          <DocumentShell><div>文档内容</div></DocumentShell>
        </MemoryRouter>
      </Providers>,
    );

    expect(screen.getByRole("link", { name: "搜索" })).toHaveAttribute("href", "/documents/search");
    expect(screen.getByRole("navigation", { name: "业务板块" })).toBeInTheDocument();
  });

  it("keeps the optional context panel inside the main workspace column", () => {
    renderShell("/documents", <div>上下文内容</div>);

    const mainWorkspace = screen.getByRole("region", { name: "主工作区" });
    const contextPanel = screen.getByRole("complementary", { name: "上下文面板" });
    expect(mainWorkspace).toHaveClass("has-context");
    expect(mainWorkspace).toContainElement(contextPanel);
    expect(mainWorkspace.lastElementChild).toBe(contextPanel);
    expect(mainWorkspace.parentElement?.children).toHaveLength(2);
  });

  it("collapses the mobile document context drawer when its panel is closed", async () => {
    const originalMatchMedia = window.matchMedia;
    Object.defineProperty(window, "matchMedia", {
      configurable: true,
      value: () => ({
        matches: true,
        addEventListener: () => undefined,
        removeEventListener: () => undefined,
      }),
    });
    const actor = userEvent.setup();

    try {
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
      const panel = document.querySelector('aside[aria-label="上下文面板"]');
      expect(panel).toHaveAttribute("hidden");
      expect(panel).toHaveAttribute("aria-hidden", "true");
      expect(panel).toHaveAttribute("inert");

      await actor.click(trigger);
      expect(trigger).toHaveAttribute("aria-expanded", "true");
      expect(panel).not.toHaveAttribute("hidden");
    } finally {
      Object.defineProperty(window, "matchMedia", {
        configurable: true,
        value: originalMatchMedia,
      });
    }
  });

  it("does not hide the user access surface at mobile width", () => {
    renderShell();

    expect(screen.getByRole("button", { name: "打开用户菜单" })).toBeInTheDocument();
    expect(mobileDisplayFor(".workspace-user-menu")).toBe("block");
  });

  it("hides workspace members from a normal user menu", async () => {
    act(() => authStore.setState((state) => ({ ...state, workspace: state.workspace ? { ...state.workspace, role: "normal" } : null })));
    const actor = userEvent.setup();
    renderShell();

    await actor.click(screen.getByRole("button", { name: "打开用户菜单" }));

    expect(screen.queryByRole("link", { name: "工作空间成员" })).not.toBeInTheDocument();
  });

  it("uses ordinary navigation and button semantics for user actions", async () => {
    const actor = userEvent.setup();
    renderShell();

    await actor.click(screen.getByRole("button", { name: "打开用户菜单" }));

    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "工作空间成员" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "账号" })).toBeInTheDocument();
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

    expect(screen.getByRole("link", { name: "知识库" })).toHaveAttribute("href", "/knowledge");
    expect(screen.getByRole("link", { name: "记忆" })).toHaveAttribute("href", "/memory");
  });

  it("places quick create above search on the rail", () => {
    renderShell();

    const createButton = screen.getByRole("button", { name: "新建资产" });
    const searchLink = screen.getByRole("link", { name: "搜索" });
    expect(
      createButton.compareDocumentPosition(searchLink) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it("keeps the rail at one fixed form with labelled tiles and never expands", () => {
    // The rail used to widen to 236px on hover or when pinned, swapping tiles
    // for rows and a search box. That interaction is gone: one form only.
    window.localStorage.setItem("orbis.railExpanded", "1");
    renderShell();

    expect(screen.getByRole("link", { name: "搜索" })).toBeInTheDocument();
    expect(screen.queryByRole("searchbox", { name: "搜索文档" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "固定侧栏" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "收起侧栏" })).not.toBeInTheDocument();
    expect(document.querySelector(".workspace-business-rail.is-expanded")).toBeNull();
    expect(screen.getByRole("link", { name: "在线文档" })).toBeInTheDocument();

    window.localStorage.removeItem("orbis.railExpanded");
  });

  it("toggles the application theme from the user menu", async () => {
    const actor = userEvent.setup();
    renderShell();

    await actor.click(screen.getByRole("button", { name: "打开用户菜单" }));
    await actor.click(screen.getByRole("button", { name: "切换到深色模式" }));

    expect(document.documentElement.dataset.theme).toBe("dark");

    // restore default state for other tests
    window.localStorage.clear();
    useThemeStore.setState({ theme: "light", explicit: false });
    document.documentElement.dataset.theme = "light";
  });
});

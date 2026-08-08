import { readFileSync } from "node:fs";
import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Link, MemoryRouter, useLocation } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { authStore } from "../../shared/auth/auth-store";
import { DocumentShell } from "../documents/DocumentShell";
import { WorkspaceShell } from "./WorkspaceShell";

const workspaceStyles = readFileSync("src/styles/index.css", "utf8");

const user = {
  id: "018ff7c4-a5b6-7000-8000-000000000001",
  tenant_id: null,
  email: "owner@orbis.test",
  display_name: "Orbis Owner",
  current_workspace_id: "018ff7c4-a5b6-7000-8000-000000000002",
  status: "active",
  created_at_ms: 1,
  updated_at_ms: 1,
};

const workspace = {
  id: "018ff7c4-a5b6-7000-8000-000000000002",
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
    <MemoryRouter initialEntries={[initialEntry]}>
      <WorkspaceShell
        sectionTitle="测试工作台"
        sectionMenu={sectionMenu}
        contextPanel={contextPanel}
      >
        <div>文档内容</div>
      </WorkspaceShell>
      <CurrentPath />
    </MemoryRouter>,
  );
}

function renderDocumentShell(initialEntry = "/documents") {
  return render(
    <MemoryRouter initialEntries={[initialEntry]}>
      <DocumentShell><div>文档内容</div></DocumentShell>
      <CurrentPath />
    </MemoryRouter>,
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
      <MemoryRouter>
        <WorkspaceShell><div>工作区内容</div></WorkspaceShell>
      </MemoryRouter>,
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

  it("lets the document shell own the five online document functions", () => {
    render(
      <MemoryRouter initialEntries={["/documents"]}>
        <DocumentShell><div>文档内容</div></DocumentShell>
      </MemoryRouter>,
    );

    expect(screen.getByRole("navigation", { name: "在线文档功能" })).toBeInTheDocument();
    expect(screen.getAllByRole("link", { name: /文档概览|最近文档|我的文集|搜索|归档/ })).toHaveLength(5);
    expect(screen.getByText("在线云文档")).toBeInTheDocument();
  });

  it.each([
    ["文档概览", "/documents"],
    ["最近文档", "/documents/recent"],
    ["我的文集", "/documents/collections"],
    ["搜索", "/documents/search"],
    ["归档", "/documents/archive"],
  ] as const)("navigates %s to its explicit document route", async (label, path) => {
    const actor = userEvent.setup();
    renderDocumentShell();

    const link = screen.getByRole("link", { name: label });
    expect(link).toHaveAttribute("href", path);

    await actor.click(link);

    expect(screen.getByRole("status", { name: "current path" })).toHaveTextContent(path);
    expect(link).toHaveClass("is-active");
    const overview = screen.getByRole("link", { name: "文档概览" });
    if (label === "文档概览") expect(overview).toHaveClass("is-active");
    else expect(overview).not.toHaveClass("is-active");
  });

  it("marks collections and notes as the 我的文集 function", () => {
    renderDocumentShell("/collections/018ff7c4-a5b6-7000-8000-000000000004");

    expect(screen.getByRole("link", { name: "我的文集" })).toHaveClass("is-active");
  });

  it("marks an open note as the 我的文集 function", () => {
    renderDocumentShell("/documents/018ff7c4-a5b6-7000-8000-000000000005");

    expect(screen.getByRole("link", { name: "我的文集" })).toHaveClass("is-active");
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

  it("uses separate mobile drawers and closes each after its navigation link", async () => {
    const actor = userEvent.setup();
    renderShell("/documents", <nav aria-label="测试文档目录"><Link to="/documents/note-1">目录中的文档</Link></nav>, <nav aria-label="测试功能"><Link to="/documents/search">搜索</Link></nav>);
    const mainNavigation = screen.getByRole("button", { name: "打开主导航" });
    const documentContext = screen.getByRole("button", { name: "打开文档目录" });

    await actor.click(mainNavigation);

    expect(mainNavigation).toHaveAttribute("aria-expanded", "true");
    expect(documentContext).toHaveAttribute("aria-expanded", "false");

    await actor.click(documentContext);

    expect(mainNavigation).toHaveAttribute("aria-expanded", "false");
    expect(documentContext).toHaveAttribute("aria-expanded", "true");

    await actor.click(screen.getByRole("link", { name: "搜索" }));

    expect(mainNavigation).toHaveAttribute("aria-expanded", "false");

    await actor.click(documentContext);
    await actor.click(screen.getByRole("link", { name: "目录中的文档" }));

    expect(documentContext).toHaveAttribute("aria-expanded", "false");
  });

  it("makes closed mobile drawer descendants inert until their drawer opens", async () => {
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
      renderShell("/documents", <nav aria-label="测试文档目录"><Link to="/documents/note-1">目录中的文档</Link></nav>, <nav aria-label="测试功能"><Link to="/documents/search">搜索</Link></nav>);

      expect(screen.queryByRole("link", { name: "搜索" })).not.toBeInTheDocument();
      expect(screen.queryByRole("link", { name: "目录中的文档" })).not.toBeInTheDocument();

      await actor.click(screen.getByRole("button", { name: "打开主导航" }));
      expect(screen.getByRole("link", { name: "搜索" })).toBeInTheDocument();
      expect(screen.queryByRole("link", { name: "目录中的文档" })).not.toBeInTheDocument();

      await actor.click(screen.getByRole("button", { name: "打开文档目录" }));
      expect(screen.queryByRole("link", { name: "搜索" })).not.toBeInTheDocument();
      expect(screen.getByRole("link", { name: "目录中的文档" })).toBeInTheDocument();
    } finally {
      Object.defineProperty(window, "matchMedia", { configurable: true, value: originalMatchMedia });
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
});

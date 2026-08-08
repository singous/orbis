import { readFileSync } from "node:fs";
import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, useLocation } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { authStore } from "../../shared/auth/auth-store";
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

function renderShell(initialEntry = "/documents", contextPanel?: React.ReactNode) {
  return render(
    <MemoryRouter initialEntries={[initialEntry]}>
      <WorkspaceShell contextPanel={contextPanel}><div>文档内容</div></WorkspaceShell>
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

  it("separates business navigation from the five online document functions", () => {
    renderShell();

    expect(screen.getByRole("navigation", { name: "业务板块" })).toBeInTheDocument();
    expect(screen.getByRole("navigation", { name: "在线文档功能" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "文档概览" })).toHaveAttribute("href", "/documents");
    expect(screen.getByText("知识库")).toHaveAttribute("aria-disabled", "true");
    expect(screen.queryByText("产品手册")).not.toBeInTheDocument();

    expect(screen.getAllByRole("link", { name: /文档概览|最近文档|我的文集|搜索|归档/ })).toHaveLength(5);
  });

  it.each([
    ["文档概览", "/documents"],
    ["最近文档", "/documents/recent"],
    ["我的文集", "/documents/collections"],
    ["搜索", "/documents/search"],
    ["归档", "/documents/archive"],
  ] as const)("navigates %s to its explicit document route", async (label, path) => {
    const actor = userEvent.setup();
    renderShell();

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
    renderShell("/collections/018ff7c4-a5b6-7000-8000-000000000004");

    expect(screen.getByRole("link", { name: "我的文集" })).toHaveClass("is-active");
  });

  it("marks an open note as the 我的文集 function", () => {
    renderShell("/documents/018ff7c4-a5b6-7000-8000-000000000005");

    expect(screen.getByRole("link", { name: "我的文集" })).toHaveClass("is-active");
  });

  it("keeps the optional context panel inside the main workspace column", () => {
    renderShell("/documents", <div>上下文内容</div>);

    const mainWorkspace = screen.getByRole("region", { name: "主工作区" });
    const contextPanel = screen.getByRole("complementary", { name: "上下文面板" });
    expect(mainWorkspace).toHaveClass("has-context");
    expect(mainWorkspace).toContainElement(contextPanel);
    expect(mainWorkspace.lastElementChild).toBe(contextPanel);
    expect(mainWorkspace.parentElement?.children).toHaveLength(3);
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

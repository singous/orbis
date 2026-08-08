import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, useLocation } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { authStore } from "../../shared/auth/auth-store";
import { WorkspaceShell } from "./WorkspaceShell";

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

function renderShell(initialEntry = "/documents") {
  return render(
    <MemoryRouter initialEntries={[initialEntry]}>
      <WorkspaceShell><div>文档内容</div></WorkspaceShell>
      <CurrentPath />
    </MemoryRouter>,
  );
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

  it("marks collections and notes as the 我的文集 function", () => {
    renderShell("/collections/018ff7c4-a5b6-7000-8000-000000000004");

    expect(screen.getByRole("link", { name: "我的文集" })).toHaveClass("is-active");
  });

  it("marks an open note as the 我的文集 function", () => {
    renderShell("/documents/018ff7c4-a5b6-7000-8000-000000000005");

    expect(screen.getByRole("link", { name: "我的文集" })).toHaveClass("is-active");
  });

  it("hides workspace members from a normal user menu", async () => {
    act(() => authStore.setState((state) => ({ ...state, workspace: state.workspace ? { ...state.workspace, role: "normal" } : null })));
    const actor = userEvent.setup();
    renderShell();

    await actor.click(screen.getByRole("button", { name: "打开用户菜单" }));

    expect(screen.queryByRole("menuitem", { name: "工作空间成员" })).not.toBeInTheDocument();
  });

  it("clears the session and returns to login when the user logs out", async () => {
    const actor = userEvent.setup();
    renderShell();

    await actor.click(screen.getByRole("button", { name: "打开用户菜单" }));
    await actor.click(screen.getByRole("menuitem", { name: "退出登录" }));

    expect(authStore.getState().accessToken).toBeNull();
    expect(screen.getByRole("status", { name: "current path" })).toHaveTextContent("/login");
  });
});

import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, useLocation } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";

import { UserMenu } from "./UserMenu";

const user = {
  id: "018ff7c4-a5b6-7000-8000-000000000001", bio: null, avatar_asset_id: null, profile_version: 1, email: "owner@orbis.test", display_name: "测试用户",
  preferred_workspace_id: "018ff7c4-a5b6-7000-8000-000000000002", created_at_ms: 1, updated_at_ms: 1,
};
const workspace = {
  id: "018ff7c4-a5b6-7000-8000-000000000002", name: "团队工作空间", role: "owner" as const,
  created_at_ms: 1, updated_at_ms: 1,
};
function CurrentPath() { return <output aria-label="current path">{useLocation().pathname}</output>; }
afterEach(cleanup);

describe.each(["topbar", "rail"] as const)("UserMenu %s anchor", (variant) => {
  it("keeps the same accessible actions, activation and focus restoration", async () => {
    const actor = userEvent.setup();
    render(<MemoryRouter><UserMenu variant={variant} user={user} workspace={workspace} onLogout={vi.fn()} /><CurrentPath /></MemoryRouter>);
    const trigger = screen.getByRole("button", { name: "打开用户菜单" });
    await actor.hover(trigger);
    expect(screen.queryByRole("menu", { name: "用户操作" })).not.toBeInTheDocument();
    await actor.unhover(trigger);
    await actor.tab();
    await actor.keyboard("{Enter}");
    expect(screen.getByRole("menuitem", { name: "工作空间成员" })).toHaveAttribute("href", "/settings/members");
    expect(screen.getByRole("menuitem", { name: "账号" })).toHaveAttribute("href", "/settings/account");
    expect(screen.getByRole("menuitem", { name: "退出登录" })).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: "外观" })).toBeInTheDocument();
    expect(screen.getAllByRole("menuitem")).toHaveLength(4);
    await actor.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("menu", { name: "用户操作" })).not.toBeInTheDocument());
    await waitFor(() => expect(trigger).toHaveFocus());
    await actor.click(trigger);
    await actor.click(screen.getByRole("menuitem", { name: "账号" }));
    expect(screen.getByRole("status", { name: "current path" })).toHaveTextContent("/settings/account");
  });

  it("hides member management for normal members and invokes logout once", async () => {
    const logout = vi.fn();
    render(<MemoryRouter><UserMenu variant={variant} user={user} workspace={{ ...workspace, role: "viewer" }} onLogout={logout} /></MemoryRouter>);
    const trigger = screen.getByRole("button", { name: "打开用户菜单" });
    if (variant === "rail") {
      expect(trigger).toHaveClass("workspace-user-trigger--rail");
      expect(trigger.querySelector(".workspace-user-trigger-copy")).not.toBeInTheDocument();
    } else {
      expect(trigger.querySelector(".workspace-user-trigger-copy")).toHaveTextContent("测试用户");
    }
    expect(trigger.querySelector(".workspace-user-avatar")).toBeInTheDocument();
    await userEvent.click(trigger);
    expect(screen.queryByRole("menuitem", { name: "工作空间成员" })).not.toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: "外观" })).toBeInTheDocument();
    expect(screen.getAllByRole("menuitem")).toHaveLength(3);
    await userEvent.click(screen.getByRole("menuitem", { name: "退出登录" }));
    expect(logout).toHaveBeenCalledTimes(1);
  });
});

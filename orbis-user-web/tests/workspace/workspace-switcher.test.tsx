import { act, cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { authStore } from "../../src/shared/auth/auth-store";
import { WorkspaceSwitcher } from "../../src/features/workspace/WorkspaceSwitcher";

const user = {
  id: "018ff7c4-a5b6-7000-8000-000000000001", tenant_id: null, email: "owner@orbis.test", display_name: "测试用户",
  current_workspace_id: "018ff7c4-a5b6-7000-8000-000000000002", status: "active", created_at_ms: 1, updated_at_ms: 1,
};
const workspace = {
  id: "018ff7c4-a5b6-7000-8000-000000000002", name: "团队工作空间", workspace_type: "team", role: "owner" as const,
  is_current: true, created_at_ms: 1, updated_at_ms: 1,
};

beforeEach(() => {
  act(() => authStore.setState({ accessToken: "token", refreshToken: "refresh", user, workspace }));
});
afterEach(() => { cleanup(); act(() => authStore.getState().clearSession()); vi.unstubAllGlobals(); });

describe.each(["topbar", "rail"] as const)("WorkspaceSwitcher %s anchor", (variant) => {
  it("opens current workspace details only on activation and restores keyboard focus", async () => {
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    const actor = userEvent.setup();
    render(<WorkspaceSwitcher variant={variant} />);
    const trigger = screen.getByRole("button", { name: "切换工作空间" });
    expect(trigger).toHaveAttribute("type", "button");
    await actor.hover(trigger);
    expect(screen.queryByRole("dialog", { name: "工作空间详情" })).not.toBeInTheDocument();
    await actor.unhover(trigger);
    await actor.tab();
    await waitFor(() => expect(trigger).toHaveFocus());
    await actor.keyboard("{Enter}");
    const details = screen.getByRole("dialog", { name: "工作空间详情" });
    expect(within(details).getByText("测试用户")).toBeVisible();
    expect(within(details).getByText("团队工作空间")).toBeVisible();
    expect(within(details).queryByRole("button")).not.toBeInTheDocument();
    expect(fetch).not.toHaveBeenCalled();
    await actor.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "工作空间详情" })).not.toBeInTheDocument());
    await waitFor(() => expect(trigger).toHaveFocus());
    expect(authStore.getState().workspace).toEqual(workspace);
  });

  it("preserves private-space details and uses the intended trigger content", async () => {
    act(() => authStore.setState({ workspace: { ...workspace, workspace_type: "private", name: "私人空间" } }));
    render(<WorkspaceSwitcher variant={variant} />);
    const trigger = screen.getByRole("button", { name: "切换工作空间" });
    if (variant === "rail") {
      expect(trigger).toHaveClass("rail-brand", "workspace-switcher-rail-trigger");
      expect(trigger.querySelector('[data-orbis-icon="Orbit"]')).toBeInTheDocument();
      expect(trigger).not.toHaveTextContent("私人空间");
    } else {
      expect(trigger).toHaveClass("workspace-brand");
      expect(trigger).toHaveTextContent("私人空间");
      expect(trigger.querySelector('[data-orbis-icon="Boxes"]')).toBeInTheDocument();
    }
    await userEvent.click(trigger);
    expect(within(screen.getByRole("dialog", { name: "工作空间详情" })).getByText("暂无团队空间")).toBeVisible();
  });
});

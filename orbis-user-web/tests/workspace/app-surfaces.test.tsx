import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, useLocation } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { WorkspaceShell } from "../../src/features/workspace/WorkspaceShell";
import { GLOBAL_SEARCH_INPUT_ID } from "../../src/features/workspace/use-workspace-search";
import { resolveAppSurface } from "../../src/shared/platform/app-surface";

const originalHost = window.__ORBIS_HOST__;

function Location() {
  const location = useLocation();
  return <output aria-label="route">{location.pathname}{location.search}</output>;
}

function mount(path = "/home", extra?: React.ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}><MemoryRouter initialEntries={[path]}>
    <WorkspaceShell><div>业务内容</div>{extra}</WorkspaceShell><Location />
  </MemoryRouter></QueryClientProvider>);
}

afterEach(() => { cleanup(); window.__ORBIS_HOST__ = originalHost; vi.unstubAllEnvs(); });

describe("application surface resolution", () => {
  it.each([
    [undefined, undefined, "web"], [undefined, "desktop", "desktop"],
    ["web", "desktop", "web"], ["desktop", "web", "desktop"],
    ["mobile", "desktop", "desktop"], ["desktop-browser", "invalid", "web"],
  ])("resolves host %s and build %s to %s", (host, build, expected) => {
    expect(resolveAppSurface(host, build)).toBe(expected);
  });
});

describe("shared workspace chrome", () => {
  it("defaults to web without mounting a topbar or duplicating account controls", () => {
    delete window.__ORBIS_HOST__;
    vi.stubEnv("VITE_APP_SURFACE", "");
    const view = mount();
    expect(view.container.querySelector(".workspace-topbar")).toBeNull();
    expect(screen.queryByRole("searchbox", { name: "全局搜索" })).not.toBeInTheDocument();
    const rail = screen.getByRole("complementary", { name: "应用导航" });
    expect(within(rail).getByRole("button", { name: "切换工作空间" })).toBeInTheDocument();
    expect(within(rail).getByRole("button", { name: "打开用户菜单" })).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: "打开用户菜单" })).toHaveLength(1);
    expect(within(rail).getByRole("link", { name: "首页" })).toHaveAttribute("href", "/home");
    expect(within(rail).getByRole("link", { name: "搜索" })).toHaveAttribute("href", "/search");
  });

  it("keeps the desktop topbar with the shared menu content and search shortcut", async () => {
    window.__ORBIS_HOST__ = { surface: "desktop" };
    const view = mount();
    expect(view.container.querySelector(".workspace-topbar")).toBeInTheDocument();
    const rail = screen.getByRole("complementary", { name: "应用导航" });
    expect(within(rail).queryByRole("button", { name: "切换工作空间" })).not.toBeInTheDocument();
    expect(within(rail).queryByRole("button", { name: "打开用户菜单" })).not.toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: "打开用户菜单" })).toHaveLength(1);
    await userEvent.setup().keyboard("{Control>}k{/Control}");
    expect(screen.getByRole("searchbox", { name: "全局搜索" })).toHaveFocus();
    expect(screen.getByLabelText("route")).toHaveTextContent("/home");
  });

  it.each(["Control", "Meta"])("opens global search with %s+K without a topbar", async modifier => {
    window.__ORBIS_HOST__ = { surface: "web" };
    mount();
    await userEvent.setup().keyboard(`{${modifier}>}k{/${modifier}}`);
    expect(screen.getByLabelText("route")).toHaveTextContent("/search");
  });

  it("focuses an existing search without discarding the query or selected scope", async () => {
    window.__ORBIS_HOST__ = { surface: "web" };
    mount("/search?q=文档&scope=all", <input id={GLOBAL_SEARCH_INPUT_ID} aria-label="搜索内容" />);
    await userEvent.setup().keyboard("{Control>}k{/Control}");
    expect(screen.getByRole("textbox", { name: "搜索内容" })).toHaveFocus();
    expect(screen.getByLabelText("route")).toHaveTextContent("/search?q=文档&scope=all");
  });

  it("does not steal keyboard interaction from a modal or composition", () => {
    window.__ORBIS_HOST__ = { surface: "web" };
    mount("/home", <div role="dialog" aria-label="编辑"><input aria-label="弹窗字段" /></div>);
    fireEvent.keyDown(screen.getByRole("textbox", { name: "弹窗字段" }), { key: "k", ctrlKey: true });
    fireEvent.keyDown(document.body, { key: "k", ctrlKey: true, isComposing: true });
    expect(screen.getByLabelText("route")).toHaveTextContent("/home");
  });
});

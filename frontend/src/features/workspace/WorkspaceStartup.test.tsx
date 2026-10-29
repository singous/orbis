import { cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, expect, it } from "vitest";
import { WorkspaceStartup } from "./WorkspaceStartup";

afterEach(cleanup);

it.each([
  ["/home", "首页", false],
  ["/documents", "在线文档", true],
  ["/settings/account", "全部设置", true],
] as const)("reserves destination chrome at %s without mounting live navigation", (path, title, sidebar) => {
  const { container } = render(<MemoryRouter initialEntries={[path]}><WorkspaceStartup /></MemoryRouter>);
  expect(screen.getByRole("heading", { name: title })).toBeVisible();
  expect(screen.getByRole("status", { name: `正在打开${title}…` })).toHaveAttribute("aria-busy", "true");
  expect(container.querySelector(".workspace-main-navigation")).toHaveAttribute("aria-hidden", "true");
  expect(Boolean(container.querySelector(".workspace-sidebar"))).toBe(sidebar);
  expect(container.querySelectorAll("a, button, input")).toHaveLength(0);
  expect(container.querySelector(".loading-layout--editor")).toBeNull();
  expect(container.querySelectorAll(".workspace-loading-panel")).toHaveLength(path === "/home" ? 2 : 0);
});

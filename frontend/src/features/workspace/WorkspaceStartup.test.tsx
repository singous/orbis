import { cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, expect, it } from "vitest";
import { WorkspaceStartup } from "./WorkspaceStartup";
import type { WorkspaceLoadingKind } from "./WorkspaceLoadingContent";

afterEach(cleanup);

it.each([
  ["/home", undefined, "首页", "正在打开首页…"],
  ["/documents", "notebook-shelf", "我的文档", "正在加载笔记本…"],
  ["/settings/account", undefined, "全部设置", "正在打开全部设置…"],
] satisfies [string, WorkspaceLoadingKind | undefined, string, string][])("reserves destination chrome at %s without mounting live navigation", (path, loadingKind, title, label) => {
  const { container } = render(<MemoryRouter initialEntries={[path]}><WorkspaceStartup loadingKind={loadingKind} /></MemoryRouter>);
  expect(screen.getByRole("heading", { name: title })).toBeVisible();
  expect(screen.getByRole("status", { name: label })).toHaveAttribute("aria-busy", "true");
  expect(container.querySelector(".workspace-main-navigation")).toHaveAttribute("aria-hidden", "true");
  expect(container.querySelector(".workspace-sidebar")).toBeInTheDocument();
  expect(container.querySelectorAll(".workspace-main-navigation a, .workspace-main-navigation button, .workspace-main-navigation input")).toHaveLength(0);
  expect(container.querySelector(".loading-layout--editor")).toBeNull();
  expect(container.querySelectorAll(".workspace-loading-panel")).toHaveLength(path === "/home" ? 2 : 0);
});

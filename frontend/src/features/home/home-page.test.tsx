import type { ReactNode } from "react";
import { cleanup, render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, expect, it, vi } from "vitest";

import { HomePage } from "./HomePage";

const openSearch = vi.hoisted(() => vi.fn());

vi.mock("../workspace/WorkspaceShell", () => ({ WorkspaceShell: ({ children }: { children: ReactNode }) => <main>{children}</main> }));
vi.mock("../search/search-palette-context", () => ({ useSearchPalette: () => ({ isOpen: false, openSearch }) }));
vi.mock("../documents/queries", () => ({
  useDocumentGroups: () => ({ data: { items: [] } }),
  useNotebooks: () => ({ data: { items: [] } }),
  useDocumentIndex: () => ({ data: { items: [] }, isLoading: false, isError: false }),
}));

afterEach(cleanup);

function renderHome() {
  return render(<MemoryRouter><HomePage /></MemoryRouter>);
}

it("shows implemented home entries without planned-feature cards", () => {
  renderHome();
  const entries = screen.getByRole("region", { name: "功能入口" });

  expect(within(entries).getByRole("link", { name: /在线文档/ })).toHaveAttribute("href", "/documents");
  expect(within(entries).getByRole("link", { name: /我的笔记本/ })).toHaveAttribute("href", "/documents/collections");
  expect(within(entries).getByRole("link", { name: /最近编辑/ })).toHaveAttribute("href", "/documents/recent");
  expect(within(entries).getByRole("button", { name: /全局搜索/ })).toHaveAttribute("aria-haspopup", "dialog");
  expect(screen.queryByRole("link", { name: /知识库|记忆/ })).not.toBeInTheDocument();
  expect(screen.queryByText(/即将推出|即将上线|正在建设中/)).not.toBeInTheDocument();
});

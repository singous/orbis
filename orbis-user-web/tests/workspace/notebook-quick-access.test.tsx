import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, expect, it, vi } from "vitest";
import { NotebookQuickAccess } from "../../src/features/workspace/NotebookQuickAccess";
import { authStore } from "../../src/shared/auth/auth-store";
const query = vi.hoisted(() => vi.fn(() => ({ data: { items: [{ id: "quick", title: "快捷笔记本" }, { id: "other", title: "普通笔记本" }] } })));
vi.mock("../../src/features/documents/queries", () => ({ useNotebooks: query }));
vi.mock("../../src/features/documents/pinned-notebooks", () => ({ usePinnedNotebooks: () => ({ isPinned: (id: string) => id === "quick" }) }));
afterEach(() => { cleanup(); query.mockClear(); authStore.getState().clearSession(); });
it("loads only when opened and shows explicitly saved shortcuts", () => {
  authStore.setState({ accessToken: "test" });
  render(<MemoryRouter initialEntries={["/documents"]}><NotebookQuickAccess active /></MemoryRouter>);
  expect(query).not.toHaveBeenCalled();
  const trigger = screen.getByRole("link", { name: "在线文档" });
  fireEvent.mouseEnter(trigger.parentElement!);
  expect(screen.getByRole("navigation", { name: "笔记本快捷访问" })).toBeInTheDocument();
  expect(screen.getByRole("link", { name: "快捷笔记本" })).toHaveAttribute("href", "/collections/quick");
  expect(screen.queryByRole("link", { name: "普通笔记本" })).toBeNull();
  fireEvent.keyDown(document, { key: "Escape" });
  expect(screen.queryByRole("navigation", { name: "笔记本快捷访问" })).toBeNull();
});
it("closes safely when authentication ends", () => {
  authStore.setState({ accessToken: "test" });
  render(<MemoryRouter><NotebookQuickAccess active /></MemoryRouter>);
  fireEvent.mouseEnter(screen.getByRole("link", { name: "在线文档" }).parentElement!);
  act(() => authStore.getState().clearSession());
  expect(screen.queryByRole("navigation", { name: "笔记本快捷访问" })).toBeNull();
});

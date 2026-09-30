import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { authStore } from "../../src/shared/auth/auth-store";
import { usePinnedNotebooks } from "../../src/features/documents/pinned-notebooks";
import { WorkspaceNavigation } from "../../src/features/workspace/WorkspaceNavigation";
import { DocumentOverviewPage } from "../../src/features/documents/DocumentOverviewPage";

const fixtures = vi.hoisted(() => ({
  notebooks: Array.from({ length: 8 }, (_, index) => ({ id: `notebook-${index}`, group_id: index < 4 ? "work" : "personal", title: `笔记本 ${index}`, sort_order: index, created_at_ms: 1, updated_at_ms: index + 1 })),
  create: vi.fn(),
}));
vi.mock("../../src/features/documents/queries", () => ({
  useNotebooks: () => ({ data: { items: fixtures.notebooks }, isSuccess: true }),
  useDocumentGroups: () => ({ data: { items: [{ id: "work", name: "工作" }, { id: "personal", name: "个人" }] }, isSuccess: true }),
  useNoteSearch: () => ({ data: { items: [{ id: "note-1", notebook_id: "notebook-0" }, { id: "note-2", notebook_id: "notebook-0" }] }, isSuccess: true }),
  useCreateNotebook: () => ({ mutateAsync: fixtures.create, isPending: false }),
}));
vi.mock("../../src/features/documents/DocumentShell", () => ({ DocumentShell: ({ children }: { children: React.ReactNode }) => <>{children}</> }));
vi.mock("../../src/features/documents/NotebookDialog", () => ({ NotebookDialog: ({ open, onSubmit }: { open: boolean; onSubmit: (value: unknown) => void }) => open ? <button onClick={() => onSubmit({ title: "新本", icon: null })}>提交新本</button> : null }));
let sequence = 0;
function PinControl() {
  const workspace = authStore.getState().workspace;
  const { togglePin } = usePinnedNotebooks(workspace?.id);
  return <button onClick={() => togglePin("notebook-0")}>切换测试常用</button>;
}
beforeEach(() => {
  fixtures.create.mockReset().mockResolvedValue(fixtures.notebooks[0]);
  authStore.setState({ workspace: { id: `layout-${++sequence}`, name: "测试空间", workspace_type: "private", role: "owner", is_current: true, created_at_ms: 1, updated_at_ms: 1 } });
});
afterEach(() => { cleanup(); authStore.getState().clearSession(); });

describe("notebook layout", () => {
  it("shows only explicitly common notebooks in navigation and updates immediately", () => {
    render(<MemoryRouter initialEntries={["/documents"]}><WorkspaceNavigation /><PinControl /></MemoryRouter>);
    const navigation = screen.getByRole("navigation", { name: "文档导航" });
    expect(within(navigation).queryByRole("link", { name: "笔记本 0" })).toBeNull();
    expect(within(navigation).queryByRole("link", { name: "笔记本 7" })).toBeNull();
    fireEvent.click(screen.getByText("切换测试常用"));
    expect(within(navigation).getByRole("link", { name: "笔记本 0" })).toHaveAttribute("href", "/collections/notebook-0");
    fireEvent.click(screen.getByText("切换测试常用"));
    expect(within(navigation).queryByRole("link", { name: "笔记本 0" })).toBeNull();
  });
  it("shows all notebooks in their groups and shares common settings with navigation", () => {
    render(<MemoryRouter initialEntries={["/documents"]}><WorkspaceNavigation /><DocumentOverviewPage /></MemoryRouter>);
    expect(within(screen.getByRole("region", { name: "工作" })).getAllByRole("link")).toHaveLength(4);
    expect(within(screen.getByRole("region", { name: "个人" })).getAllByRole("link")).toHaveLength(4);
    expect(screen.getByText("文档 2")).toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "快捷访问" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "加入快捷访问：笔记本 0" }));
    expect(screen.getByRole("region", { name: "快捷访问" })).toBeInTheDocument();
    expect(within(screen.getByRole("navigation", { name: "文档导航" })).getByRole("link", { name: "笔记本 0" })).toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "最近更新" })).toBeNull();
  });
  it("opens a creation dialog and creates a notebook directly", async () => {
    render(<MemoryRouter initialEntries={["/documents"]}><DocumentOverviewPage /></MemoryRouter>);
    fireEvent.click(screen.getByRole("button", { name: "新建笔记本" }));
    await act(async () => { fireEvent.click(screen.getByText("提交新本")); });
    expect(fixtures.create).toHaveBeenCalledWith({ title: "新本", icon: null, sort_order: 8 });
  });
  it("synchronizes common notebook changes from another browser tab", () => {
    render(<MemoryRouter initialEntries={["/documents"]}><WorkspaceNavigation /></MemoryRouter>);
    const key = `orbis.pinnedNotebooks.${authStore.getState().workspace!.id}`;
    act(() => {
      localStorage.setItem(key, JSON.stringify(["notebook-1"]));
      window.dispatchEvent(new StorageEvent("storage", { key }));
    });
    expect(screen.getByRole("link", { name: "笔记本 1" })).toBeInTheDocument();
  });
});

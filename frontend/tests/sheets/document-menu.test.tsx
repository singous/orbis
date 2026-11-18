import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { ReactNode } from "react";
import { SheetWorkspace } from "../../src/features/sheets/SheetWorkspace";
import { newField, type Sheet } from "../../src/features/sheets/model";
import { authStore } from "../../src/shared/auth/auth-store";
import { registerPendingNavigation } from "../../src/shared/navigation/pending-navigation";

const calls = vi.hoisted(() => ({ archive: vi.fn(), notebook: vi.fn() }));
vi.mock("../../src/shared/auth/use-auth-request", () => ({ useAuthRequest: () => ({ workspaceId: "space", accessToken: "token" }) }));
vi.mock("../../src/features/documents/queries", () => ({ useNotebook: () => ({ data: { title: "笔记本" } }), useArchiveNote: () => ({ isPending: false, mutateAsync: calls.archive }) }));
vi.mock("../../src/features/documents/api", () => ({ getNotebook: calls.notebook }));
vi.mock("../../src/features/documents/NotebookSectionMenu", () => ({ createNotebookSidebar: () => undefined }));
vi.mock("../../src/features/workspace/WorkspaceShell", () => ({ WorkspaceShell: ({ toolbar, children }: { toolbar?: ReactNode; children: ReactNode }) => <main>{toolbar}{children}</main> }));
vi.mock("../../src/features/documents/DocumentShell", () => ({ DocumentShell: ({ children }: { children: ReactNode }) => <main>{children}</main> }));
vi.mock("../../src/features/members/api", () => ({ listMemberChoices: async () => ({ items: [] }) }));
vi.mock("../../src/features/sheets/api", () => ({ sheetAPI: () => api }));

const field = newField();
const metadata: Sheet = {
  id: "sheet", document_id: "document", collection_id: "collection", workspace_id: "space", title: "数据表",
  version: 1, schema_version: 1, data_revision: 1, order_revision: 0, created_at_ms: 1, updated_at_ms: 1,
  definition: { fields: [field], views: [{ id: "view", name: "表格视图", kind: "grid", field_ids: [field.id], widths: {}, filters: [], sorts: [], group_field_id: "", row_height: 40, text_colors: {}, highlight_duplicates: [] }] },
};
const api = { get: async () => metadata, forms: async () => [], records: async () => ({ items: [], next_cursor: "", schema_version: 1, duplicate_ids: {} }), stats: async () => ({ total: 0, groups: [] }) };
const clients: QueryClient[] = [];
const unregister: Array<() => void> = [];
beforeEach(() => {
  calls.archive.mockReset().mockResolvedValue(undefined);
  calls.notebook.mockReset().mockResolvedValue({ directory_version: 17 });
  authStore.setState({ workspace: { id: "space", name: "工作空间", role: "owner", created_at_ms: 1, updated_at_ms: 1 } });
});
afterEach(() => {
  cleanup();
  clients.splice(0).forEach(client => client.clear());
  unregister.splice(0).forEach(dispose => dispose());
  authStore.getState().clearSession();
});
function mount() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  clients.push(client);
  render(<QueryClientProvider client={client}><MemoryRouter initialEntries={["/sheets/sheet"]}><Routes><Route path="/sheets/sheet" element={<SheetWorkspace id="sheet" />} /><Route path="/collections/collection" element={<h1>笔记本目录</h1>} /></Routes></MemoryRouter></QueryClientProvider>);
}

it("copies the current document URL and restores the explicit menu trigger", async () => {
  const user = userEvent.setup();
  const copy = vi.spyOn(navigator.clipboard, "writeText").mockResolvedValue(undefined);
  mount();
  const trigger = await screen.findByRole("button", { name: "更多文档操作" });
  await user.click(trigger);
  await user.click(await screen.findByRole("menuitem", { name: "复制链接" }));
  expect(copy).toHaveBeenCalledExactlyOnceWith(window.location.href);
  await waitFor(() => expect(trigger).toHaveFocus());
});
it("waits for real navigation preparation before archiving with the current notebook version", async () => {
  const user = userEvent.setup();
  let finish!: () => void;
  const prepare = vi.fn(() => new Promise<void>(resolve => { finish = resolve; }));
  unregister.push(registerPendingNavigation(prepare));
  mount();
  await user.click(await screen.findByRole("button", { name: "更多文档操作" }));
  await user.click(await screen.findByRole("menuitem", { name: "归档文档" }));
  expect(prepare).toHaveBeenCalledOnce();
  expect(calls.notebook).not.toHaveBeenCalled();
  expect(calls.archive).not.toHaveBeenCalled();
  await act(async () => finish());
  expect(calls.notebook).toHaveBeenCalledWith("collection", expect.objectContaining({ workspaceId: "space" }));
  expect(calls.archive).toHaveBeenCalledExactlyOnceWith({ id: "document", archived: true, expected_directory_version: 17 });
  expect(await screen.findByRole("heading", { name: "笔记本目录" })).toBeVisible();
});
it("omits the archive action for readers while retaining copy", async () => {
  const user = userEvent.setup();
  authStore.setState({ workspace: { id: "space", name: "工作空间", role: "viewer", created_at_ms: 1, updated_at_ms: 1 } });
  mount();
  await user.click(await screen.findByRole("button", { name: "更多文档操作" }));
  expect(await screen.findByRole("menuitem", { name: "复制链接" })).toBeVisible();
  expect(screen.queryByRole("menuitem", { name: "归档文档" })).not.toBeInTheDocument();
  expect(calls.archive).not.toHaveBeenCalled();
});

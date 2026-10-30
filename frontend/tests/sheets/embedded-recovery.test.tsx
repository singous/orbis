import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { SheetWorkspace } from "../../src/features/sheets/SheetWorkspace";
import { newField, type Changes, type Sheet } from "../../src/features/sheets/model";
import { authStore } from "../../src/shared/auth/auth-store";

const notify = vi.hoisted(() => vi.fn());
vi.mock("../../src/shared/ui/Toast", () => ({ showToast: notify }));
vi.mock("../../src/shared/auth/use-auth-request", () => ({ useAuthRequest: () => ({ workspaceId: "space", accessToken: "token" }) }));
vi.mock("../../src/features/documents/queries", () => ({ useNotebook: () => ({ data: { title: "笔记本" } }), useArchiveNote: () => ({ isPending: false }) }));
vi.mock("../../src/features/documents/NotebookSectionMenu", () => ({ createNotebookSidebar: () => undefined }));
vi.mock("../../src/features/members/api", () => ({ listMemberChoices: async () => ({ items: [] }) }));
vi.mock("../../src/features/sheets/api", () => ({ sheetAPI: () => api }));

const field = newField();
const metadata: Sheet = {
  id: "sheet", document_id: "document", collection_id: "collection", workspace_id: "space", title: "嵌入数据表",
  version: 1, schema_version: 1, data_revision: 1, order_revision: 0, created_at_ms: 1, updated_at_ms: 1,
  definition: { fields: [field], views: [{ id: "view", name: "表格视图", kind: "grid", field_ids: [field.id], widths: {}, filters: [], sorts: [], group_field_id: "", row_height: 40, text_colors: {}, highlight_duplicates: [] }] },
};
const draftKey = "orbis.sheet-draft:undefined:space:sheet";
const api = {
  get: async () => metadata,
  forms: async () => [],
  records: async () => ({ items: [], next_cursor: "", schema_version: 1, duplicate_ids: {} }),
  stats: async () => ({ total: 0, groups: [] }),
  change: vi.fn(),
};
const clients: QueryClient[] = [];

beforeEach(() => {
  sessionStorage.clear();
  api.change.mockReset();
  notify.mockClear();
  authStore.setState({ workspace: { id: "space", name: "工作空间", role: "owner", created_at_ms: 1, updated_at_ms: 1 } });
});
afterEach(() => {
  cleanup();
  clients.forEach(client => client.clear());
  clients.length = 0;
  sessionStorage.clear();
  authStore.getState().clearSession();
});

function mount(readOnly = false) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  clients.push(client);
  render(<QueryClientProvider client={client}><MemoryRouter><SheetWorkspace id="sheet" embedded readOnly={readOnly} /></MemoryRouter></QueryClientProvider>);
}

function pendingDraft(): Changes {
  return { operation_id: "retained-operation", schema_version: 1, records: [{ id: "row", version: 0, values: {} }] };
}

it("retries the identical failed embedded write from its local draft tools", async () => {
  const user = userEvent.setup();
  api.change.mockRejectedValueOnce(new Error("保存回执待确认")).mockResolvedValueOnce({ records: [], deleted: [] });
  mount();
  await user.click((await screen.findAllByRole("button", { name: "添加记录" }))[0]);
  await user.click(await screen.findByRole("button", { name: "本机修改" }));
  const dialog = screen.getByRole("dialog", { name: "本机修改" });
  expect(within(dialog).getByRole("button", { name: "导出本机修改" })).toBeEnabled();
  expect(within(dialog).getByRole("button", { name: "放弃本次修改" })).toBeEnabled();
  const original = JSON.parse(sessionStorage.getItem(draftKey)!);
  expect(api.change).toHaveBeenCalledExactlyOnceWith("sheet", original);
  expect(screen.queryByText("保存回执待确认")).not.toBeInTheDocument();
  expect(notify).toHaveBeenCalledExactlyOnceWith({ title: "保存回执待确认", tone: "danger" });
  await user.click(within(dialog).getByRole("button", { name: "重试保存" }));
  await waitFor(() => expect(sessionStorage.getItem(draftKey)).toBeNull());
  expect(api.change).toHaveBeenCalledTimes(2);
  expect(api.change.mock.calls[1]).toEqual(["sheet", original]);
  await waitFor(() => expect(screen.queryByRole("button", { name: "本机修改" })).not.toBeInTheDocument());
});

it("preserves a restored embedded draft on cancellation and discards it only after confirmation", async () => {
  const user = userEvent.setup();
  const draft = pendingDraft();
  sessionStorage.setItem(draftKey, JSON.stringify(draft));
  mount();
  await user.click(await screen.findByRole("button", { name: "本机修改" }));
  await user.click(screen.getByRole("button", { name: "放弃本次修改" }));
  await user.click(screen.getByRole("button", { name: "取消" }));
  expect(JSON.parse(sessionStorage.getItem(draftKey)!)).toEqual(draft);
  await user.click(screen.getByRole("button", { name: "放弃本次修改" }));
  await user.click(screen.getByRole("button", { name: "确认放弃" }));
  await waitFor(() => expect(sessionStorage.getItem(draftKey)).toBeNull());
  expect(api.change).not.toHaveBeenCalled();
  await waitFor(() => expect(screen.queryByRole("button", { name: "本机修改" })).not.toBeInTheDocument());
});

it("keeps local recovery available in a read-only embed without allowing a write retry", async () => {
  const user = userEvent.setup();
  sessionStorage.setItem(draftKey, JSON.stringify(pendingDraft()));
  mount(true);
  await user.click(await screen.findByRole("button", { name: "本机修改" }));
  const dialog = screen.getByRole("dialog", { name: "本机修改" });
  expect(within(dialog).getByRole("button", { name: "重试保存" })).toBeDisabled();
  expect(within(dialog).getByRole("button", { name: "导出本机修改" })).toBeEnabled();
  expect(within(dialog).getByRole("button", { name: "放弃本次修改" })).toBeEnabled();
  expect(api.change).not.toHaveBeenCalled();
});

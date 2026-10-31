import { Toaster } from "../../src/shared/ui/Toast";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { ApiError } from "../../src/shared/api/api-client";
import { authStore } from "../../src/shared/auth/auth-store";
import { SheetsHome } from "../../src/features/sheets/SheetsHome";

const api = vi.hoisted(() => ({ list: vi.fn(), create: vi.fn() }));
vi.mock("../../src/features/sheets/api", () => ({ sheetAPI: () => api }));
vi.mock("../../src/features/documents/queries", () => ({ useNotebooks: () => ({ data: { items: [{ id: "notebook", title: "笔记本" }] } }) }));
vi.mock("../../src/shared/auth/use-auth-request", () => ({ useAuthRequest: () => ({ accessToken: "a", refreshToken: null, workspaceId: "workspace" }) }));
vi.mock("../../src/features/documents/DocumentShell", () => ({ DocumentShell: ({ children }: { children: React.ReactNode }) => <>{children}</> }));
vi.mock("../../src/shared/ui/Dialog", () => ({
  Dialog: ({ open, children }: { open: boolean; children: React.ReactNode }) => open ? <>{children}</> : null,
  DialogContent: ({ children }: { children: React.ReactNode }) => <section>{children}</section>,
  DialogFooter: ({ children }: { children: React.ReactNode }) => <footer>{children}</footer>,
}));
beforeEach(() => {
  vi.resetAllMocks();
  api.list.mockResolvedValue({ items: [], next_cursor: "" });
  authStore.setState({ workspace: { id: "workspace", name: "工作空间", role: "owner", created_at_ms: 1, updated_at_ms: 1 } });
});
afterEach(() => { cleanup(); authStore.getState().clearSession(); });
it.each([408, 429])("retains the create operation after HTTP %s", async status => {
  api.create.mockRejectedValueOnce(new ApiError(status, "创建回执待确认")).mockResolvedValueOnce({ id: "sheet", document_id: "document", collection_id: "notebook" });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(<QueryClientProvider client={client}><MemoryRouter><SheetsHome /></MemoryRouter><Toaster /></QueryClientProvider>);
  fireEvent.click(screen.getAllByRole("button", { name: "新建数据表" })[0]);
  fireEvent.click(screen.getByRole("button", { name: "创建数据表" }));
  await screen.findByText("创建回执待确认");
  const original = structuredClone(api.create.mock.calls[0][0]);
  fireEvent.click(screen.getByRole("button", { name: "重试创建" }));
  await waitFor(() => expect(api.create).toHaveBeenCalledTimes(2));
  expect(api.create.mock.calls[1][0]).toEqual(original);
});

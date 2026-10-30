import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, expect, it, vi } from "vitest";
import { newField, type Row, type Sheet } from "./model";
import { useSheet } from "./use-sheet";

vi.mock("../../shared/auth/use-auth-request", () => ({ useAuthRequest: () => ({ workspaceId: "space", accessToken: "token" }) }));
vi.mock("./api", () => ({ sheetAPI: () => api }));
let orderRevision = 0;
const field = newField();
const metadata = (): Sheet => ({ id: "sheet", document_id: "document", collection_id: "collection", workspace_id: "space", title: "Grid", version: 1, schema_version: 1, data_revision: orderRevision + 1, order_revision: orderRevision, created_at_ms: 1, updated_at_ms: 1,
  definition: { fields: [field], views: [{ id: "view", name: "Grid", kind: "grid", field_ids: [field.id], widths: {}, filters: [], sorts: [], group_field_id: "", row_height: 40, text_colors: {}, highlight_duplicates: [] }] } });
function record(id: string): Row { return { id, version: 1, position: 1, values: {}, created_at_ms: 1, updated_at_ms: 1, created_by: null, updated_by: null }; }
const api = { get: async () => metadata(), forms: async () => [], stats: async () => ({ total: 2, groups: [] }),
  records: vi.fn(async (_id: string, _view: string, cursor: string) => ({ items: [record(cursor ? "second" : "first")], next_cursor: cursor ? "" : `cursor-${orderRevision}`, schema_version: 1, duplicate_ids: {} })) };
afterEach(() => { cleanup(); sessionStorage.clear(); api.records.mockClear(); orderRevision = 0; });

it("starts a fresh paged query when a peer changes ordering instead of replaying stale cursors", async () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  const hook = renderHook(() => useSheet("sheet", "view", ""), { wrapper });
  await waitFor(() => expect(hook.result.current.rows).toHaveLength(1));
  await act(() => hook.result.current.pages.fetchNextPage());
  await waitFor(() => expect(hook.result.current.rows).toHaveLength(2));
  api.records.mockClear();
  orderRevision = 1;
  await act(() => client.invalidateQueries({ queryKey: ["sheets", "space", "sheet", "meta"] }));
  await waitFor(() => expect(hook.result.current.pages.data?.pageParams).toEqual([{ cursor: "", offset: 0 }]));
  expect(api.records.mock.calls.length).toBeGreaterThan(0);
  expect(api.records.mock.calls.every(call => call[2] === "")).toBe(true);
  hook.unmount(); client.clear();
});

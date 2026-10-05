import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import { useDataTable } from "../../src/features/data-tables/use-table";
import { readTable } from "../../src/features/data-tables/api";
import type { TableHost } from "../../src/features/data-tables/context";
import type { TablePage } from "../../src/features/data-tables/model";

vi.mock("../../src/features/data-tables/api", () => ({
  readTable: vi.fn(),
  mutateTable: vi.fn(),
}));
const host: TableHost = {
  noteId: "note",
  draftScope: "test",
  auth: null,
  readOnly: true,
  shareToken: "share",
};
const page = (view: string, revision = 4): TablePage => ({
  table_id: "table",
  block_id: "block",
  revision,
  content_version: revision,
  view_id: view,
  definition: {
    title: "Table",
    fields: [],
    views: [],
    public_view_id: view,
    public_field_ids: [],
  },
  records: [{ id: view, values: {} }],
  total: 200,
  offset: 0,
  next_offset: 100,
  has_more: true,
  groups: [],
});
beforeEach(() => {
  vi.clearAllMocks();
  sessionStorage.clear();
  history.replaceState({}, "", "/");
});

it("ignores a slow save-triggered refresh from a previously selected view", async () => {
  const pending: Array<{ resolve: (page: TablePage) => void }> = [];
  vi.mocked(readTable).mockImplementation(
    () => new Promise((resolve) => pending.push({ resolve })),
  );
  const { result } = renderHook(() => useDataTable(host, "table", 1, "block"));
  await act(async () => pending[0].resolve(page("A")));
  let stale!: Promise<void>;
  act(() => {
    stale = result.current.refresh();
  });
  act(() => result.current.setViewId("B"));
  await waitFor(() => expect(pending).toHaveLength(3));
  await act(async () => pending[2].resolve(page("B")));
  await act(async () => {
    pending[1].resolve(page("A"));
    await stale;
  });
  expect(result.current.viewId).toBe("B");
  expect(result.current.page?.records[0].id).toBe("B");
});

it("binds subsequent public pages to the version returned by the first page", async () => {
  vi.mocked(readTable).mockResolvedValue(page("A", 7));
  const { result } = renderHook(() => useDataTable(host, "table", 1, "block"));
  await waitFor(() => expect(result.current.page?.revision).toBe(7));
  act(() => result.current.setOffset(100));
  await waitFor(() =>
    expect(readTable).toHaveBeenLastCalledWith(
      "note",
      "table",
      null,
      expect.objectContaining({
        offset: 100,
        revision: 7,
        shareToken: "share",
      }),
    ),
  );
});

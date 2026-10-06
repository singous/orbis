import { act, renderHook, waitFor } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { useDataTable } from "../../src/features/data-tables/use-table";
import {
  readTable,
  mutateTable,
  type TableResult,
} from "../../src/features/data-tables/api";
import type { TableHost } from "../../src/features/data-tables/context";
import type { TablePage } from "../../src/features/data-tables/model";

vi.mock("../../src/features/data-tables/api", () => ({
  readTable: vi.fn(),
  mutateTable: vi.fn(),
}));
vi.mock("../../src/features/data-tables/drafts", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  tableDrafts: {
    read: async () => null,
    candidates: async () => [],
    write: async () => {},
    remove: async () => {},
  },
}));

it("uses the save receipt version when a read refresh still shows the previous version", async () => {
  let release!: (value: TablePage) => void;
  const staleRead = new Promise<TablePage>((resolve) => {
    release = resolve;
  });
  const page = (revision: number): TablePage => ({
    table_id: "table",
    block_id: "block",
    revision,
    content_version: revision,
    view_id: "view",
    definition: {
      title: "Table",
      fields: [],
      views: [],
      public_view_id: "view",
      public_field_ids: [],
    },
    records: [{ id: "row", values: {} }],
    total: 1,
    offset: 0,
    next_offset: 1,
    has_more: false,
    groups: [],
  });
  vi.mocked(readTable)
    .mockResolvedValueOnce(page(1))
    .mockReturnValueOnce(staleRead)
    .mockResolvedValue(page(3));
  let version = 1;
  vi.mocked(mutateTable).mockImplementation(async () => ({
    content_version: ++version,
    table_revision: version,
    table_id: "table",
    block: {
      id: "block",
      type: "dataTable",
      props: {},
      content: [],
      children: [],
    },
    inverse: {},
  }));
  const host: TableHost = {
    noteId: "note",
    draftScope: "receipt-race",
    readOnly: false,
    auth: {
      accessToken: "test",
      refreshToken: null,
      onTokenRefresh: () => {},
      onUnauthorized: () => {},
    },
    transact: async (perform) => perform(version),
  };
  const { result, unmount } = renderHook(() =>
    useDataTable(host, "table", 1, "block"),
  );
  await waitFor(() => expect(result.current.recovering).toBe(false));
  await waitFor(() => expect(result.current.page?.revision).toBe(1));
  act(() =>
    result.current.stage({
      upserts: [{ id: "row", values: { title: "first" } }],
    }),
  );
  let first!: Promise<TableResult | undefined>;
  act(() => {
    first = result.current.save();
  });
  await waitFor(() => expect(readTable).toHaveBeenCalledTimes(2));
  expect(result.current.page?.revision).toBe(1);
  act(() =>
    result.current.stage({
      upserts: [{ id: "row", values: { title: "second" } }],
    }),
  );
  await act(async () => {
    release(page(2));
    await first;
  });
  await act(async () => {
    await result.current.save();
  });
  expect(vi.mocked(mutateTable).mock.calls[1][2].expected_table_revision).toBe(
    2,
  );
  unmount();
});

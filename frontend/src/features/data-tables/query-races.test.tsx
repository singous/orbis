import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import { useDataTable } from "./use-table";
import { readTable } from "./api";
import type { TableHost } from "./context";
import type { TablePage } from "./model";
import { z } from "zod";
const notify = vi.hoisted(() => vi.fn());
vi.mock("../../shared/ui/Toast", () => ({ showToast: notify }));

vi.mock("./api", () => ({
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

it("binds subsequent private pages to the version returned by the first page", async () => {
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
        documentVersion:7,
        revision:7,
      }),
    ),
  );
});

it("clears a table read failure when retry succeeds", async () => {
  vi.mocked(readTable).mockRejectedValueOnce(new Error("First read failed")).mockResolvedValue(page("A"));
  const { result } = renderHook(() => useDataTable(host, "table", 1, "block"));
  await waitFor(() => expect(result.current.error).toBe("First read failed"));
  await act(async () => { await result.current.retry(); });
  expect(result.current.error).toBeNull();
  expect(result.current.page?.view_id).toBe("A");
  expect(result.current.loading).toBe(false);
});

it("reports another read failure without rejecting the UI retry", async () => {
  vi.mocked(readTable).mockRejectedValueOnce(new Error("First read failed")).mockRejectedValueOnce(new Error("Still offline"));
  const { result } = renderHook(() => useDataTable(host, "table", 1, "block"));
  await waitFor(() => expect(result.current.error).toBe("First read failed"));
  await act(async () => { await expect(result.current.retry()).resolves.toBeUndefined(); });
  expect(result.current.error).toBe("Still offline");
  expect(result.current.loading).toBe(false);
});

it("does not replace the current view's status with a failed retry from the previous view", async () => {
  let rejectRetry!: (reason: Error) => void;
  vi.mocked(readTable).mockResolvedValueOnce(page("A"))
    .mockImplementationOnce(() => new Promise((_resolve, reject) => { rejectRetry = reject; }))
    .mockResolvedValue(page("B"));
  const { result } = renderHook(() => useDataTable(host, "table", 1, "block"));
  await waitFor(() => expect(result.current.page?.view_id).toBe("A"));
  let retry!: Promise<void>;
  act(() => { retry = result.current.retry(); });
  act(() => result.current.setViewId("B"));
  await waitFor(() => expect(result.current.page?.view_id).toBe("B"));
  await act(async () => { rejectRetry(new Error("Stale read failed")); await retry; });
  expect(result.current.error).toBeNull();
  expect(result.current.loading).toBe(false);
});

it("reports local response-validation failures on initial load and an explicit retry", async () => {
  const validation = z.object({ revision: z.number() }).safeParse({ revision: "invalid" });
  if (validation.success) throw new Error("expected invalid fixture");
  vi.mocked(readTable).mockRejectedValue(validation.error);
  const { result } = renderHook(() => useDataTable(host, "table", 1, "block"));
  await waitFor(() => expect(notify).toHaveBeenCalledExactlyOnceWith({ title: "服务返回的数据不完整，请刷新重试", tone: "danger" }));
  await act(async () => { await result.current.retry(); });
  expect(notify).toHaveBeenCalledTimes(2);
  expect(result.current.page).toBeNull();
});

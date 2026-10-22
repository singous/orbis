import {
  useInfiniteQuery,
  useQuery,
  useQueryClient,
  type InfiniteData,
} from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useStore } from "zustand";
import { authStore } from "../../shared/auth/auth-store";
import { useAuthRequest } from "../../shared/auth/use-auth-request";
import { newUUID } from "../../shared/ids";
import { sheetAPI, type RecordPage } from "./api";
import { acknowledgeCellDraft, readCellDraft } from "./cell-draft";
import type { Changes, Patch, Row, Sheet } from "./model";

type RecordPageParam = { cursor: string; offset: number };

export function useSheet(id: string, viewId: string, search: string) {
  const auth = useAuthRequest(),
    client = useQueryClient();
  const api = useMemo(() => sheetAPI(auth), [auth]);
  const scope = ["sheets", auth.workspaceId, id];
  const meta = useQuery({
    queryKey: [...scope, "meta"],
    queryFn: ({ signal }) => api.get(id, signal),
    refetchInterval: 3000,
  });
  const view =
    meta.data?.definition.views.find((v) => v.id === viewId) ??
    meta.data?.definition.views[0];
  const pages = useInfiniteQuery<
    RecordPage,
    Error,
    InfiniteData<RecordPage, RecordPageParam>,
    readonly unknown[],
    RecordPageParam
  >({
    queryKey: [...scope, "records", view?.id, meta.data?.version, search],
    enabled: Boolean(view),
    initialPageParam: { cursor: "", offset: 0 },
    queryFn: ({ pageParam, signal }) =>
      api.records(id, view!.id, pageParam.cursor, search, undefined, signal),
    getNextPageParam: (last, _pages, previous) =>
      last.next_cursor
        ? {
            cursor: last.next_cursor,
            offset: previous.offset + last.items.length,
          }
        : undefined,
    maxPages: 10,
  });
  const stats = useQuery({
    queryKey: [...scope, "stats", view?.id, meta.data?.version, search],
    enabled: Boolean(view),
    queryFn: ({ signal }) => api.stats(id, view!.id, search, signal),
    staleTime: 15000,
  });
  const forms = useQuery({
    queryKey: [...scope, "forms"],
    queryFn: ({ signal }) => api.forms(id, signal),
  });
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const [confirmedRows, setConfirmedRows] = useState<Row[]>([]);
  const [discardVersion, setDiscardVersion] = useState(0);
  const request = useRef<Changes | null>(null);
  const userID = useStore(authStore, (state) => state.user?.id);
  const draftKey = `orbis.sheet-draft:${userID}:${auth.workspaceId}:${id}`;
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    try {
      const saved = sessionStorage.getItem(draftKey);
      if (saved) {
        request.current = JSON.parse(saved);
        setError("发现尚未确认的修改，请重试保存。");
      }
    } catch {
      setError("无法读取本机草稿。");
    }
    return () => {
      alive.current = false;
    };
  }, [draftKey]);
  const lock = useRef(false);
  const refresh = useCallback(async () => {
    await client.invalidateQueries({ queryKey: scope });
  }, [client, auth.workspaceId, id]);
  async function change(patches?: Patch[]) {
    if (lock.current) throw new Error("正在保存，请稍候");
    if (patches && !request.current) {
      const pending = sessionStorage.getItem(draftKey);
      if (pending) request.current = JSON.parse(pending);
    }
    if (patches && request.current) throw new Error("请先处理尚未确认的修改");
    if (patches)
      request.current = {
        operation_id: newUUID(),
        schema_version: meta.data!.schema_version,
        records: patches,
      };
    if (!request.current) return;
    // Persist the exact request before sending so a lost acknowledgement can be retried.
    const attempted = request.current;
    const encoded = JSON.stringify(attempted);
    sessionStorage.setItem(draftKey, encoded);
    lock.current = true;
    setBusy(true);
    setError("");
    try {
      const result = await api.change(id, attempted);
      acknowledgeCellDraft(`${draftKey}:cell`, result.records);
      if (alive.current) setConfirmedRows(result.records);
      request.current = null;
      if (sessionStorage.getItem(draftKey) === encoded)
        sessionStorage.removeItem(draftKey);
      if (alive.current) await refresh();
      return result;
    } catch (e) {
      if (alive.current) setError(e instanceof Error ? e.message : "保存失败");
      throw e;
    } finally {
      lock.current = false;
      if (alive.current) setBusy(false);
    }
  }
  async function update(next: Sheet) {
    if (lock.current || request.current) throw new Error("请先完成记录保存");
    lock.current = true;
    setBusy(true);
    setError("");
    try {
      const saved = await api.update(next);
      if (alive.current) {
        client.setQueryData([...scope, "meta"], saved);
        await client.invalidateQueries({
          queryKey: ["sheet-directory", auth.workspaceId],
        });
        await refresh();
        await client.invalidateQueries({ queryKey: ["note-tree"] });
        await client.invalidateQueries({
          queryKey: ["note", saved.document_id],
        });
      }
      return saved;
    } catch (e) {
      if (alive.current) setError(e instanceof Error ? e.message : "保存失败");
      throw e;
    } finally {
      lock.current = false;
      if (alive.current) setBusy(false);
    }
  }
  useEffect(() => {
    if (
      meta.data?.data_revision !== undefined &&
      !lock.current &&
      !request.current
    ) {
      void client.invalidateQueries({ queryKey: [...scope, "records"] });
      void client.invalidateQueries({ queryKey: [...scope, "stats"] });
      void client.invalidateQueries({ queryKey: [...scope, "board"] });
    }
  }, [meta.data?.data_revision]);
  function discard() {
    if (
      request.current &&
      sessionStorage.getItem(draftKey) === JSON.stringify(request.current)
    )
      sessionStorage.removeItem(draftKey);
    request.current = null;
    sessionStorage.removeItem(`${draftKey}:cell`);
    setDiscardVersion((version) => version + 1);
    setError("");
    void refresh();
  }
  return {
    api,
    auth,
    draftKey,
    search,
    meta,
    view,
    pages,
    stats,
    forms,
    confirmedRows,
    discardVersion,
    exportDraft: () =>
      JSON.stringify(
        { operation: request.current, cell: readCellDraft(`${draftKey}:cell`) },
        null,
        2,
      ),
    rowOffset: pages.data?.pageParams[0]?.offset ?? 0,
    rows: Array.from(
      new Map(
        (pages.data?.pages.flatMap((p) => p.items) ?? []).map((row) => [
          row.id,
          row,
        ]),
      ).values(),
    ),
    busy,
    error,
    setError,
    change,
    update,
    refresh,
    discard,
    hasPending: Boolean(request.current),
  };
}
export type SheetController = ReturnType<typeof useSheet>;

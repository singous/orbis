import { useCallback, useEffect, useRef, useState } from "react";
import { ApiError } from "../../shared/api/api-client";
import type { TableHost } from "./context";
import { mutateTable, readTable, type TableResult } from "./api";
import {
  afterAcknowledgement,
  combineChanges,
  hasChanges,
  tableDrafts,
  type TableDraft,
} from "./drafts";
import { tableId, type TableChanges, type TablePage } from "./model";

export function useDataTable(
  host: TableHost,
  id: string,
  revision: number,
  blockId: string,
) {
  const [page, setPage] = useState<TablePage | null>(null);
  const [pending, setPending] = useState<TableChanges>({});
  const [error, setError] = useState<string | null>(null);
  const [storageError, setStorageError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [recovering, setRecovering] = useState(!host.readOnly);
  const [candidates, setCandidates] = useState<TableDraft[]>([]);
  const viewKey = `orbis.table-view.v1:${host.noteId}:${id}`;
  const [viewId, setViewId] = useState<string | undefined>(() => {
    const query = new URLSearchParams(window.location.search);
    if (query.get("table") === blockId && query.get("view"))
      return query.get("view")!;
    try {
      return sessionStorage.getItem(viewKey) ?? undefined;
    } catch {
      return undefined;
    }
  });
  const [offset, setOffset] = useState(0);
  const [historyState, setHistoryState] = useState(0);
  const scope = `${host.draftScope}|table:${id}`;
  const draft = useRef<TableDraft>({
    scope,
    revision,
    changes: {},
    request: null,
    sequence: 0,
  });
  const current = useRef({ host, page, scope });
  current.current = { host, page, scope };
  const inFlight = useRef<Promise<void> | null>(null);
  const saveAgain = useRef(false);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const undo = useRef<TableChanges[]>([]),
    redo = useRef<TableChanges[]>([]);
  const generation = useRef(0);
  const mounted = useRef(true);
  const query = useRef({ id, viewId, offset });
  query.current = { id, viewId, offset };
  const paging = useRef<{
    viewId: string | undefined;
    revision: number;
    blockRevision: number;
  } | null>(null);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      generation.current++;
    };
  }, []);
  const refresh = useCallback(
    async (signal?: AbortSignal, restart = false) => {
      if (!id) return;
      const requestGeneration = ++generation.current;
      const expected =
        offset > 0 && !restart
          ? paging.current !== null && paging.current.viewId === viewId &&
            paging.current.blockRevision === revision
            ? paging.current.revision
            : revision
          : undefined;
      const next = await readTable(host.noteId, id, host.auth, {
        viewId,
        offset,
        revision: expected,
        shareToken: host.shareToken,
        signal,
      });
      if (
        mounted.current &&
        requestGeneration === generation.current &&
        !signal?.aborted &&
        query.current.id === id &&
        query.current.viewId === viewId &&
        query.current.offset === offset
      ) {
        paging.current = {
          viewId,
          revision: next.revision,
          blockRevision: revision,
        };
        setPage(next);
      }
    },
    [id, host.noteId, host.auth, host.shareToken, viewId, offset, revision],
  );
  const refreshRef = useRef(refresh);
  refreshRef.current = refresh;

  useEffect(() => {
    const abort = new AbortController();
    generation.current++;
    setLoading(Boolean(id));
    setError(null);
    if (id)
      void refresh(abort.signal)
        .catch((error) => {
          if (!abort.signal.aborted) setError(error.message);
        })
        .finally(() => {
          if (!abort.signal.aborted) setLoading(false);
        });
    return () => abort.abort();
  }, [refresh, revision]);

  useEffect(() => {
    if (host.readOnly || !id || !host.draftScope) {
      setRecovering(false);
      return;
    }
    let active = true;
    setRecovering(true);
    draft.current = {
      scope,
      revision,
      changes: {},
      request: null,
      sequence: 0,
    };
    void tableDrafts
      .read(scope)
      .then(async (saved) => {
        if (active && saved) {
          draft.current = saved;
          setPending(saved.changes);
        } else if (active) {
          const alternatives = await tableDrafts.candidates(scope);
          if (active) setCandidates(alternatives);
        }
      })
      .catch((error) => {
        if (active) setStorageError(error.message);
      })
      .finally(() => {
        if (active) setRecovering(false);
      });
    return () => {
      active = false;
      if (saveTimer.current) clearTimeout(saveTimer.current);
    };
  }, [scope, host.readOnly, id]);

  function persist() {
    const value = structuredClone(draft.current);
    void tableDrafts
      .write(value)
      .then(() => setStorageError(null))
      .catch((error) => setStorageError(error.message));
  }
  function stage(changes: TableChanges) {
    if (host.readOnly || !page || recovering || page.block_id !== blockId)
      return;
    const old = draft.current;
    draft.current = {
      ...old,
      scope,
      revision: hasChanges(old.changes) ? old.revision : page.revision,
      changes: combineChanges(old.changes, changes),
      sequence: old.sequence + 1,
    };
    setPending(draft.current.changes);
    persist();
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      void save().catch(() => {});
    }, 750);
  }

  async function save(recordHistory = true) {
    if (saveTimer.current) {
      clearTimeout(saveTimer.current);
      saveTimer.current = null;
    }
    if (inFlight.current) {
      saveAgain.current = true;
      await inFlight.current;
      return;
    }
    const state = current.current;
    if (
      !state.host.transact ||
      !state.host.auth ||
      !hasChanges(draft.current.changes)
    )
      return;
    const owner = state.scope;
    let succeeded = false;
    const task = (async () => {
      setSaving(true);
      setError(null);
      try {
        const result = await state.host.transact!(async (version) => {
          if (!mounted.current || current.current.scope !== owner)
            throw new Error(
              "表格引用已经更新，本机修改仍保留，请在当前表格中继续操作。",
            );
          const request = draft.current.request ?? {
            ...structuredClone(draft.current.changes),
            operation_id: tableId(),
            block_id: blockId,
            expected_document_version: version,
            expected_table_revision: draft.current.revision,
          };
          draft.current = { ...draft.current, request };
          await tableDrafts
            .write(structuredClone(draft.current))
            .catch((error) => setStorageError(error.message));
          return mutateTable(state.host.noteId, id, request, state.host.auth!);
        });
        if (current.current.scope !== owner) return;
        const sent = draft.current.request!;
        const remaining = afterAcknowledgement(draft.current.changes, sent);
        draft.current = {
          ...draft.current,
          revision: result.table_revision,
          changes: remaining,
          request: null,
          sequence: draft.current.sequence + 1,
        };
        setPending(remaining);
        if (hasChanges(remaining)) persist();
        else
          await tableDrafts
            .remove(owner, draft.current.sequence)
            .catch((error) => setStorageError(error.message));
        if (recordHistory) {
          undo.current.push(result.inverse);
          redo.current = [];
          setHistoryState((value) => value + 1);
        }
        succeeded = true;
        await refreshRef.current(undefined, true);
        return result;
      } catch (error) {
        if (error instanceof ApiError && error.status === 422) {
          draft.current = { ...draft.current, request: null };
          persist();
        }
        if (current.current.scope === owner)
          setError(
            error instanceof Error
              ? error.message
              : "表格保存失败，本机修改仍保留",
          );
        throw error;
      } finally {
        if (current.current.scope === owner) setSaving(false);
      }
    })();
    inFlight.current = task.then(
      () => {},
      () => {},
    );
    try {
      return await task;
    } finally {
      inFlight.current = null;
      const repeat = saveAgain.current;
      saveAgain.current = false;
      if (succeeded && repeat && hasChanges(draft.current.changes))
        queueMicrotask(() => {
          void save().catch(() => {});
        });
    }
  }

  async function travel(direction: "undo" | "redo") {
    if (hasChanges(draft.current.changes) || saving) return;
    const from = direction === "undo" ? undo.current : redo.current;
    const to = direction === "undo" ? redo.current : undo.current;
    const changes = from.at(-1);
    if (!changes) return;
    stage(changes);
    try {
      const result = await save(false);
      if (result) {
        from.pop();
        to.push(result.inverse);
        setHistoryState((value) => value + 1);
      }
    } catch {
      /* The draft and visible error retain this operation. */
    }
  }

  async function reapply() {
    await host.reload?.();
    await refreshRef.current();
    const latest = await readTable(host.noteId, id, host.auth, {
      viewId,
      offset,
    });
    setPage(latest);
    draft.current = {
      ...draft.current,
      revision: latest.revision,
      request: null,
      sequence: draft.current.sequence + 1,
    };
    persist();
    setError(null);
  }
  function recover(saved: TableDraft) {
    if (hasChanges(draft.current.changes) || saving) return;
    draft.current = {
      ...structuredClone(saved),
      scope,
      sequence: draft.current.sequence + 1,
    };
    setPending(draft.current.changes);
    setCandidates([]);
    persist();
  }
  const definition = pending.definition ?? page?.definition;
  const rows =
    page?.records
      .map((row) => ({
        ...row,
        values: {
          ...row.values,
          ...pending.upserts?.find((item) => item.id === row.id)?.values,
        },
      }))
      .filter((row) => !pending.deletes?.includes(row.id)) ?? [];
  if (offset === 0)
    for (const row of pending.upserts ?? [])
      if (!rows.some((item) => item.id === row.id)) rows.push(row);
  return {
    page,
    rows,
    definition,
    pending,
    error,
    storageError,
    loading,
    saving,
    recovering,
    candidates,
    recover,
    stage,
    save,
    refresh,
    reapply,
    travel,
    canUndo: Boolean(undo.current.length),
    canRedo: Boolean(redo.current.length),
    dirty: hasChanges(pending),
    viewId: viewId ?? page?.view_id,
    setViewId: (id: string) => {
      setViewId(id);
      setOffset(0);
      try {
        sessionStorage.setItem(viewKey, id);
      } catch {
        /* View preferences do not affect authored data. */
      }
      const url = new URL(window.location.href);
      if (url.searchParams.get("table") === blockId) {
        url.searchParams.set("view", id);
        history.replaceState({}, "", url);
      }
    },
    offset,
    setOffset,
    historyState,
  };
}

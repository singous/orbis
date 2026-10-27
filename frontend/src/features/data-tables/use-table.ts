import { reportError } from "../../shared/api/request-feedback";
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
  useEffect(() => { if (storageError) reportError(storageError); }, [storageError]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const canRecover=host.canRecoverDraft??!host.readOnly;
  const [recovering, setRecovering] = useState(canRecover);
  const recoveryTask=useRef<Promise<void>|null>(null);
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
  const current = useRef({ host, page, scope,error });
  current.current = { host, page, scope,error };
  const inFlight = useRef<Promise<TableResult | undefined> | null>(null);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const undo = useRef<TableChanges[]>([]),
    redo = useRef<TableChanges[]>([]);
  const generation = useRef(0);
  const acknowledged = useRef({ documentVersion: 0, revision });
  const mounted = useRef(true);
  const query = useRef({ id, viewId, offset });
  query.current = { id, viewId, offset };
  const paging = useRef<{
    viewId: string | undefined;
    revision: number;
    blockRevision: number;
    documentVersion:number;
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
      const pinned=offset>0&&!restart&&paging.current!==null&&paging.current.viewId===viewId&&paging.current.blockRevision===revision;
      const expected=offset>0&&!restart ? pinned?paging.current!.revision:revision : undefined;
      let next: TablePage;
      try {
        next = await readTable(host.noteId, id, host.auth, {
          viewId,
          offset,
          revision: expected,
          documentVersion:pinned ? paging.current!.documentVersion : host.documentVersion?.(),
          signal,
        });
      } catch (error) {
        if (
          viewId &&
          error instanceof ApiError &&
          (error.code === "VALIDATION_ERROR" && (error.data as {errors?:Array<{field?:string}>}|null)?.errors?.some(issue=>issue.field==="query.view_id")) &&
          error.status === 422 &&
          mounted.current &&
          requestGeneration === generation.current
        ) {
          setViewId(undefined);
          setOffset(0);
          try {
            sessionStorage.removeItem(viewKey);
          } catch {
            /* Preferences are optional. */
          }
          const url = new URL(window.location.href);
          if (url.searchParams.get("table") === blockId) {
            url.searchParams.delete("view");
            history.replaceState({}, "", url);
          }
          return;
        }
        throw error;
      }
      if (
        mounted.current &&
        requestGeneration === generation.current &&
        !signal?.aborted &&
        query.current.id === id &&
        query.current.viewId === viewId &&
        query.current.offset === offset
      ) {
        if (next.content_version < acknowledged.current.documentVersion) return;
        acknowledged.current = {
          documentVersion: next.content_version,
          revision: next.revision,
        };
        paging.current = {
          viewId,
          revision: next.revision,
          blockRevision: revision,
          documentVersion:next.content_version,
        };
        setPage(next);
      }
    },
    [id, host.noteId, host.auth, host.shareToken, viewId, offset, revision],
  );
  const refreshRef = useRef(refresh);
  refreshRef.current = refresh;

  async function retry() {
    setLoading(true);
    setError(null);
    const task = refresh();
    const requestGeneration = generation.current;
    try {
      await task;
    } catch (error) {
      if (mounted.current && requestGeneration === generation.current)
        setError(error instanceof Error ? error.message : "数据表读取失败，请重试。");
    } finally {
      if (mounted.current && requestGeneration === generation.current)
        setLoading(false);
    }
  }

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
    if (!canRecover || !id || !host.draftScope) {
      setRecovering(false);
      return;
    }
    if(draft.current.scope===scope&&(hasChanges(draft.current.changes)||draft.current.request||draft.current.prepared)){setRecovering(false);return;}
    let active = true;
    setRecovering(true);
    draft.current = {
      scope,
      revision,
      changes: {},
      request: null,
      sequence: 0,
    };
    const task=tableDrafts
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
        if(recoveryTask.current===task)recoveryTask.current=null;
      });
    recoveryTask.current=task;
    return () => {
      active = false;
      if (saveTimer.current) clearTimeout(saveTimer.current);
    };
  }, [scope, canRecover, id]);

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
      revision: hasChanges(old.changes)
        ? old.revision
        : acknowledged.current.revision,
      changes: combineChanges(old.changes, changes),
      sequence: old.sequence + 1,
    };
    setPending(draft.current.changes);
    if(!draft.current.request)setError(null);
    persist();
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      void save().catch(() => {});
    }, 750);
  }

  async function save(recordHistory = true): Promise<TableResult | undefined> {
    if (saveTimer.current) {
      clearTimeout(saveTimer.current);
      saveTimer.current = null;
    }
    if (inFlight.current) {
      const completed = await inFlight.current;
      return hasChanges(draft.current.changes)
        ? save(recordHistory)
        : completed;
    }
    const state = current.current;
    if (
      !state.host.transact ||
      !state.host.auth ||
      (!hasChanges(draft.current.changes)&&!draft.current.request)
    )
      return;
    const owner = state.scope;
    const wasUncertain=Boolean(draft.current.request&&!draft.current.requestRejected);
    if(!draft.current.request&&!draft.current.prepared){
      draft.current={...draft.current,prepared:{operation_id:tableId(),expected_table_revision:draft.current.revision,changes:structuredClone(draft.current.changes)}};
      persist();
    }
    const prepared=draft.current.prepared;
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
            ...structuredClone(prepared!.changes),
            operation_id: prepared!.operation_id,
            block_id: blockId,
            expected_document_version: version,
            expected_table_revision: prepared!.expected_table_revision,
          };
          draft.current = { ...draft.current, request,requestRejected:false };
          await tableDrafts
            .write(structuredClone(draft.current))
            .catch((error) => setStorageError(error.message));
          return mutateTable(state.host.noteId, id, request, state.host.auth!);
        });
        if (current.current.scope !== owner) return;
        if (result.content_version >= acknowledged.current.documentVersion)
          acknowledged.current = {
            documentVersion: result.content_version,
            revision: result.table_revision,
          };
        const sent = draft.current.request!;
        const remaining = afterAcknowledgement(draft.current.changes, sent);
        draft.current = {
          ...draft.current,
          revision: result.table_revision,
          changes: remaining,
          request: null,requestRejected:undefined,
          prepared:undefined,
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
        await refreshRef.current(undefined, true);
        return result;
      } catch (error) {
        if(!mounted.current||current.current.scope!==owner)throw error;
        let failure=error;
        if(draft.current.request){
          const rejected=error instanceof ApiError&&error.status>=400&&error.status<500;
          if(rejected&&!wasUncertain){
            draft.current=error.status===422?{...draft.current,request:null,requestRejected:undefined,prepared:undefined}:{...draft.current,requestRejected:true};
          }else{
            draft.current={...draft.current,requestRejected:false};
            if(rejected)failure=new ApiError(503, "上次表格保存结果尚未确认，请重试原操作。本机修改仍保留。", "TABLE_WRITE_RESULT_UNKNOWN", "", null, { cause: error });
          }
          persist();
        }
        if(current.current.scope===owner)setError(failure instanceof Error?failure.message:"表格保存失败，本机修改仍保留");
        throw failure;
      } finally {
        if (current.current.scope === owner) setSaving(false);
      }
    })();
    inFlight.current = task;
    try {
      return await task;
    } finally {
      if (inFlight.current === task) inFlight.current = null;
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
    if(inFlight.current)throw new Error("表格仍在保存，请等待结果确认。");
    if(draft.current.request&&!draft.current.requestRejected)throw new ApiError(503,"上次表格保存结果尚未确认，请先重试保存。本机修改仍保留。","TABLE_WRITE_RESULT_UNKNOWN");
    if(saveTimer.current){clearTimeout(saveTimer.current);saveTimer.current=null;}
    const owner=scope;
    await host.reload?.();
    if(!mounted.current||current.current.scope!==owner)throw new DOMException("The table scope changed","AbortError");
    await refreshRef.current();
    const latest=await readTable(host.noteId,id,host.auth,{viewId,offset,documentVersion:host.documentVersion?.()});
    if(!mounted.current||current.current.scope!==owner)throw new DOMException("The table scope changed","AbortError");
    setPage(latest);
    draft.current={...draft.current,revision:latest.revision,prepared:{operation_id:tableId(),expected_table_revision:latest.revision,changes:structuredClone(draft.current.changes)},request:null,requestRejected:undefined,sequence:draft.current.sequence+1};
    persist();setError(null);
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
  const saveRef=useRef(save);saveRef.current=save;
  useEffect(()=>{
    if(!host.registerWriter||!id||!host.draftScope)return;
    return host.registerWriter(blockId,{
      hasPending:()=>Boolean(recoveryTask.current||hasChanges(draft.current.changes)||draft.current.request||inFlight.current),
      flush:async()=>{
        if(recoveryTask.current)await recoveryTask.current;
        if(!mounted.current||current.current.scope!==scope)throw new DOMException("The table scope changed","AbortError");
        if(draft.current.requestRejected||(!draft.current.request&&hasChanges(draft.current.changes)&&current.current.error))throw new Error(current.current.error??"表格存在未同步修改，请先处理表格保存冲突。");
        await saveRef.current();
      },
    });
  },[host.registerWriter,host.draftScope,id,blockId,scope]);
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
    retry,
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

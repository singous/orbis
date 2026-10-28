import { ConfirmAction } from "../../shared/ui/ConfirmAction";
import { DraftActions } from "../../shared/ui/DraftActions";
import { Button } from "../../shared/ui/Button";

import { useVirtualizer } from "@tanstack/react-virtual";
import { ChevronDown, Expand, GripVertical, Plus } from "lucide-react";
import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type CSSProperties,
} from "react";
import type { AuthRequestOptions } from "../../shared/auth/use-auth-request";
import { newUUID } from "../../shared/ids";
import { registerPendingNavigation } from "../../shared/navigation/pending-navigation";
import { ActionButton } from "../../shared/ui/ActionButton";
import { CellValue } from "./Cell";
import { CellEditor, type CellNavigation } from "./CellEditor";
import {
  clearCellDraft,
  readCellDraft,
  storeCellDraft,
  type CellDraft,
} from "./cell-draft";
import { copyRecordCells, pasteRecordCells, duplicateRecord } from "./record-actions";
import { SheetRecordMenu } from "./SheetRecordMenu";
import { usePointerReorder } from "./use-pointer-reorder";
import { FieldIcon } from "./FieldIcon";
import { moveGridSelection, type GridPoint as Point } from "./grid-navigation";
import {
  KINDS,
  MAX_BATCH,
  parseCell,
  type Field,
  type Patch,
  type Row,
  type Value,
  type View,
} from "./model";
import { anchorAt, type Anchor } from "./Popover";

const ROW_HEADER_WIDTH = 104;

export function SheetGrid({
  rows,
  confirmedRows,
  draftKey,
  discardVersion,
  rowOffset,
  total,
  fields: allFields,
  duplicates = {},
  view,
  readOnly,
  busy,
  hasPending,
  auth,
  onChange,
  onFieldMenu,
  onNewField,
  onWidth,
  onCreateOption,
  onInspect,
  onDraftChange,
  onAdd,
  hasMore,
  loading,
  onMore,
  onRefresh,
  onError,
  manualOrder = true,
}: {
  manualOrder?: boolean;
  rows: Row[];
  confirmedRows: Row[];
  draftKey: string;
  discardVersion: number;
  rowOffset: number;
  total?: number;
  fields: Field[];
  duplicates?: Record<string, string[]>;
  view: View;
  readOnly: boolean;
  busy: boolean;
  hasPending: boolean;
  auth: AuthRequestOptions;
  onChange: (patches: Patch[]) => Promise<unknown>;
  onFieldMenu: (f: Field, anchor: Anchor) => void;
  onNewField: (anchor: Anchor) => void;
  onWidth: (id: string, width: number) => void;
  onCreateOption: (field: Field, label: string) => Promise<string>;
  onInspect: (row: Row) => void;
  onDraftChange: (dirty: boolean) => void;
  onAdd: () => void;
  hasMore: boolean;
  loading: boolean;
  onMore: () => Promise<unknown>;
  onRefresh: () => void;
  onError: (error: unknown) => void;
}) {
  const [rowHeaderWidth, setRowHeaderWidth] = useState(ROW_HEADER_WIDTH);
  useEffect(() => {
    const media = window.matchMedia("(pointer: coarse)");
    const update = () => setRowHeaderWidth(media.matches ? 144 : ROW_HEADER_WIDTH);
    update(); media.addEventListener?.("change", update);
    return () => media.removeEventListener?.("change", update);
  }, []);
  const scroller = useRef<HTMLDivElement>(null),
    dragging = useRef(false);
  const fields = useMemo(
    () =>
      view.field_ids
        .map((id) => allFields.find((f) => f.id === id)!)
        .filter(Boolean),
    [allFields, view.field_ids],
  );
  const [start, setStart] = useState<Point | null>(null),
    [end, setEnd] = useState<Point | null>(null),
    [editing, setEditing] = useState<{
      row: Row;
      field: Field;
      value: Value;
      initial?: string;
    } | null>(null),
    [selected, setSelected] = useState<Set<string>>(new Set());
  const [contextMenu, setContextMenu] = useState<{ anchor: Anchor; rowID: string; col?: number } | null>(null);
  const rowReorder = usePointerReorder((id, target, after) => {
    if (readOnly || busy || hasPending || !manualOrder) return;
    void commit().then(ok => {
      if (!ok) return;
      const row = latest.current.rows.find(row => row.id === id);
      if (row) void onChange([{ id, version: row.version, ...(after ? { after_id: target } : { before_id: target }) }]).catch(onError);
    });
  });
  const committedRows = useRef(new Map<string, Row>());
  const cellDraftKey = `${draftKey}:cell`;
  const restored = useRef(false);
  const [orphanDraft, setOrphanDraft] = useState<CellDraft | null>(null);
  const queuedCommit = useRef<{
    value?: Value;
    navigation?: CellNavigation;
  } | null>(null);
  function persist(row: Row, fieldId: string, value: Value) {
    try {
      storeCellDraft(cellDraftKey, row, fieldId, value);
    } catch {
      onError("浏览器无法保留单元格草稿，请保持此页面打开并重试保存。");
    }
  }
  useEffect(() => {
    onDraftChange(
      Boolean(
        editing &&
          JSON.stringify(editing.value) !==
            JSON.stringify(editing.row.values[editing.field.id] ?? null),
      ),
    );
  }, [editing, onDraftChange]);
  useEffect(() => () => onDraftChange(false), [onDraftChange]);
  useEffect(() => {
    // A confirmed retry may finish while the user continues typing in the cell.
    // Advance only the acknowledged base version and preserve the newer draft.
    setEditing((current) => {
      if (!current) return current;
      const acknowledged = confirmedRows.find(
        (row) => row.id === current.row.id,
      );
      return acknowledged && acknowledged.version > current.row.version
        ? { ...current, row: acknowledged }
        : current;
    });
  }, [confirmedRows]);
  const [widths, setWidths] = useState(view.widths);
  useEffect(() => setWidths(view.widths), [view.widths]);
  useEffect(() => {
    const up = () => {
      dragging.current = false;
    };
    window.addEventListener("pointerup", up);
    return () => window.removeEventListener("pointerup", up);
  }, []);
  useEffect(() => {
    setStart(null);
    setEnd(null);
    setEditing(null);
    setSelected(new Set());
  }, [view.id]);
  useEffect(() => {
    if (restored.current || readOnly || !fields.length) return;
    const saved = readCellDraft(cellDraftKey);
    if (!saved) {
      restored.current = true;
      return;
    }
    const index = rows.findIndex((row) => row.id === saved.row.id);
    const col = fields.findIndex((field) => field.id === saved.fieldId);
    if (index < 0 || col < 0) {
      setOrphanDraft((current) =>
        current?.row.id === saved.row.id &&
        current.fieldId === saved.fieldId &&
        JSON.stringify(current.value) === JSON.stringify(saved.value)
          ? current
          : saved,
      );
      return;
    }
    restored.current = true;
    setOrphanDraft(null);
    if (
      JSON.stringify(rows[index].values[saved.fieldId] ?? null) ===
      JSON.stringify(saved.value)
    ) {
      clearCellDraft(cellDraftKey, saved.row.id, saved.fieldId, saved.value);
      return;
    }
    setEditing({ row: saved.row, field: fields[col], value: saved.value });
    setStart({ row: index, col });
    setEnd({ row: index, col });
  }, [rows, fields, readOnly, cellDraftKey]);
  const previousOrder = useRef({
    rows: rows.map((r) => r.id),
    fields: fields.map((f) => f.id),
  });
  useLayoutEffect(() => {
    const previous = previousOrder.current;
    // Coordinate selections must never silently point at a different record or field.
    if (
      previous.rows.some((id, i) => rows[i]?.id !== id) ||
      previous.fields.some((id, i) => fields[i]?.id !== id)
    ) {
      setStart(null);
      setEnd(null);
      setSelected(new Set());
      dragging.current = false;
    }
    previousOrder.current = {
      rows: rows.map((r) => r.id),
      fields: fields.map((f) => f.id),
    };
  }, [rows, fields]);
  const groupField = allFields.find((f) => f.id === view.group_field_id);
  const groupStart = (index: number) =>
    Boolean(
      groupField &&
        (index === 0 ||
          rows[index].values[groupField.id] !==
            rows[index - 1].values[groupField.id]),
    );
  const virtualRows = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scroller.current,
    estimateSize: (index) => view.row_height + (groupStart(index) ? 28 : 0),
    getItemKey: (i) => rows[i].id,
    overscan: 8,
  });
  const columns = useVirtualizer({
    horizontal: true,
    count: fields.length,
    getScrollElement: () => scroller.current,
    estimateSize: (i) => widths[fields[i].id] ?? 180,
    paddingStart: rowHeaderWidth,
    overscan: 2,
  });
  useEffect(() => {
    columns.measure();
  }, [widths, rowHeaderWidth]);
  useEffect(() => {
    virtualRows.measure();
  }, [view.row_height, view.group_field_id, rows]);
  const width =
    rowHeaderWidth +
    fields.reduce((s, f) => s + (widths[f.id] ?? 180), 0) +
    44;
  const pagingAnchor = useRef<{
    id: string;
    offset: number;
    first: string;
    last: string;
    count: number;
  } | null>(null);
  async function more() {
    const top = scroller.current?.scrollTop ?? 0;
    const first = virtualRows.getVirtualItems().find((item) => item.end > top);
    if (first && rows[first.index])
      pagingAnchor.current = {
        id: rows[first.index].id,
        offset: top - first.start,
        first: rows[0].id,
        last: rows.at(-1)!.id,
        count: rows.length,
      };
    try {
      await onMore();
    } catch (e) {
      onError(e);
    }
  }
  useLayoutEffect(() => {
    const anchor = pagingAnchor.current;
    if (
      !anchor ||
      !rows.length ||
      (rows.length === anchor.count &&
        rows[0].id === anchor.first &&
        rows.at(-1)!.id === anchor.last)
    )
      return;
    const index = rows.findIndex((row) => row.id === anchor.id);
    if (index >= 0) {
      let top = 0;
      for (let i = 0; i < index; i++)
        top += view.row_height + (groupStart(i) ? 28 : 0);
      virtualRows.scrollToOffset(Math.max(0, top + anchor.offset));
    }
    pagingAnchor.current = null;
  }, [rows, view.row_height]);
  const bounds =
    start && end
      ? {
          top: Math.min(start.row, end.row),
          bottom: Math.max(start.row, end.row),
          left: Math.min(start.col, end.col),
          right: Math.max(start.col, end.col),
        }
      : null;
  function select(p: Point, shift: boolean) {
    setSelected(new Set());
    if (!shift || !start) setStart(p);
    setEnd(p);
    scroller.current?.focus({ preventScroll: true });
  }
  function edit(p: Point, initial?: string) {
    if (orphanDraft) {
      onError("请先保存、导出或放弃上次的单元格草稿。");
      return;
    }
    const source = rows[p.row],
      field = fields[p.col];
    const local = source && committedRows.current.get(source.id);
    const row = local && local.version > source.version ? local : source;
    if (!row || !field || readOnly || busy || KINDS[field.kind].system) return;
    const existing = readCellDraft(cellDraftKey);
    if (
      existing &&
      (existing.row.id !== row.id || existing.fieldId !== field.id)
    ) {
      setOrphanDraft(existing);
      return;
    }
    const value = existing
      ? existing.value
      : initial === undefined ||
          ["select", "multi_select", "person", "datetime"].includes(field.kind)
        ? (row.values[field.id] ?? null)
        : initial;
    const base = existing?.row ?? row;
    if (JSON.stringify(value) !== JSON.stringify(base.values[field.id] ?? null))
      persist(base, field.id, value);
    setEditing({ row: base, field, value, initial });
  }
  const latest = useRef({ rows, fields, onChange, editing, confirmedRows });
  latest.current = { rows, fields, onChange, editing, confirmedRows };
  useEffect(() => {
    if (!discardVersion) return;
    latest.current.editing = null;
    queuedCommit.current = null;
    setEditing(null);
    setOrphanDraft(null);
  }, [discardVersion]);
  const saving = useRef<Promise<boolean> | null>(null);
  function leaveGrid(backward: boolean) {
    const grid = scroller.current;
    if (!grid) return;
    const items = Array.from(
      document.querySelectorAll<HTMLElement>(
        "a[href],button,input,select,textarea,[tabindex]",
      ),
    ).filter(
      (el) =>
        el.tabIndex >= 0 &&
        !el.matches(":disabled") &&
        !el.closest("[inert]") &&
        el.getClientRects().length > 0 &&
        !grid.contains(el),
    );
    const direction = backward
      ? Node.DOCUMENT_POSITION_PRECEDING
      : Node.DOCUMENT_POSITION_FOLLOWING;
    const target = (backward ? items.reverse() : items).find((el) =>
      Boolean(grid.compareDocumentPosition(el) & direction),
    );
    target?.focus();
  }
  function commit(
    value?: Value,
    navigation?: CellNavigation,
  ): Promise<boolean> {
    if (saving.current) return saving.current;
    const draft = latest.current.editing;
    if (!draft) return Promise.resolve(!hasPending);
    if (hasPending || busy) {
      if (navigation) queuedCommit.current = { value, navigation };
      return Promise.resolve(false);
    }
    const acknowledged = latest.current.confirmedRows.find(
      (row) => row.id === draft.row.id && row.version > draft.row.version,
    );
    const active = acknowledged ? { ...draft, row: acknowledged } : draft;
    const task = Promise.resolve().then(async () => {
      try {
        let nextValue = value === undefined ? active.value : value;
        if (typeof nextValue === "string" && KINDS[active.field.kind].numeric)
          nextValue = parseCell(active.field, nextValue);
        let saved: Row | undefined;
        if (
          JSON.stringify(nextValue) !==
          JSON.stringify(active.row.values[active.field.id] ?? null)
        ) {
          const result = (await latest.current.onChange([
            {
              id: active.row.id,
              version: active.row.version,
              values: { [active.field.id]: nextValue },
            },
          ])) as { records: Row[] } | undefined;
          saved = result?.records.find((r) => r.id === active.row.id);
          if (saved) {
            committedRows.current.set(saved.id, saved);
            if (committedRows.current.size > 200)
              committedRows.current.delete(
                committedRows.current.keys().next().value!,
              );
          }
        }
        const newerDraft = latest.current.editing;
        if (
          newerDraft?.row.id === active.row.id &&
          newerDraft.field.id === active.field.id &&
          JSON.stringify(newerDraft.value) !== JSON.stringify(active.value)
        ) {
          setEditing({ ...newerDraft, row: saved ?? newerDraft.row });
          return false;
        }
        latest.current.editing = null;
        clearCellDraft(
          cellDraftKey,
          active.row.id,
          active.field.id,
          active.value,
        );
        setEditing(null);
        if (navigation || value !== undefined)
          scroller.current?.focus({ preventScroll: true });
        if (navigation) {
          const row = latest.current.rows.findIndex(
              (r) => r.id === active.row.id,
            ),
            col = latest.current.fields.findIndex(
              (f) => f.id === active.field.id,
            );
          if (row >= 0 && col >= 0) {
            const next = moveGridSelection(
              { row, col },
              navigation === "next" || navigation === "previous"
                ? "Tab"
                : "Enter",
              navigation === "previous" || navigation === "up",
              latest.current.rows.length,
              latest.current.fields.length,
            );
            if (!next && (navigation === "next" || navigation === "previous"))
              leaveGrid(navigation === "previous");
            if (next && (next.row !== row || next.col !== col)) {
              select(next, false);
              virtualRows.scrollToIndex(next.row, { align: "auto" });
              columns.scrollToIndex(next.col, { align: "auto" });
              const target = latest.current.rows[next.row],
                field = latest.current.fields[next.col];
              const record = saved?.id === target.id ? saved : target;
              if (!KINDS[field.kind].system && field.kind !== "checkbox")
                setEditing({
                  row: record,
                  field,
                  value: record.values[field.id] ?? null,
                });
            }
          }
        }
        return true;
      } catch (e) {
        onError(e);
        return false;
      } finally {
        saving.current = null;
      }
    });
    saving.current = task;
    return task;
  }
  const flush = useRef(commit);
  flush.current = commit;
  useEffect(() => {
    if (hasPending || busy || !queuedCommit.current) return;
    const queued = queuedCommit.current;
    queuedCommit.current = null;
    void flush.current(queued.value, queued.navigation);
  }, [hasPending, busy, confirmedRows]);
  useEffect(
    () =>
      registerPendingNavigation(async () => {
        if (!(await flush.current()))
          throw new Error("数据表修改尚未保存，请重试后再离开");
      }),
    [],
  );
  function currentRow(id: string) {
    const row = latest.current.rows.find(value => value.id === id);
    const confirmed = latest.current.confirmedRows.find(value => value.id === id);
    return confirmed && row && confirmed.version > row.version ? confirmed : row;
  }
  async function openRecordMenu(rowID: string, anchor: Anchor, col?: number) {
    if (editing && !(await commit())) return;
    const index = latest.current.rows.findIndex(row => row.id === rowID);
    if (index < 0) return;
    if (!selected.has(rowID)) {
      setSelected(new Set());
      const inRange = col !== undefined && bounds && index >= bounds.top && index <= bounds.bottom && col >= bounds.left && col <= bounds.right;
      if (!inRange) select({ row: index, col: col ?? 0 }, false);
    }
    setContextMenu({ anchor, rowID, col });
  }
  function copyText() {
    if (selected.size) return copyRecordCells(rows.filter(row => selected.has(row.id)), fields);
    if (contextMenu?.col === undefined && contextMenu) {
      const row = currentRow(contextMenu.rowID); return row ? copyRecordCells([row], fields) : "";
    }
    return bounds ? copyRecordCells(rows.slice(bounds.top, bounds.bottom + 1), fields.slice(bounds.left, bounds.right + 1)) : "";
  }
  function pasteText(text: string) {
    if (readOnly || busy || hasPending) return;
    const point = end ?? { row: 0, col: 0 };
    try {
      const targets = selected.size ? rows.filter(row => selected.has(row.id)) : rows.slice(point.row);
      const patches = pasteRecordCells(text, targets, fields.slice(selected.size ? 0 : point.col));
      if (selected.size && patches.length > selected.size) throw new Error("粘贴行数超出已勾选的记录范围");
      if (editing) {
        clearCellDraft(cellDraftKey, editing.row.id, editing.field.id, editing.value);
        queuedCommit.current = null; latest.current.editing = null; setEditing(null);
      }
      void onChange(patches).catch(onError);
    } catch (error) { onError(error); }
  }
  function menuDelete() {
    if (!contextMenu) return;
    const targets = selected.has(contextMenu.rowID) ? rows.filter(row => selected.has(row.id)) : [currentRow(contextMenu.rowID)].filter((row): row is Row => Boolean(row));
    if (targets.length > MAX_BATCH) { onError(`每次最多删除 ${MAX_BATCH} 条记录`); return; }
    void onChange(targets.map(row => ({ id: row.id, version: row.version, delete: true }))).then(() => setSelected(new Set())).catch(onError);
  }
  function keyboard(e: KeyboardEvent) {
    if (
      editing ||
      e.nativeEvent.isComposing ||
      (e.target as HTMLElement).closest("button,input,select,a")
    )
      return;
    if ((e.ctrlKey || e.metaKey) && e.key === "a") {
      e.preventDefault();
      setSelected(new Set());
      if (rows.length && fields.length) {
        setStart({ row: 0, col: 0 });
        setEnd({ row: rows.length - 1, col: fields.length - 1 });
      }
      return;
    }
    const p = end ?? { row: 0, col: 0 };
    if (
      [
        "ArrowUp",
        "ArrowDown",
        "ArrowLeft",
        "ArrowRight",
        "Tab",
        "Enter",
      ].includes(e.key)
    ) {
      const next = moveGridSelection(
        p,
        e.key,
        e.shiftKey,
        rows.length,
        fields.length,
      );
      if (!next) {
        if (e.key === "Tab") {
          e.preventDefault();
          leaveGrid(e.shiftKey);
        }
        return;
      }
      e.preventDefault();
      select(next, e.shiftKey && e.key !== "Tab");
      virtualRows.scrollToIndex(next.row, { align: "auto" });
      columns.scrollToIndex(next.col, { align: "auto" });
    } else if (e.key === "ContextMenu" || (e.shiftKey && e.key === "F10")) {
      e.preventDefault(); const row = rows[p.row]; if (row) void openRecordMenu(row.id, anchorAt(scroller.current?.querySelector(".sheet-cell.active") ?? scroller.current!), p.col);
    } else if (e.key === " ") {
      e.preventDefault(); if (rows[p.row]) onInspect(rows[p.row]);
    } else if (e.key === "F2") {
      e.preventDefault(); edit(p);
    } else if (
      (e.key === "Delete" || e.key === "Backspace") &&
      bounds &&
      !readOnly
    ) {
      e.preventDefault();
      const patches: Patch[] = [];
      for (let i = bounds.top; i <= bounds.bottom; i++) {
        const values: Record<string, Value> = {};
        for (let j = bounds.left; j <= bounds.right; j++)
          if (!KINDS[fields[j].kind].system) values[fields[j].id] = null;
        patches.push({ id: rows[i].id, version: rows[i].version, values });
      }
      if (patches.length > MAX_BATCH)
        onError("每次最多修改 200 条记录，请缩小选区");
      else void onChange(patches).catch((e) => onError(e));
    } else if (e.key.length === 1 && !e.metaKey && !e.ctrlKey && !e.altKey) {
      e.preventDefault();
      edit(p, e.key);
    }
  }
  return (
    <div
      className="sheet-grid-area"
      style={
        { "--sheet-row-header-width": `${rowHeaderWidth}px` } as CSSProperties
      }
    >
      {orphanDraft && (
        <DraftActions label="单元格草稿"><Button
            size="sm"
            onClick={() => {
              const url = URL.createObjectURL(
                new Blob([JSON.stringify(orphanDraft, null, 2)], {
                  type: "application/json",
                }),
              );
              const link = document.createElement("a");
              link.href = url;
              link.download = "data-table-cell-draft.json";
              link.click();
              setTimeout(() => URL.revokeObjectURL(url), 0);
            }}
          >
            导出草稿
          </Button>
<ConfirmAction title="放弃单元格草稿" description="这份尚未保存的单元格内容将被清除。需要保留时，请先导出草稿。" confirmLabel="确认放弃" onConfirm={() => {
              clearCellDraft(
                cellDraftKey,
                orphanDraft.row.id,
                orphanDraft.fieldId,
                orphanDraft.value,
              );
              setOrphanDraft(null);
              restored.current = true;
            }}>
            <Button size="sm">放弃草稿</Button>
          </ConfirmAction></DraftActions>
      )}
      {selected.size > 0 && (
        <div className="sheet-selection-bar">
          已选择 {selected.size} 条记录
          <ActionButton
            size="sm"
            disabled={readOnly || busy}
            onClick={() => {
              if (selected.size > MAX_BATCH) {
                onError("每次最多删除 200 条记录");
                return;
              }
              void onChange(
                rows
                  .filter((r) => selected.has(r.id))
                  .map((r) => ({ id: r.id, version: r.version, delete: true })),
              )
                .then(() => setSelected(new Set()))
                .catch((e) => onError(e));
            }}
          >
            删除记录
          </ActionButton>
          <ActionButton size="sm" onClick={() => setSelected(new Set())}>
            取消选择
          </ActionButton>
        </div>
      )}
      <div
        className="sheet-grid-scroll"
        ref={scroller}
        role="grid"
        aria-label="数据表"
        aria-rowcount={(total ?? rowOffset + rows.length) + 1}
        aria-colcount={fields.length}
        tabIndex={0}
        onKeyDown={keyboard}
        onCopy={(event) => {
          if (editing) return;
          if (!bounds && !selected.size) return;
          const text = copyText();
          event.preventDefault(); event.clipboardData.setData("text/plain", text);
        }}
        onPaste={(event) => {
          const text = event.clipboardData.getData("text/plain");
          if ((editing && !/[\t\r\n]/.test(text)) || readOnly || busy || hasPending) return;
          event.preventDefault(); pasteText(text);
        }}
      >
        <div className="sheet-grid-header" role="row" style={{ width }}>
          <div className="sheet-row-label">
            <label className="sheet-row-select">
              <input
                type="checkbox"
                aria-label="选择当前已加载记录"
                checked={rows.length > 0 && selected.size === rows.length}
                onChange={(e) =>
                  setSelected(
                    e.target.checked ? new Set(rows.map((r) => r.id)) : new Set(),
                  )
                }
              />
            </label>
          </div>
          {columns.getVirtualItems().map((col) => {
            const field = fields[col.index];
            return (
              <div
                key={field.id}
                role="columnheader"
                className="sheet-grid-heading"
                onContextMenu={event => { if (readOnly) return; event.preventDefault(); onFieldMenu(field, { left: event.clientX, top: event.clientY }); }}
                style={{ left: col.start, width: col.size }}
              >
                <ActionButton
                  size="sm"
                  disabled={readOnly}
                  aria-label={`${field.name}列菜单`}
                  onClick={(e) => onFieldMenu(field, anchorAt(e.currentTarget))}
                >
                  <FieldIcon kind={field.kind} />
                  <span>{field.name}</span>
                  <ChevronDown size={12} />
                </ActionButton>
                <div
                  role="separator"
                  aria-label={`调整${field.name}列宽`}
                  aria-orientation="vertical"
                  tabIndex={readOnly ? -1 : 0}
                  aria-disabled={readOnly || undefined}
                  className="sheet-resize"
                  onKeyDown={(e) => {
                    if (readOnly) return;
                    if (["ArrowLeft", "ArrowRight"].includes(e.key)) {
                      e.preventDefault();
                      onWidth(
                        field.id,
                        Math.max(
                          100,
                          Math.min(
                            600,
                            col.size + (e.key === "ArrowLeft" ? -10 : 10),
                          ),
                        ),
                      );
                    }
                  }}
                  onPointerDown={(e) => {
                    if (readOnly) return;
                    e.preventDefault();
                    const x = e.clientX,
                      initial = col.size;
                    e.currentTarget.setPointerCapture(e.pointerId);
                    const target = e.currentTarget;
                    const move = (event: PointerEvent) =>
                      setWidths((old) => ({
                        ...old,
                        [field.id]: Math.max(
                          100,
                          Math.min(600, initial + event.clientX - x),
                        ),
                      }));
                    const up = (event: PointerEvent) => {
                      target.removeEventListener("pointermove", move);
                      target.removeEventListener("pointerup", up);
                      onWidth(
                        field.id,
                        Math.max(
                          100,
                          Math.min(600, initial + event.clientX - x),
                        ),
                      );
                    };
                    target.addEventListener("pointermove", move);
                    target.addEventListener("pointerup", up);
                  }}
                />
              </div>
            );
          })}
          {!readOnly && (
            <ActionButton
              size="sm"
              className="sheet-add-column"
              style={{ left: width - 44 }}
              aria-label="添加字段"
              onClick={(event) => onNewField(anchorAt(event.currentTarget))}
            >
              <Plus size={15} />
            </ActionButton>
          )}
        </div>
        <div
          className="sheet-grid-body"
          data-reorder-scope="records"
          style={{ height: virtualRows.getTotalSize(), width }}
        >
          {virtualRows.getVirtualItems().map((virtual) => {
            const row = rows[virtual.index],
              groupTop = groupStart(virtual.index) ? 28 : 0;
            const groupOption =
              groupTop > 0 && groupField
                ? groupField.options.find(
                    (option) => option.id === row.values[groupField.id],
                  )
                : undefined;
            return (
              <div
                role="row"
                aria-rowindex={rowOffset + virtual.index + 2}
                className={`sheet-grid-row${selected.has(row.id) ? " row-selected" : ""}`}
                aria-selected={selected.has(row.id)}
                data-reorder-id={row.id}
                data-drop={rowReorder.target?.id === row.id ? (rowReorder.target.after ? "after" : "before") : undefined}
                onContextMenu={event => { event.preventDefault(); void openRecordMenu(row.id, { left: event.clientX, top: event.clientY }); }}
                key={row.id}
                style={{ top: virtual.start, height: virtual.size, width }}
              >
                {groupTop > 0 && (
                  <div className="sheet-group-heading">
                    <span
                      className="sheet-group-dot"
                      aria-hidden
                      style={
                        groupOption
                          ? {
                              background: `var(--sheet-ink-${groupOption.color}, var(--text-tertiary))`,
                            }
                          : undefined
                      }
                    />
                    {groupOption?.label ?? "未分组"}
                  </div>
                )}
                <div
                  className="sheet-row-label"
                  style={{ top: groupTop, height: view.row_height }}
                >
                  <button type="button" className="sheet-row-drag sheet-drag-handle" aria-label={`拖拽记录 ${rowOffset + virtual.index + 1}`} title={manualOrder ? "拖拽调整记录顺序；上下键可移动" : "请先关闭排序、筛选和分组"} disabled={readOnly || busy || hasPending || !manualOrder || selected.size > 1}
                    onPointerDown={event => rowReorder.start(event, row.id)} onKeyDown={event => {
                      if (!["ArrowUp", "ArrowDown"].includes(event.key)) return;
                      event.preventDefault(); const target = rows[virtual.index + (event.key === "ArrowUp" ? -1 : 1)];
                      if (target) void onChange([{ id: row.id, version: row.version, ...(event.key === "ArrowUp" ? { before_id: target.id } : { after_id: target.id }) }]).catch(onError);
                    }}><GripVertical size={16} /></button>
                  <label className="sheet-row-select">
                    <input
                      type="checkbox"
                      aria-label={`选择记录 ${rowOffset + virtual.index + 1}`}
                      checked={selected.has(row.id)}
                      onChange={(e) =>
                        setSelected((old) => {
                          const next = new Set(old);
                          if (e.target.checked) next.add(row.id);
                          else next.delete(row.id);
                          return next;
                        })
                      }
                    />
                    <span>{rowOffset + virtual.index + 1}</span>
                  </label>
                  <ActionButton size="sm" className="sheet-row-inspect" aria-label={`查看记录 ${rowOffset + virtual.index + 1}`} onClick={() => onInspect(row)}><Expand size={15} /></ActionButton>
                </div>
                {columns.getVirtualItems().map((col) => {
                  const field = fields[col.index],
                    isEditing =
                      editing?.row.id === row.id &&
                      editing.field.id === field.id;
                  const inRange = Boolean(
                      bounds &&
                        virtual.index >= bounds.top &&
                        virtual.index <= bounds.bottom &&
                        col.index >= bounds.left &&
                        col.index <= bounds.right,
                    ),
                    // The active cell keeps its content readable; only the
                    // surrounding range carries the selection tint.
                    isActive =
                      end?.row === virtual.index && end.col === col.index;
                  return (
                    <div
                      role="gridcell"
                      data-first-column={col.index === 0 || undefined}
                      aria-selected={inRange || selected.has(row.id)}
                      key={field.id}
                      className={`sheet-cell${duplicates[field.id]?.includes(row.id) ? " duplicate" : ""}${inRange && !isActive ? " selected" : ""}${isActive ? " active" : ""}${isEditing ? " editing" : ""}`}
                      style={{
                        left: col.start,
                        width: col.size,
                        top: groupTop,
                        color: view.text_colors[field.id]
                          ? `var(--sheet-ink-${view.text_colors[field.id]})`
                          : undefined,
                      }}
                      onContextMenu={event => { event.preventDefault(); event.stopPropagation(); void openRecordMenu(row.id, { left: event.clientX, top: event.clientY }, col.index); }}
                      onPointerDown={(e) => {
                        if (e.button !== 0) return;
                        if (
                          isEditing ||
                          (e.target as HTMLElement).closest("a,button")
                        )
                          return;
                        if (
                          editing &&
                          (editing.row.id !== row.id ||
                            editing.field.id !== field.id)
                        ) {
                          e.preventDefault();
                          void commit().then((ok) => {
                            if (ok) {
                              select(
                                { row: virtual.index, col: col.index },
                                false,
                              );
                              edit({ row: virtual.index, col: col.index });
                            }
                          });
                          return;
                        }
                        select(
                          { row: virtual.index, col: col.index },
                          e.shiftKey,
                        );
                        dragging.current = true;
                      }}
                      onPointerEnter={() => {
                        if (dragging.current)
                          setEnd({ row: virtual.index, col: col.index });
                      }}
                      onClick={(event) => {
                        if (
                          isEditing ||
                          event.shiftKey ||
                          readOnly ||
                          busy ||
                          (event.target as HTMLElement).closest("a")
                        )
                          return;
                        if (editing) return;
                        if (field.kind === "checkbox") {
                          void onChange([
                            {
                              id: row.id,
                              version: row.version,
                              values: { [field.id]: !row.values[field.id] },
                            },
                          ]).catch((e) => onError(e));
                        } else {
                          select({ row: virtual.index, col: col.index }, false);
                          edit({ row: virtual.index, col: col.index });
                        }
                      }}
                    >
                      {isEditing ? (
                        <CellEditor
                          key={`${row.id}:${field.id}`}
                          field={field}
                          value={editing.value}
                          initial={editing.initial}
                          auth={auth}
                          onChange={(value) => {
                            const current = latest.current.editing;
                            if (current)
                              persist(current.row, current.field.id, value);
                            setEditing((old) =>
                              old ? { ...old, value } : null,
                            );
                          }}
                          onCommit={commit}
                          onCancel={() => {
                            queuedCommit.current = null;
                            const current = latest.current.editing;
                            if (current)
                              clearCellDraft(
                                cellDraftKey,
                                current.row.id,
                                current.field.id,
                                current.value,
                              );
                            latest.current.editing = null;
                            setEditing(null);
                            scroller.current?.focus();
                          }}
                          onCreateOption={
                            ["select", "multi_select"].includes(field.kind)
                              ? (label) => onCreateOption(field, label)
                              : undefined
                          }
                        />
                      ) : (
                        <>
                          <CellValue
                            field={field}
                            value={row.values[field.id]}
                            interactive={!readOnly && !busy}
                          />
                          {!readOnly &&
                            [
                              "select",
                              "multi_select",
                              "datetime",
                              "person",
                            ].includes(field.kind) && (
                              <button
                                className="sheet-cell-picker"
                                aria-label={`编辑${field.name}`}
                              >
                                <ChevronDown size={14} />
                              </button>
                            )}
                        </>
                      )}
                    </div>
                  );
                })}
              </div>
            );
          })}
        </div>
        <div className="sheet-grid-tail" style={{ width }}>
          {hasMore ? (
            <ActionButton
              size="sm"
              disabled={loading}
              onClick={() => void more()}
            >
              {loading ? "正在加载…" : "加载更多记录"}
            </ActionButton>
          ) : !readOnly ? (
            <ActionButton
              size="sm"
              aria-label="添加记录"
              className="sheet-add-row"
              disabled={busy}
              onClick={onAdd}
            >
              <Plus size={15} />
            </ActionButton>
          ) : null}
        </div>
      </div>
      {contextMenu && <SheetRecordMenu anchor={contextMenu.anchor} multiple={selected.has(contextMenu.rowID) && selected.size > 1} readOnly={readOnly} busy={busy || hasPending} manualOrder={manualOrder}
        onClose={() => setContextMenu(null)}
        onCopy={() => { void navigator.clipboard.writeText(copyText()).catch(onError); }}
        onPaste={() => { void navigator.clipboard.readText().then(pasteText).catch(() => onError("浏览器无法读取剪贴板，请使用 Ctrl+V 或 Command+V 粘贴")); }}
        onInsert={(before, count) => { void onChange(Array.from({ length: count }, () => ({ id: newUUID(), version: 0, values: {}, ...(before ? { before_id: contextMenu.rowID } : { after_id: contextMenu.rowID }) }))).catch(onError); }}
        onDuplicate={() => { const row = currentRow(contextMenu.rowID); if (row) void onChange([duplicateRecord(row, allFields, manualOrder)]).catch(onError); }}
        onInspect={() => { const row = currentRow(contextMenu.rowID); if (row) onInspect(row); }} onDelete={menuDelete} />}
      <div className="sheet-statusbar">
        <span>
          {total != null ? `${total} 条记录` : "正在读取记录数…"}
        </span>
        <span className="sheet-muted">
          {bounds
            ? `已选择 ${(bounds.bottom - bounds.top + 1) * (bounds.right - bounds.left + 1)} 个单元格`
            : "双击单元格编辑 · 拖动选择 · 支持复制粘贴"}
        </span>
        <ActionButton size="sm" onClick={() => void onRefresh()}>
          刷新
        </ActionButton>
      </div>
    </div>
  );
}

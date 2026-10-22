import { useVirtualizer } from "@tanstack/react-virtual";
import { ChevronDown, Expand, Plus } from "lucide-react";
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
import { decodeCells, encodeCells } from "./clipboard";
import { FieldIcon } from "./FieldIcon";
import { moveGridSelection, type GridPoint as Point } from "./grid-navigation";
import {
  KINDS,
  MAX_BATCH,
  cellText,
  parseCell,
  type Field,
  type Patch,
  type Row,
  type Value,
  type View,
} from "./model";
import { anchorAt, type Anchor } from "./Popover";

const ROW_HEADER_WIDTH = 44;

export function SheetGrid({
  rows,
  confirmedRows,
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
  onError,
}: {
  rows: Row[];
  confirmedRows: Row[];
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
  onError: (message: string) => void;
}) {
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
  const committedRows = useRef(new Map<string, Row>());
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
    paddingStart: ROW_HEADER_WIDTH,
    overscan: 2,
  });
  useEffect(() => {
    columns.measure();
  }, [widths]);
  useEffect(() => {
    virtualRows.measure();
  }, [view.row_height, view.group_field_id, rows]);
  const width =
    ROW_HEADER_WIDTH +
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
      onError((e as Error).message);
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
    if (!shift || !start) setStart(p);
    setEnd(p);
    scroller.current?.focus({ preventScroll: true });
  }
  function edit(p: Point, initial?: string) {
    const source = rows[p.row],
      field = fields[p.col];
    const local = source && committedRows.current.get(source.id);
    const row = local && local.version > source.version ? local : source;
    if (!row || !field || readOnly || busy || KINDS[field.kind].system) return;
    setEditing({
      row,
      field,
      value:
        initial === undefined
          ? (row.values[field.id] ?? null)
          : ["select", "multi_select", "person", "datetime"].includes(
                field.kind,
              )
            ? (row.values[field.id] ?? null)
            : initial,
      initial,
    });
  }
  const latest = useRef({ rows, fields, onChange, editing });
  latest.current = { rows, fields, onChange, editing };
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
    if (hasPending) return Promise.resolve(false);
    const active = latest.current.editing;
    if (!active) return Promise.resolve(true);
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
        onError((e as Error).message);
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
  useEffect(
    () =>
      registerPendingNavigation(async () => {
        if (!(await flush.current()))
          throw new Error("数据表修改尚未保存，请重试后再离开");
      }),
    [],
  );
  function keyboard(e: KeyboardEvent) {
    if (
      editing ||
      e.nativeEvent.isComposing ||
      (e.target as HTMLElement).closest("button,input,select,a")
    )
      return;
    if ((e.ctrlKey || e.metaKey) && e.key === "a") {
      e.preventDefault();
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
    } else if (e.key === "F2" || e.key === " ") {
      e.preventDefault();
      edit(p);
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
      else void onChange(patches).catch((e) => onError(e.message));
    } else if (e.key.length === 1 && !e.metaKey && !e.ctrlKey && !e.altKey) {
      e.preventDefault();
      edit(p, e.key);
    }
  }
  return (
    <div
      className="sheet-grid-area"
      style={
        { "--sheet-row-header-width": `${ROW_HEADER_WIDTH}px` } as CSSProperties
      }
    >
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
                .catch((e) => onError(e.message));
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
        onCopy={(e) => {
          if (editing || !bounds) return;
          e.preventDefault();
          e.clipboardData.setData(
            "text/plain",
            encodeCells(
              rows
                .slice(bounds.top, bounds.bottom + 1)
                .map((r) =>
                  fields
                    .slice(bounds.left, bounds.right + 1)
                    .map((f) => cellText(f, r.values[f.id])),
                ),
            ),
          );
        }}
        onPaste={(e) => {
          const clipboard = e.clipboardData.getData("text/plain");
          if (
            (editing && !/[\t\r\n]/.test(clipboard)) ||
            !end ||
            readOnly ||
            busy
          )
            return;
          if (editing) {
            latest.current.editing = null;
            setEditing(null);
          }
          e.preventDefault();
          try {
            const data = decodeCells(clipboard);
            if (data.length > MAX_BATCH) throw new Error("每次最多粘贴 200 行");
            const patches = data.map((values, i) => {
              const row = rows[end.row + i];
              return {
                id: row?.id ?? newUUID(),
                version: row?.version ?? 0,
                values: Object.fromEntries(
                  values.map((value, j) => {
                    const field = fields[end.col + j];
                    if (!field) throw new Error("粘贴内容超出字段范围");
                    return [field.id, parseCell(field, value)];
                  }),
                ),
              };
            });
            void onChange(patches).catch((e) => onError(e.message));
          } catch (err) {
            onError((err as Error).message);
          }
        }}
      >
        <div className="sheet-grid-header" role="row" style={{ width }}>
          <div className="sheet-row-label">
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
          </div>
          {columns.getVirtualItems().map((col) => {
            const field = fields[col.index];
            return (
              <div
                key={field.id}
                role="columnheader"
                className="sheet-grid-heading"
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
                  tabIndex={0}
                  className="sheet-resize"
                  onKeyDown={(e) => {
                    if (["ArrowLeft", "ArrowRight"].includes(e.key))
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
          style={{ height: virtualRows.getTotalSize(), width }}
        >
          {virtualRows.getVirtualItems().map((virtual) => {
            const row = rows[virtual.index],
              groupTop = groupStart(virtual.index) ? 28 : 0;
            return (
              <div
                role="row"
                aria-rowindex={rowOffset + virtual.index + 2}
                className="sheet-grid-row"
                key={row.id}
                style={{ top: virtual.start, height: virtual.size, width }}
              >
                {groupTop > 0 && (
                  <div className="sheet-group-heading">
                    {groupField?.options.find(
                      (o) => o.id === row.values[groupField.id],
                    )?.label ?? "未分组"}
                  </div>
                )}
                <div
                  className="sheet-row-label"
                  style={{ top: groupTop, height: view.row_height }}
                >
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
                </div>
                {columns.getVirtualItems().map((col) => {
                  const field = fields[col.index],
                    isEditing =
                      editing?.row.id === row.id &&
                      editing.field.id === field.id;
                  const isSelected =
                    bounds &&
                    virtual.index >= bounds.top &&
                    virtual.index <= bounds.bottom &&
                    col.index >= bounds.left &&
                    col.index <= bounds.right;
                  return (
                    <div
                      role="gridcell"
                      data-first-column={col.index === 0 || undefined}
                      aria-selected={Boolean(isSelected)}
                      key={field.id}
                      className={`sheet-cell${duplicates[field.id]?.includes(row.id) ? " duplicate" : ""}${isSelected ? " selected" : ""}${isEditing ? " editing" : ""}`}
                      style={{
                        left: col.start,
                        width: col.size,
                        top: groupTop,
                        color: view.text_colors[field.id]
                          ? `var(--sheet-ink-${view.text_colors[field.id]})`
                          : undefined,
                      }}
                      onPointerDown={(e) => {
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
                          ]).catch((e) => onError(e.message));
                        } else {
                          select({ row: virtual.index, col: col.index }, false);
                          edit({ row: virtual.index, col: col.index });
                        }
                      }}
                      onDoubleClick={() =>
                        edit({ row: virtual.index, col: col.index })
                      }
                    >
                      {isEditing ? (
                        <CellEditor
                          key={`${row.id}:${field.id}`}
                          field={field}
                          value={editing.value}
                          initial={editing.initial}
                          auth={auth}
                          onChange={(value) =>
                            setEditing((old) =>
                              old ? { ...old, value } : null,
                            )
                          }
                          onCommit={commit}
                          onCancel={() => {
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
                          {col.index === 0 && (
                            <ActionButton
                              size="sm"
                              className="sheet-row-inspect"
                              aria-label={`查看记录 ${rowOffset + virtual.index + 1}`}
                              onClick={(event) => {
                                event.stopPropagation();
                                onInspect(row);
                              }}
                            >
                              <Expand size={12} />
                            </ActionButton>
                          )}
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
              disabled={busy}
              onClick={onAdd}
            >
              <Plus size={16} />
            </ActionButton>
          ) : null}
        </div>
      </div>
      <div className="sheet-grid-hint">
        {bounds
          ? `已选择 ${(bounds.bottom - bounds.top + 1) * (bounds.right - bounds.left + 1)} 个单元格`
          : "双击单元格编辑 · 拖动选择 · 支持复制粘贴"}
      </div>
    </div>
  );
}

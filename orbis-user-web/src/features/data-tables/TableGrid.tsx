import { useMemo, useRef, type KeyboardEvent } from "react";
import { tableFeatures, useTable } from "@tanstack/react-table";
import { useVirtualizer } from "@tanstack/react-virtual";
import { CellEditor } from "./CellEditor";
import {
  TABLE_COLUMN_WIDTH,
  TABLE_ROW_HEIGHT,
  type CellValue,
  type TableDefinition,
  type TableField,
  type TableRecord,
  type TableView,
} from "./model";

const features = tableFeatures({});
export function TableGrid({
  definition,
  view,
  records,
  readOnly,
  onCell,
  onCommit,
  onRecord,
  onField,
}: {
  definition: TableDefinition;
  view: TableView;
  records: TableRecord[];
  readOnly: boolean;
  onCell: (id: string, field: string, value: CellValue) => void;
  onCommit: () => void;
  onRecord: (record: TableRecord) => void;
  onField: (field: TableField) => void;
}) {
  const scroll = useRef<HTMLDivElement>(null);
  const fields = useMemo(
    () =>
      view.field_ids.length
        ? view.field_ids
            .map((id) => definition.fields.find((field) => field.id === id))
            .filter((field): field is TableField => Boolean(field))
        : definition.fields,
    [definition.fields, view.field_ids],
  );
  const columns = useMemo(
    () =>
      fields.map((field) => ({
        id: field.id,
        accessorFn: (row: TableRecord) => row.values[field.id],
        header: field.name,
      })),
    [fields],
  );
  const table = useTable({
    features,
    columns,
    data: records,
    getRowId: (row: TableRecord) => row.id,
  });
  const rows = table.getRowModel().rows;
  const groupField = definition.fields.find(
    (field) => field.id === view.group_field_id,
  );
  const groupStart = (index: number) =>
    Boolean(
      groupField &&
      (index === 0 ||
        records[index].values[groupField.id] !==
          records[index - 1].values[groupField.id]),
    );
  const groupLabel = (record: TableRecord) =>
    groupField?.options.find(
      (option) => option.id === record.values[groupField.id],
    )?.label ?? "未分组";
  const virtualRows = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scroll.current,
    estimateSize: (index) => TABLE_ROW_HEIGHT + (groupStart(index) ? 26 : 0),
    getItemKey: (index) => rows[index].id,
    overscan: 5,
  });
  const virtualColumns = useVirtualizer({
    horizontal: true,
    count: fields.length,
    getScrollElement: () => scroll.current,
    estimateSize: (index) =>
      view.widths[fields[index].id] ?? TABLE_COLUMN_WIDTH,
    overscan: 2,
    paddingStart: 44,
  });
  const width = fields.reduce(
    (sum, field) => sum + (view.widths[field.id] ?? TABLE_COLUMN_WIDTH),
    44,
  );
  const renderedColumns = virtualColumns.getVirtualItems();
  function navigate(event: KeyboardEvent<HTMLDivElement>) {
    if (
      readOnly ||
      event.nativeEvent.isComposing ||
      !["Tab", "Enter"].includes(event.key)
    )
      return;
    const cell = (event.target as HTMLElement).closest<HTMLElement>(
      "[data-row][data-column]",
    );
    if (!cell) return;
    let row = Number(cell.dataset.row),
      column = Number(cell.dataset.column);
    if (event.key === "Enter") row += event.shiftKey ? -1 : 1;
    else {
      column += event.shiftKey ? -1 : 1;
      if (column >= fields.length) {
        column = 0;
        row++;
      } else if (column < 0) {
        column = fields.length - 1;
        row--;
      }
    }
    if (row < 0 || row >= rows.length) return;
    event.preventDefault();
    onCommit();
    virtualRows.scrollToIndex(row, { align: "auto" });
    virtualColumns.scrollToIndex(column, { align: "auto" });
    requestAnimationFrame(() =>
      scroll.current
        ?.querySelector<HTMLElement>(
          `[data-row="${row}"][data-column="${column}"] :is(input,select,summary)`,
        )
        ?.focus(),
    );
  }
  return (
    <div
      ref={scroll}
      className="dt-grid-scroll"
      role="grid"
      aria-label={definition.title}
      aria-rowcount={records.length + 1}
      aria-colcount={fields.length + 1}
      onKeyDown={navigate}
    >
      <div className="dt-grid-head" role="row" style={{ width }}>
        <span className="dt-row-number" role="columnheader">
          #
        </span>
        {renderedColumns.map((column) => {
          const field = fields[column.index];
          return (
            <button
              type="button"
              role="columnheader"
              className="dt-header-cell"
              key={field.id}
              style={{ left: column.start, width: column.size }}
              disabled={readOnly}
              onClick={() => onField(field)}
            >
              {field.name}
              <span aria-hidden="true">⌄</span>
            </button>
          );
        })}
      </div>
      <div
        className="dt-grid-body"
        style={{ width, height: virtualRows.getTotalSize() }}
      >
        {virtualRows.getVirtualItems().map((row) => {
          const record = rows[row.index].original,
            top = groupStart(row.index) ? 26 : 0;
          return (
            <div
              className="dt-grid-row"
              role="row"
              aria-rowindex={row.index + 2}
              key={record.id}
              style={{
                transform: `translateY(${row.start}px)`,
                height: row.size,
                width,
              }}
            >
              {top ? (
                <div className="dt-group-label">{groupLabel(record)}</div>
              ) : null}
              <button
                type="button"
                className="dt-row-number"
                role="rowheader"
                style={{ top, height: TABLE_ROW_HEIGHT }}
                aria-label={`打开记录 ${row.index + 1}`}
                onClick={() => onRecord(record)}
              >
                {row.index + 1}
              </button>
              {renderedColumns.map((column) => {
                const field = fields[column.index];
                return (
                  <div
                    role="gridcell"
                    aria-colindex={column.index + 2}
                    data-row={row.index}
                    data-column={column.index}
                    className="dt-grid-cell"
                    key={field.id}
                    style={{
                      top,
                      height: TABLE_ROW_HEIGHT,
                      left: column.start,
                      width: column.size,
                    }}
                  >
                    <CellEditor
                      field={field}
                      value={record.values[field.id]}
                      readOnly={readOnly}
                      onChange={(value) => onCell(record.id, field.id, value)}
                      onCommit={onCommit}
                    />
                  </div>
                );
              })}
            </div>
          );
        })}
        {!rows.length ? (
          <div className="dt-empty">暂无记录，添加第一条记录开始整理。</div>
        ) : null}
      </div>
    </div>
  );
}

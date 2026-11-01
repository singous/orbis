import { tableEmptyClassName } from "./table-chrome";
import { reportError } from "../../shared/api/request-feedback";
import { useEffect, useRef, useState } from "react";
import { Button } from "../../shared/ui/Button";
import { readTable } from "./api";
import type { TableHost } from "./context";
import {
  cellText,
  TABLE_PAGE_SIZE,
  type TableDefinition,
  type TablePage,
  type TableRecord,
  type TableView,
} from "./model";

function BoardColumn({
  host,
  tableId,
  definition,
  view,
  group,
  revision,
  onMove,
  onRecord,
}: {
  host: TableHost;
  tableId: string;
  definition: TableDefinition;
  view: TableView;
  group: TablePage["groups"][number];
  revision: number;
  onMove: (record: string, value: string | null) => void;
  onRecord: (record: TableRecord) => void;
}) {
  const [page, setPage] = useState<TablePage | null>(null),
    [loading, setLoading] = useState(false);
  const [offset, setOffset] = useState(0);
  const element = useRef<HTMLElement>(null);
  const [visible, setVisible] = useState(
    typeof IntersectionObserver === "undefined",
  );
  useEffect(() => {
    if (!element.current || typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setVisible(true);
          observer.disconnect();
        }
      },
      { root: element.current.closest(".dt-board"), rootMargin: "0px 300px" },
    );
    observer.observe(element.current);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    if (!visible) return;
    const abort = new AbortController();
    setLoading(true);
    void readTable(host.noteId, tableId, host.auth, {
      viewId: view.id,
      group: group.id ?? "__empty__",
      revision,
      documentVersion:host.documentVersion?.(),
      offset,
      signal: abort.signal,
    })
      .then((value) => {
        if (abort.signal.aborted) return;
        setPage(value);

      })
      .catch((error) => {
        if (!abort.signal.aborted) reportError(error);
      })
      .finally(() => {
        if (!abort.signal.aborted) setLoading(false);
      });
    return () => abort.abort();
  }, [
    host.noteId,
    host.auth,
    tableId,
    view.id,
    revision,
    group.id,
    offset,
    visible,
  ]);
  const fields = view.field_ids.length
    ? view.field_ids.flatMap(id => definition.fields.find(field => field.id === id) ?? [])
    : definition.fields;
  return (
    <section
      ref={element}
      className="min-h-[260px] flex-[0_0_250px]"
      aria-label={group.name}
      onDragOver={(event) => {
        if (!host.readOnly) event.preventDefault();
      }}
      onDrop={(event) => {
        event.preventDefault();
        const recordId = event.dataTransfer.getData(
          "application/orbis-table-record",
        );
        if (!host.readOnly && /^[0-9a-f-]{36}$/.test(recordId))
          onMove(recordId, group.id);
      }}
    >
      <header className="flex items-center gap-2 px-0.5 pt-1 pb-3 text-[12px]">
        <span className="size-[7px] rounded-[50%] bg-ob-primary" />
        <strong>{group.name}</strong>
        <span className="ml-auto text-(--ob-page-muted-foreground) tabular-nums">{group.count}</span>
      </header>

      <div className="flex max-h-[390px] flex-col gap-[9px] overflow-auto" aria-busy={loading}>
        {page?.records.map((record) => (
          <button
            type="button"
            className="flex flex-col gap-[9px] rounded-[7px] border border-ob-border bg-ob-card p-3 text-left text-inherit [box-shadow:var(--ob-shadow-table-card)] focus-visible:outline-2 focus-visible:outline-ob-primary"
            draggable={!host.readOnly}
            onDragStart={(event) =>
              event.dataTransfer.setData(
                "application/orbis-table-record",
                record.id,
              )
            }
            onClick={() => onRecord(record)}
            key={record.id}
          >
            <strong>
              {fields[0]
                ? cellText(fields[0], record.values[fields[0].id]) ||
                  "未命名记录"
                : "记录"}
            </strong>
            {fields.slice(1, 4).map((field) => (
              <span className="flex justify-between gap-2.5 text-[11px] text-(--ob-page-muted-foreground)" key={field.id}>
                <span>{field.name}</span>
                {cellText(field, record.values[field.id]) || "—"}
              </span>
            ))}
          </button>
        ))}
      </div>
      {page && (offset > 0 || page.has_more) ? (
        <footer>
          <Button
            size="sm"
            disabled={offset === 0 || loading}
            onClick={() => setOffset(Math.max(0, offset - TABLE_PAGE_SIZE))}
          >
            上一页
          </Button>
          <Button
            size="sm"
            disabled={!page.has_more || loading}
            onClick={() => setOffset(page.next_offset)}
          >
            下一页
          </Button>
        </footer>
      ) : null}
      {!loading && !page?.records.length ? (
        <p className="px-[3px] py-[15px] text-xs text-(--ob-page-muted-foreground)">拖入记录或更改状态</p>
      ) : null}
    </section>
  );
}

export function TableBoard(props: {
  host: TableHost;
  page: TablePage;
  definition: TableDefinition;
  view: TableView;
  onMove: (record: string, value: string | null) => void;
  onRecord: (record: TableRecord) => void;
}) {
  if (!props.view.group_field_id)
    return (
      <div className={tableEmptyClassName}>
        在视图设置中选择一个单选字段，开始使用看板。
      </div>
    );
  return (
    <div className="dt-board flex max-h-[540px] gap-3.5 overflow-auto bg-ob-surface-secondary p-4 [.embed-content>.data-table_&]:min-h-0 [.embed-content>.data-table_&]:flex-1 [.embed-content>.data-table_&]:overflow-auto">
      {props.page.groups.map((group) => (
        <BoardColumn
          key={`${props.view.id}:${group.id ?? "empty"}`}
          host={props.host}
          tableId={props.page.table_id}
          definition={props.definition}
          view={props.view}
          group={group}
          revision={props.page.revision}
          onMove={props.onMove}
          onRecord={props.onRecord}
        />
      ))}
    </div>
  );
}

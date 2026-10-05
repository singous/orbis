import { useEffect, useRef, useState } from "react";
import { Button } from "../../shared/ui/Button";
import { readTable } from "./api";
import type { TableHost } from "./context";
import {
  cellText,
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
    [error, setError] = useState<string | null>(null),
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
      offset,
      signal: abort.signal,
    })
      .then((value) => {
        setPage(value);
        setError(null);
      })
      .catch((error) => {
        if (!abort.signal.aborted) setError(error.message);
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
  const fields = definition.fields.filter((field) =>
    view.field_ids.includes(field.id),
  );
  return (
    <section
      ref={element}
      className="dt-board-column"
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
      <header>
        <span className="dt-board-dot" />
        <strong>{group.name}</strong>
        <span>{group.count}</span>
      </header>
      {error ? <p role="alert">{error}</p> : null}
      <div className="dt-board-cards" aria-busy={loading}>
        {page?.records.map((record) => (
          <button
            type="button"
            className="dt-board-card"
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
              <span className="dt-card-field" key={field.id}>
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
            onClick={() => setOffset(Math.max(0, offset - 100))}
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
        <p className="dt-board-empty">拖入记录或更改状态</p>
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
      <div className="dt-empty">
        在视图设置中选择一个单选字段，开始使用看板。
      </div>
    );
  return (
    <div className="dt-board">
      {props.page.groups.map((group) => (
        <BoardColumn
          key={group.id ?? "empty"}
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

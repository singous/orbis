import { useQuery } from "@tanstack/react-query";
import { useVirtualizer } from "@tanstack/react-virtual";
import { useEffect, useRef, useState } from "react";
import { newUUID } from "../../shared/ids";
import { ActionButton } from "../../shared/ui/ActionButton";
import { Plus } from "../../shared/ui/icons";
import { CellValue } from "./Cell";
import type { Field, Row, View } from "./model";
import type { SheetController } from "./use-sheet";

type ColumnProps = {
  controller: SheetController;
  view: View;
  fields: Field[];
  group: { id: string; label: string; color: string };
  readOnly: boolean;
  onRecord: (row: Row) => void;
};
function ColumnRecords({
  controller: c,
  view,
  fields,
  group,
  readOnly,
  onRecord,
}: ColumnProps) {
  const id = c.meta.data!.id,
    [cursor, setCursor] = useState(""),
    [previous, setPrevious] = useState<string[]>([]),
    scroll = useRef<HTMLDivElement>(null);
  const query = useQuery({
    queryKey: [
      "sheets",
      c.auth.workspaceId,
      id,
      "board",
      view.id,
      c.meta.data!.version,
      group.id,
      c.search,
      cursor,
    ],
    queryFn: ({ signal }) =>
      c.api.records(id, view.id, cursor, c.search, group.id, signal),
    gcTime: 0,
  });
  const rows = query.data?.items ?? [];
  const virtual = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scroll.current,
    estimateSize: () => 80 + Math.min(fields.length - 1, 4) * 42,
    getItemKey: (index) => rows[index].id,
    overscan: 3,
  });
  useEffect(() => {
    setCursor("");
    setPrevious([]);
  }, [view.id, c.meta.data!.version, c.search]);
  useEffect(() => {
    scroll.current?.scrollTo({ top: 0 });
  }, [cursor]);
  return (
    <>
      {query.error && (
        <p className="sheet-error" role="alert">
          {query.error.message}
        </p>
      )}
      <div
        ref={scroll}
        className="sheet-board-cards"
        aria-busy={query.isFetching}
      >
        <div style={{ height: virtual.getTotalSize(), position: "relative" }}>
          {virtual.getVirtualItems().map((item) => {
            const row = rows[item.index];
            return (
              <div
                key={row.id}
                ref={virtual.measureElement}
                data-index={item.index}
                className="sheet-board-item"
                style={{ transform: `translateY(${item.start}px)` }}
              >
                <article
                  role="button"
                  tabIndex={0}
                  className="sheet-board-card"
                  draggable={!readOnly && !c.busy}
                  onDragStart={(e) =>
                    e.dataTransfer.setData(
                      "application/orbis-sheet-record",
                      JSON.stringify({
                        sheet: id,
                        id: row.id,
                        version: row.version,
                      }),
                    )
                  }
                  onClick={(e) => {
                    if (!(e.target as HTMLElement).closest("button,a,input"))
                      onRecord(row);
                  }}
                  onKeyDown={(e) => {
                    if (
                      e.target === e.currentTarget &&
                      (e.key === "Enter" || e.key === " ")
                    ) {
                      e.preventDefault();
                      onRecord(row);
                    }
                  }}
                >
                  <strong>
                    {row.values[fields[0].id] != null && row.values[fields[0].id] !== "" ? (
                      <CellValue
                        field={fields[0]}
                        value={row.values[fields[0].id]}
                      />
                    ) : (
                      "未命名记录"
                    )}
                  </strong>
                  {fields.slice(1, 5).map((f) => (
                    <span className="sheet-card-field" key={f.id}>
                      <small>{f.name}</small>
                      <CellValue field={f} value={row.values[f.id]} />
                    </span>
                  ))}
                </article>
              </div>
            );
          })}
        </div>
        {!query.isFetching && !rows.length && (
          <p className="sheet-muted">暂无记录</p>
        )}
      </div>
      {(previous.length > 0 || query.data?.next_cursor) && (
        <footer className="sheet-board-paging">
          <ActionButton
            size="sm"
            disabled={!previous.length || query.isFetching}
            onClick={() => {
              setCursor(previous.at(-1)!);
              setPrevious(previous.slice(0, -1));
            }}
          >
            上一页
          </ActionButton>
          <ActionButton
            size="sm"
            disabled={!query.data?.next_cursor || query.isFetching}
            onClick={() => {
              setPrevious([...previous, cursor]);
              setCursor(query.data!.next_cursor);
            }}
          >
            下一页
          </ActionButton>
        </footer>
      )}
    </>
  );
}
function Column(props: ColumnProps) {
  const { controller: c, view, group, readOnly } = props,
    id = c.meta.data!.id,
    element = useRef<HTMLElement>(null),
    [visible, setVisible] = useState(
      typeof IntersectionObserver === "undefined",
    );
  useEffect(() => {
    if (!element.current || typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver(
      (entries) => setVisible(entries.some((entry) => entry.isIntersecting)),
      {
        root: element.current.closest(".sheet-board"),
        rootMargin: "0px 280px",
      },
    );
    observer.observe(element.current);
    return () => observer.disconnect();
  }, []);
  const count =
    c.stats.data?.groups.find((g) => g.value === group.id)?.count ?? 0;
  return (
    <section
      ref={element}
      className="sheet-board-column"
      aria-label={group.label}
      onDragOver={(e) => {
        if (!readOnly) e.preventDefault();
      }}
      onDrop={(e) => {
        e.preventDefault();
        if (readOnly || c.busy) return;
        const raw = e.dataTransfer.getData("application/orbis-sheet-record");
        if (raw.length > 512) return;
        try {
          const value = JSON.parse(raw) as {
            sheet: string;
            id: string;
            version: number;
          };
          if (value.sheet !== id) return;
          void c
            .change([
              {
                id: value.id,
                version: value.version,
                values: { [view.group_field_id]: group.id || null },
              },
            ])
            .catch(() => {});
        } catch {
          /* Unrelated drag sources do not carry a record command. */
        }
      }}
    >
      <header>
        <span
          className="sheet-tag"
          style={{ background: `var(--sheet-${group.color})` }}
        >
          {group.label}
        </span>
        <span>{count}</span>
        {!readOnly && (
          <ActionButton
            size="sm"
            aria-label={`在${group.label}添加记录`}
            disabled={c.busy}
            onClick={() =>
              void c
                .change([
                  {
                    id: newUUID(),
                    version: 0,
                    values: { [view.group_field_id]: group.id || null },
                  },
                ])
                .catch(() => {})
            }
          >
            <Plus size={15} />
          </ActionButton>
        )}
      </header>
      {visible ? (
        <ColumnRecords {...props} />
      ) : (
        <div className="sheet-board-cards" />
      )}
    </section>
  );
}
export function SheetBoard({
  controller,
  fields,
  readOnly,
  onRecord,
}: {
  controller: SheetController;
  fields: Field[];
  readOnly: boolean;
  onRecord: (row: Row) => void;
}) {
  const view = controller.view!,
    field = fields.find((f) => f.id === view.group_field_id);
  if (!field)
    return (
      <div className="sheet-empty">
        选择一个单选字段进行分组，即可开始使用看板。
      </div>
    );
  return (
    <div className="sheet-board">
      {[{ id: "", label: "未分组", color: "gray" }, ...field.options].map(
        (group) => (
          <Column
            key={group.id}
            controller={controller}
            view={view}
            fields={fields.filter((f) => view.field_ids.includes(f.id))}
            group={group}
            readOnly={readOnly}
            onRecord={onRecord}
          />
        ),
      )}
    </div>
  );
}

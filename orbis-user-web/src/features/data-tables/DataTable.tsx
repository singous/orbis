import { useContext, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { createTable } from "./api";
import { TableHostContext, type TableHost } from "./context";
import { useDataTable } from "./use-table";
import { TableGrid } from "./TableGrid";
import { TableBoard } from "./TableBoard";
import { FieldDialog, ViewDialog } from "./TableSettings";
import { CellEditor } from "./CellEditor";
import {
  tableId,
  TABLE_PAGE_SIZE,
  type TableDefinition,
  type TableField,
  type TableRecord,
} from "./model";
import { Button } from "../../shared/ui/Button";
import { Dialog, DialogContent } from "../../shared/ui/Dialog";
import {
  ArrowLeft,
  ArrowUpRight,
  Layers as Columns3,
  Download,
  Layers as LayoutGrid,
  Plus,
  Redo2,
  Settings2,
  Table2,
  Undo2,
} from "../../shared/ui/icons";
import { apiRequest } from "../../shared/api/api-client";
import { authRequestOptions } from "../../shared/auth/use-auth-request";
import "../../styles/data-tables.css";

export function DataTableBlock({
  blockId,
  props,
  readOnly = false,
}: {
  blockId: string;
  props: Record<string, unknown>;
  readOnly?: boolean;
}) {
  const host = useContext(TableHostContext);
  const [error, setError] = useState<string | null>(null),
    [creating, setCreating] = useState(false);
  const operation = useRef<string | null>(null);
  if (!host)
    return (
      <div className="dt-unavailable">
        {String(props.title || "多维表格")} · 请在所属文档中打开
      </div>
    );
  const effective = { ...host, readOnly: readOnly || host.readOnly };
  if (!props.table_id)
    return (
      <div className="data-table dt-start" contentEditable={false}>
        <Table2 size={24} />
        <div>
          <strong>多维表格</strong>
          <p>用字段整理信息，在表格与看板之间切换。</p>
        </div>
        {!effective.readOnly ? (
          <Button
            disabled={creating}
            onClick={() => {
              if (!host.transact || !host.auth) return;
              setCreating(true);
              setError(null);
              operation.current ??= tableId();
              void host
                .transact((version) =>
                  createTable(
                    host.noteId,
                    {
                      operation_id: operation.current!,
                      expected_document_version: version,
                      block_id: blockId,
                    },
                    host.auth!,
                  ),
                )
                .catch((error) => setError(error.message))
                .finally(() => setCreating(false));
            }}
          >
            {creating ? "正在创建…" : "创建表格"}
          </Button>
        ) : null}
        {error ? <p role="alert">{error}</p> : null}
      </div>
    );
  return (
    <DataTableEditor
      key={`${host.draftScope}:${props.table_id}`}
      host={effective}
      blockId={blockId}
      id={String(props.table_id)}
      revision={Number(props.table_revision)}
    />
  );
}

function DataTableEditor({
  host,
  blockId,
  id,
  revision,
}: {
  host: TableHost;
  blockId: string;
  id: string;
  revision: number;
}) {
  const table = useDataTable(host, id, revision, blockId);
  const [field, setField] = useState<TableField | null | undefined>();
  const [settings, setSettings] = useState(false),
    [record, setRecord] = useState<TableRecord | null>(null);
  const [expanded, setExpanded] = useState(
    () => new URLSearchParams(window.location.search).get("table") === blockId,
  );
  const [actionError, setActionError] = useState<string | null>(null);
  const [titleEditing, setTitleEditing] = useState(false),
    [title, setTitle] = useState("");
  const container = useRef<HTMLElement>(null);
  useEffect(() => {
    const update = () =>
      setExpanded(
        new URLSearchParams(window.location.search).get("table") === blockId,
      );
    window.addEventListener("popstate", update);
    return () => window.removeEventListener("popstate", update);
  }, [blockId]);
  function expand(value: boolean) {
    const url = new URL(window.location.href);
    if (value) {
      url.searchParams.set("table", blockId);
      if (table.viewId) url.searchParams.set("view", table.viewId);
    } else {
      url.searchParams.delete("table");
      url.searchParams.delete("view");
    }
    history.pushState({}, "", url);
    setExpanded(value);
    requestAnimationFrame(() =>
      container.current?.querySelector<HTMLButtonElement>("button")?.focus(),
    );
  }
  const definition = table.definition;
  if (!definition || !table.page || table.recovering)
    return (
      <section className="data-table dt-start" contentEditable={false}>
        <Table2 size={22} />
        <span>{table.error ?? "正在读取多维表格…"}</span>
        {table.error ? (
          <Button size="sm" onClick={() => void table.refresh()}>
            重试
          </Button>
        ) : null}
      </section>
    );
  if (table.page.block_id !== blockId)
    return (
      <section className="data-table dt-start" contentEditable={false}>
        正在保存独立副本，完成后即可编辑。
      </section>
    );
  const view =
    definition.views.find((view) => view.id === table.viewId) ??
    definition.views[0];
  function save() {
    void table.save().catch(() => {});
  }
  function saveDefinition(next: TableDefinition) {
    table.stage({ definition: next });
    return table.save().catch(() => undefined);
  }
  function exportFile(format: "csv" | "markdown") {
    if (!host.auth) return;
    setActionError(null);
    void table
      .save()
      .then(async () => {
        // apiRequest intentionally expects envelopes; downloads use the same auth
        // refresh flow through a text-returning JSON export endpoint.
        const data = (await apiRequest(
          `/notes/${host.noteId}/tables/${id}/export-text?format=${format}&view_id=${view.id}`,
          authRequestOptions(host.auth!),
        )) as { content: string };
        const url = URL.createObjectURL(
          new Blob([data.content], {
            type:
              format === "csv"
                ? "text/csv;charset=utf-8"
                : "text/markdown;charset=utf-8",
          }),
        );
        const link = document.createElement("a");
        link.href = url;
        link.download = `${definition!.title}.${format === "csv" ? "csv" : "md"}`;
        link.click();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
      })
      .catch((error) => setActionError(error.message));
  }
  const selectedRecord = record
    ? (table.rows.find((item) => item.id === record.id) ?? {
        ...record,
        values: {
          ...record.values,
          ...table.pending.upserts?.find((item) => item.id === record.id)
            ?.values,
        },
      })
    : null;
  const content = (
    <section
      ref={container}
      className={`data-table ${expanded ? "dt-expanded" : ""}`}
      contentEditable={false}
      aria-label={definition.title}
      onKeyDown={(event) => {
        event.stopPropagation();
        if (
          (event.ctrlKey || event.metaKey) &&
          event.key === "z" &&
          !(event.target instanceof HTMLInputElement)
        ) {
          event.preventDefault();
          void table.travel(event.shiftKey ? "redo" : "undo");
        }
        if (
          event.key === "Escape" &&
          expanded &&
          !settings &&
          field === undefined &&
          !record
        )
          expand(false);
      }}
    >
      <header className="dt-heading">
        {expanded ? (
          <button
            type="button"
            className="dt-back"
            onClick={() => expand(false)}
          >
            <ArrowLeft size={16} />
            返回文档
          </button>
        ) : (
          <Table2 size={18} />
        )}
        <div className="dt-title-area">
          {titleEditing ? (
            <input
              autoFocus
              aria-label="表格名称"
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              onBlur={() => {
                if (title.trim())
                  saveDefinition({ ...definition, title: title.trim() });
                setTitleEditing(false);
              }}
              onKeyDown={(event) => {
                if (event.key === "Enter") event.currentTarget.blur();
              }}
            />
          ) : (
            <button
              type="button"
              className="dt-title"
              disabled={host.readOnly}
              onClick={() => {
                setTitle(definition.title);
                setTitleEditing(true);
              }}
            >
              {definition.title}
            </button>
          )}
          <span className="dt-save" aria-live="polite">
            {host.readOnly
              ? "只读"
              : table.saving
                ? "保存中…"
                : table.error
                  ? "保存失败"
                  : table.dirty
                    ? "有未保存修改"
                    : "已保存"}
          </span>
        </div>
        {!expanded ? (
          <Button
            size="sm"
            variant="ghost"
            icon={<ArrowUpRight size={16} />}
            onClick={() => expand(true)}
          >
            展开
          </Button>
        ) : null}
      </header>
      <div className="dt-toolbar">
        <div className="dt-view-tabs" role="tablist" aria-label="表格视图">
          {definition.views.map((item) => (
            <button
              type="button"
              role="tab"
              aria-selected={item.id === view.id}
              key={item.id}
              onClick={() => table.setViewId(item.id)}
            >
              {item.kind === "grid" ? (
                <Table2 size={14} />
              ) : (
                <LayoutGrid size={14} />
              )}
              {item.name}
            </button>
          ))}
        </div>
        {!host.readOnly ? (
          <button
            type="button"
            className="dt-add-view"
            aria-label="添加视图"
            onClick={async () => {
              const next = {
                ...structuredClone(view),
                id: tableId(),
                name: `新视图 ${definition.views.length + 1}`,
              };
              const saved = await saveDefinition({
                ...definition,
                views: [...definition.views, next],
              });
              if (saved) table.setViewId(next.id);
            }}
          >
            <Plus size={15} />
          </button>
        ) : null}
        <div className="dt-tools">
          {!host.readOnly ? (
            <>
              <Button
                size="sm"
                variant="ghost"
                icon={<Settings2 size={14} />}
                onClick={() => setSettings(true)}
              >
                视图设置
              </Button>
              <Button
                size="sm"
                variant="ghost"
                icon={<Columns3 size={14} />}
                onClick={() => setField(null)}
              >
                添加字段
              </Button>
            </>
          ) : null}
          <details className="dt-actions">
            <summary aria-label="更多表格操作">•••</summary>
            <div>
              {host.auth ? (
                <>
                  <button type="button" onClick={() => exportFile("csv")}>
                    <Download size={14} />
                    导出 CSV
                  </button>
                  <button type="button" onClick={() => exportFile("markdown")}>
                    导出 Markdown
                  </button>
                </>
              ) : null}
              {!host.readOnly ? (
                <>
                  <button
                    type="button"
                    onClick={() =>
                      saveDefinition({
                        ...definition,
                        views: [
                          ...definition.views,
                          {
                            ...structuredClone(view),
                            id: tableId(),
                            name: `${view.name} 副本`,
                          },
                        ],
                      })
                    }
                  >
                    复制当前视图
                  </button>
                  <button
                    type="button"
                    disabled={
                      definition.views.length < 2 ||
                      definition.public_view_id === view.id
                    }
                    title={
                      definition.public_view_id === view.id
                        ? "请先在视图设置中选择其他公开视图"
                        : undefined
                    }
                    onClick={() => {
                      const views = definition.views.filter(
                        (item) => item.id !== view.id,
                      );
                      if (views.length) {
                        saveDefinition({
                          ...definition,
                          views,
                          public_view_id: definition.public_view_id,
                        });
                        table.setViewId(views[0].id);
                      }
                    }}
                  >
                    删除当前视图
                  </button>
                </>
              ) : null}
            </div>
          </details>
        </div>
      </div>
      {table.error || actionError ? (
        <div className="dt-notice" role="alert">
          {table.error ?? actionError}
          <Button size="sm" onClick={save}>
            重试保存
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={() =>
              void table
                .reapply()
                .catch((error) => setActionError(error.message))
            }
          >
            以最新版本重新检查本地修改
          </Button>
        </div>
      ) : null}
      {table.storageError ? (
        <p className="dt-notice" role="alert">
          {table.storageError}
        </p>
      ) : null}
      {table.candidates.length ? (
        <div className="dt-notice">
          <span>发现其他会话保留的表格草稿，恢复后原草稿仍会保留。</span>
          {table.candidates.map((candidate, index) => (
            <Button
              size="sm"
              key={candidate.scope}
              disabled={table.dirty || table.saving}
              onClick={() => table.recover(candidate)}
            >
              恢复表格草稿 {index + 1}
            </Button>
          ))}
        </div>
      ) : null}
      {table.dirty && !table.saving ? (
        <div className="dt-draft-bar">
          <span>本机修改待同步</span>
          <Button size="sm" onClick={save}>
            保存修改
          </Button>
        </div>
      ) : null}
      {view.kind === "grid" || host.shareToken ? (
        <TableGrid
          definition={definition}
          view={view}
          records={table.rows}
          readOnly={host.readOnly}
          onCell={(row, field, value) =>
            table.stage({ upserts: [{ id: row, values: { [field]: value } }] })
          }
          onCommit={save}
          onRecord={setRecord}
          onField={setField}
        />
      ) : (
        <TableBoard
          host={host}
          page={table.page}
          definition={definition}
          view={view}
          onRecord={setRecord}
          onMove={(row, value) => {
            if (view.group_field_id) {
              table.stage({
                upserts: [
                  { id: row, values: { [view.group_field_id]: value } },
                ],
              });
              save();
            }
          }}
        />
      )}
      <footer className="dt-footer">
        <div>
          {!host.readOnly ? (
            <>
              <Button
                size="sm"
                variant="ghost"
                icon={<Plus size={15} />}
                onClick={() => {
                  table.stage({
                    upserts: [
                      {
                        id: tableId(),
                        values: Object.fromEntries(
                          definition.fields.map((field) => [
                            field.id,
                            field.kind === "checkbox" ? false : null,
                          ]),
                        ),
                      },
                    ],
                  });
                  save();
                }}
              >
                添加记录
              </Button>
              <Button
                size="sm"
                variant="ghost"
                title="撤销表格操作"
                aria-label="撤销表格操作"
                disabled={!table.canUndo || table.dirty || table.saving}
                icon={<Undo2 size={14} />}
                onClick={() => void table.travel("undo")}
              />
              <Button
                size="sm"
                variant="ghost"
                title="重做表格操作"
                aria-label="重做表格操作"
                disabled={!table.canRedo || table.dirty || table.saving}
                icon={<Redo2 size={14} />}
                onClick={() => void table.travel("redo")}
              />
            </>
          ) : null}
          <span>{table.page.total} 条记录</span>
        </div>
        {view.kind === "grid" || host.shareToken ? (
          <div>
            <Button
              size="sm"
              variant="ghost"
              disabled={table.offset === 0 || table.loading}
              onClick={() =>
                table.setOffset(Math.max(0, table.offset - TABLE_PAGE_SIZE))
              }
            >
              上一页
            </Button>
            <span>
              {table.offset + (table.rows.length ? 1 : 0)}–
              {table.offset + table.rows.length}
            </span>
            <Button
              size="sm"
              variant="ghost"
              disabled={!table.page.has_more || table.loading}
              onClick={() => table.setOffset(table.page!.next_offset)}
            >
              下一页
            </Button>
          </div>
        ) : null}
      </footer>
      {field !== undefined && !host.readOnly ? (
        <FieldDialog
          key={field?.id ?? "new"}
          definition={definition}
          field={field}
          onClose={() => setField(undefined)}
          onSave={saveDefinition}
        />
      ) : null}
      {settings && !host.readOnly ? (
        <ViewDialog
          definition={definition}
          view={view}
          onClose={() => setSettings(false)}
          onSave={saveDefinition}
        />
      ) : null}
      {selectedRecord ? (
        <Dialog
          open
          onOpenChange={(open) => {
            if (!open) setRecord(null);
          }}
        >
          <DialogContent title="记录详情">
            <div className="dt-form">
              {definition.fields.map((field) => (
                <label key={field.id}>
                  {field.name}
                  <CellEditor
                    field={field}
                    value={selectedRecord.values[field.id]}
                    readOnly={host.readOnly}
                    onChange={(value) =>
                      table.stage({
                        upserts: [
                          {
                            id: selectedRecord.id,
                            values: { [field.id]: value },
                          },
                        ],
                      })
                    }
                    onCommit={save}
                  />
                </label>
              ))}
              {!host.readOnly ? (
                <div className="dt-form-actions">
                  <Button
                    variant="danger"
                    onClick={() => {
                      table.stage({ deletes: [selectedRecord.id] });
                      save();
                      setRecord(null);
                    }}
                  >
                    删除记录
                  </Button>
                  <Button
                    variant="primary"
                    onClick={() => {
                      save();
                      setRecord(null);
                    }}
                  >
                    完成
                  </Button>
                </div>
              ) : null}
            </div>
          </DialogContent>
        </Dialog>
      ) : null}
    </section>
  );
  return expanded ? createPortal(content, document.body) : content;
}

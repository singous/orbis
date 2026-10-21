import { useState } from "react";
import { Button } from "../../shared/ui/Button";
import { Dialog, DialogContent } from "../../shared/ui/Dialog";
import { CellEditor } from "./CellEditor";
import {
  FIELD_LABELS,
  tableId,
  type FieldKind,
  type TableDefinition,
  type TableField,
  type TableFilter,
  type TableView,
} from "./model";

export function FieldDialog({
  definition,
  field,
  onClose,
  onSave,
}: {
  definition: TableDefinition;
  field: TableField | null;
  onClose: () => void;
  onSave: (definition: TableDefinition) => void;
}) {
  const [name, setName] = useState(field?.name ?? "");
  const [kind, setKind] = useState<FieldKind>(field?.kind ?? "text");
  const [options, setOptions] = useState(
    field?.options.map((option) => option.label).join("\n") ?? "",
  );
  const [error, setError] = useState("");
  function submit() {
    if (!name.trim()) {
      setError("请填写字段名称");
      return;
    }
    const labels = options
      .split("\n")
      .map((value) => value.trim())
      .filter(Boolean);
    const next: TableField = {
      id: field?.id ?? tableId(),
      name: name.trim(),
      kind,
      options: ["select", "multi_select"].includes(kind)
        ? labels.map((label, index) => ({
            id: field?.options[index]?.id ?? tableId(),
            label,
            color:
              field?.options[index]?.color ??
              ["gray", "blue", "green", "amber", "purple"][index % 5],
          }))
        : [],
    };
    if (field && next.options.length < field.options.length) {
      setError("已有选项需要保留；可以重命名或追加选项");
      return;
    }
    onSave({
      ...definition,
      fields: field
        ? definition.fields.map((item) => (item.id === field.id ? next : item))
        : [...definition.fields, next],
      views: field
        ? definition.views
        : definition.views.map((view) => ({
            ...view,
            field_ids: [...view.field_ids, next.id],
          })),
    });
    onClose();
  }
  function remove() {
    if (!field || definition.fields.length === 1) return;
    const publicFields = definition.public_field_ids.filter(
      (id) => id !== field.id,
    );
    if (!publicFields.length) {
      setError(
        "这是唯一公开字段，请先在视图设置中明确选择其他公开字段，再删除。",
      );
      return;
    }
    const publicView = definition.views.find(
      (view) => view.id === definition.public_view_id,
    )!;
    if (publicView.filters.some((filter) => filter.field_id === field.id)) {
      setError(
        "公开视图正在使用此字段筛选记录，请先调整公开筛选，再删除字段。",
      );
      return;
    }
    const fields = definition.fields.filter((item) => item.id !== field.id);
    const views = definition.views.map((view) => ({
      ...view,
      field_ids: view.field_ids.filter((id) => id !== field.id),
      widths: Object.fromEntries(
        Object.entries(view.widths).filter(([id]) => id !== field.id),
      ),
      filters: view.filters.filter((item) => item.field_id !== field.id),
      sorts: view.sorts.filter((item) => item.field_id !== field.id),
      group_field_id:
        view.group_field_id === field.id ? null : view.group_field_id,
    }));
    onSave({
      ...definition,
      fields,
      views,
      public_field_ids: publicFields,
    });
    onClose();
  }
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent
        title={field ? "编辑字段" : "添加字段"}
        description="字段标识保持稳定；删除字段后可通过撤销或文档历史恢复。"
      >
        <div className="dt-form">
          <label>
            字段名称
            <input
              autoFocus
              maxLength={120}
              value={name}
              onChange={(event) => setName(event.target.value)}
            />
          </label>
          <label>
            字段类型
            <select
              value={kind}
              disabled={Boolean(field)}
              onChange={(event) => setKind(event.target.value as FieldKind)}
            >
              {Object.entries(FIELD_LABELS).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          {["select", "multi_select"].includes(kind) ? (
            <label>
              选项（每行一个）
              <textarea
                rows={5}
                value={options}
                onChange={(event) => setOptions(event.target.value)}
              />
            </label>
          ) : null}
          {error ? <p role="alert">{error}</p> : null}
          <div className="dt-form-actions">
            {field ? (
              <Button
                variant="danger"
                disabled={definition.fields.length === 1}
                onClick={remove}
              >
                删除字段
              </Button>
            ) : null}
            <Button variant="primary" onClick={submit}>
              保存字段
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export function ViewDialog({
  definition,
  view,
  onClose,
  onSave,
}: {
  definition: TableDefinition;
  view: TableView;
  onClose: () => void;
  onSave: (definition: TableDefinition) => void;
}) {
  const [draft, setDraft] = useState(() => structuredClone(view));
  const [publicFields, setPublicFields] = useState(definition.public_field_ids);
  const [publicView, setPublicView] = useState(definition.public_view_id);
  const [error, setError] = useState("");
  const setFilter = (index: number, change: Partial<TableFilter>) =>
    setDraft((old) => ({
      ...old,
      filters: old.filters.map((item, i) =>
        i === index ? { ...item, ...change } : item,
      ),
    }));
  function moveField(id: string, direction: number) {
    const fields = [...draft.field_ids];
    const index = fields.indexOf(id),
      target = index + direction;
    if (index < 0 || target < 0 || target >= fields.length) return;
    [fields[index], fields[target]] = [fields[target], fields[index]];
    setDraft({ ...draft, field_ids: fields });
  }
  const ordered = [
    ...draft.field_ids.map((id) =>
      definition.fields.find((field) => field.id === id)!,
    ),
    ...definition.fields.filter((field) => !draft.field_ids.includes(field.id)),
  ];
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent
        title="视图设置"
        description="筛选与排序作用于整张表；公开字段由服务端限制。"
        className="dt-settings-dialog"
      >
        <div className="dt-form">
          <label>
            视图名称
            <input
              value={draft.name}
              maxLength={120}
              onChange={(event) =>
                setDraft({ ...draft, name: event.target.value })
              }
            />
          </label>
          <label>
            展示方式
            <select
              value={draft.kind}
              onChange={(event) =>
                setDraft({
                  ...draft,
                  kind: event.target.value as TableView["kind"],
                })
              }
            >
              <option value="grid">表格</option>
              <option value="kanban">看板</option>
            </select>
          </label>
          <label>
            分组字段
            <select
              value={draft.group_field_id ?? ""}
              onChange={(event) =>
                setDraft({
                  ...draft,
                  group_field_id: event.target.value || null,
                })
              }
            >
              <option value="">不分组</option>
              {definition.fields
                .filter((field) => field.kind === "select")
                .map((field) => (
                  <option key={field.id} value={field.id}>
                    {field.name}
                  </option>
                ))}
            </select>
          </label>
          <fieldset>
            <legend>显示字段与列宽</legend>
            {ordered.map((field) => (
              <div className="dt-setting-row" key={field.id}>
                <label>
                  <input
                    type="checkbox"
                    checked={draft.field_ids.includes(field.id)}
                    onChange={(event) =>
                      setDraft({
                        ...draft,
                        field_ids: event.target.checked
                          ? [...draft.field_ids, field.id]
                          : draft.field_ids.filter((id) => id !== field.id),
                      })
                    }
                  />
                  {field.name}
                </label>
                <input
                  type="number"
                  aria-label={`${field.name}列宽`}
                  min={100}
                  max={600}
                  value={draft.widths[field.id] ?? 190}
                  onChange={(event) =>
                    setDraft({
                      ...draft,
                      widths: {
                        ...draft.widths,
                        [field.id]: Number(event.target.value),
                      },
                    })
                  }
                />
                <button
                  type="button"
                  aria-label={`上移${field.name}`}
                  onClick={() => moveField(field.id, -1)}
                >
                  ↑
                </button>
                <button
                  type="button"
                  aria-label={`下移${field.name}`}
                  onClick={() => moveField(field.id, 1)}
                >
                  ↓
                </button>
              </div>
            ))}
          </fieldset>
          <fieldset>
            <legend>筛选 · 同时满足</legend>
            {draft.filters.map((filter, index) => {
              const field = definition.fields.find(
                (field) => field.id === filter.field_id,
              )!;
              return (
                <div className="dt-filter-row" key={index}>
                  <select
                    aria-label={`筛选字段 ${index + 1}`}
                    value={filter.field_id}
                    onChange={(event) =>
                      setFilter(index, {
                        field_id: event.target.value,
                        operator:
                          definition.fields.find(
                            (field) => field.id === event.target.value,
                          )?.kind === "multi_select"
                            ? "contains"
                            : "eq",
                        value: null,
                      })
                    }
                  >
                    {definition.fields.map((field) => (
                      <option key={field.id} value={field.id}>
                        {field.name}
                      </option>
                    ))}
                  </select>
                  <select
                    aria-label={`筛选条件 ${index + 1}`}
                    value={filter.operator}
                    onChange={(event) =>
                      setFilter(index, {
                        operator: event.target.value as TableFilter["operator"],
                      })
                    }
                  >
                    {Object.entries({
                      ...(field.kind !== "multi_select"
                        ? { eq: "等于", ne: "不等于" }
                        : {}),
                      ...(["text", "url", "multi_select"].includes(field.kind)
                        ? { contains: "包含" }
                        : {}),
                      empty: "为空",
                      not_empty: "不为空",
                      ...(["number", "datetime"].includes(field.kind)
                        ? {
                            gt: "大于",
                            lt: "小于",
                            gte: "大于等于",
                            lte: "小于等于",
                          }
                        : {}),
                    }).map(([key, value]) => (
                      <option key={key} value={key}>
                        {value}
                      </option>
                    ))}
                  </select>
                  {!["empty", "not_empty"].includes(filter.operator) ? (
                    field.kind === "select" || field.kind === "multi_select" ? (
                      <select
                        aria-label={`筛选值 ${index + 1}`}
                        value={String(filter.value ?? "")}
                        onChange={(event) =>
                          setFilter(index, {
                            value: event.target.value || null,
                          })
                        }
                      >
                        <option value="">未选择</option>
                        {field.options.map((option) => (
                          <option key={option.id} value={option.id}>
                            {option.label}
                          </option>
                        ))}
                      </select>
                    ) : (
                      <CellEditor
                        field={{ ...field, name: `筛选值 ${index + 1}` }}
                        value={filter.value}
                        readOnly={false}
                        onChange={(value) => setFilter(index, { value })}
                        onCommit={() => {}}
                      />
                    )
                  ) : null}
                  <button
                    type="button"
                    aria-label={`移除筛选 ${index + 1}`}
                    onClick={() =>
                      setDraft({
                        ...draft,
                        filters: draft.filters.filter((_, i) => i !== index),
                      })
                    }
                  >
                    ×
                  </button>
                </div>
              );
            })}
            <Button
              size="sm"
              onClick={() =>
                setDraft({
                  ...draft,
                  filters: [
                    ...draft.filters,
                    {
                      field_id: definition.fields[0].id,
                      operator: "not_empty",
                      value: null,
                    },
                  ],
                })
              }
            >
              添加筛选
            </Button>
          </fieldset>
          <fieldset>
            <legend>排序</legend>
            {draft.sorts.map((sort, index) => (
              <div className="dt-setting-row" key={index}>
                <select
                  aria-label={`排序字段 ${index + 1}`}
                  value={sort.field_id}
                  onChange={(event) =>
                    setDraft({
                      ...draft,
                      sorts: draft.sorts.map((item, i) =>
                        i === index
                          ? { ...item, field_id: event.target.value }
                          : item,
                      ),
                    })
                  }
                >
                  {definition.fields.map((field) => (
                    <option key={field.id} value={field.id}>
                      {field.name}
                    </option>
                  ))}
                </select>
                <select
                  aria-label={`排序方向 ${index + 1}`}
                  value={String(sort.descending)}
                  onChange={(event) =>
                    setDraft({
                      ...draft,
                      sorts: draft.sorts.map((item, i) =>
                        i === index
                          ? {
                              ...item,
                              descending: event.target.value === "true",
                            }
                          : item,
                      ),
                    })
                  }
                >
                  <option value="false">升序</option>
                  <option value="true">降序</option>
                </select>
                <button
                  type="button"
                  aria-label={`移除排序 ${index + 1}`}
                  onClick={() =>
                    setDraft({
                      ...draft,
                      sorts: draft.sorts.filter((_, i) => i !== index),
                    })
                  }
                >
                  ×
                </button>
              </div>
            ))}
            <Button
              size="sm"
              onClick={() =>
                setDraft({
                  ...draft,
                  sorts: [
                    ...draft.sorts,
                    { field_id: definition.fields[0].id, descending: false },
                  ],
                })
              }
            >
              添加排序
            </Button>
          </fieldset>
          <fieldset>
            <legend>公开内容</legend>
            <label>
              公开视图
              <select
                value={publicView}
                onChange={(event) => setPublicView(event.target.value)}
              >
                {definition.views.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.name}
                  </option>
                ))}
              </select>
            </label>
            {definition.fields.map((field) => (
              <label className="dt-check" key={field.id}>
                <input
                  type="checkbox"
                  checked={publicFields.includes(field.id)}
                  onChange={(event) =>
                    setPublicFields(
                      event.target.checked
                        ? [...publicFields, field.id]
                        : publicFields.filter((id) => id !== field.id),
                    )
                  }
                />
                允许公开“{field.name}”
              </label>
            ))}
          </fieldset>
          {error ? <p role="alert">{error}</p> : null}
          <div className="dt-form-actions">
            <Button
              variant="primary"
              onClick={() => {
                if (
                  !draft.name.trim() ||
                  !draft.field_ids.length ||
                  !publicFields.length
                ) {
                  setError("请填写视图名称，至少保留一个显示字段和公开字段");
                  return;
                }
                onSave({
                  ...definition,
                  public_view_id: publicView,
                  public_field_ids: publicFields,
                  views: definition.views.map((item) =>
                    item.id === view.id ? draft : item,
                  ),
                });
                onClose();
              }}
            >
              保存视图
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

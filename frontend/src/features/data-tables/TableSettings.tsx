import { Checkbox } from "@orbis/ui/checkbox";
import { Input } from "@orbis/ui/input";
import { Textarea } from "@orbis/ui/textarea";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@orbis/ui/select";
import { tableFormClassName, tableFormActionsClassName, tableSettingRowClassName, tableFilterRowClassName } from "./table-chrome";
import { reportError } from "../../shared/api/request-feedback";
import { useId, useRef, useState } from "react";
import { Button } from "@orbis/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@orbis/ui/dialog";
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
  const nameInput = useRef<HTMLInputElement>(null);
  const [name, setName] = useState(field?.name ?? "");
  const [kind, setKind] = useState<FieldKind>(field?.kind ?? "text");
  const [options, setOptions] = useState(
    field?.options.map((option) => option.label).join("\n") ?? "",
  );

  function submit() {
    if (!name.trim()) {
      reportError("请填写字段名称");
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
      reportError("已有选项需要保留；可以重命名或追加选项");
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
      reportError("这是唯一公开字段，请先在视图设置中明确选择其他公开字段，再删除。");
      return;
    }
    const publicView = definition.views.find(
      (view) => view.id === definition.public_view_id,
    )!;
    if (publicView.filters.some((filter) => filter.field_id === field.id)) {
      reportError("公开视图正在使用此字段筛选记录，请先调整公开筛选，再删除字段。");
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
  const fieldTypeItems = [...Object.entries(FIELD_LABELS).map(([value, label]) => ({ value: String(value), label: label }))];
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent


        initialFocus={nameInput}
      ><DialogHeader><DialogTitle>{field ? "编辑字段" : "添加字段"}</DialogTitle><DialogDescription>{"字段标识保持稳定；删除字段后可通过撤销或文档历史恢复。"}</DialogDescription></DialogHeader>
        <div className={tableFormClassName}>
          <label className="grid gap-2 text-sm font-medium">
            字段名称
            <Input
              ref={nameInput}
              maxLength={120}
              value={name}
              onChange={(event) => setName(event.target.value)}
            />
          </label>
          <label className="grid gap-2 text-sm font-medium">
            字段类型
            <Select
              value={kind}
              disabled={Boolean(field)}
              onValueChange={nextValue => { if (nextValue === null) return; setKind(nextValue as FieldKind); }}
              items={fieldTypeItems}
            >
              <SelectTrigger aria-label="字段类型"><SelectValue /></SelectTrigger>
              <SelectContent>
                {fieldTypeItems.map(item => (
                  <SelectItem key={item.value} value={item.value}>{item.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </label>
          {["select", "multi_select"].includes(kind) ? (
            <label className="grid gap-2 text-sm font-medium">
              选项（每行一个）
              <Textarea
                rows={5}
                value={options}
                onChange={(event) => setOptions(event.target.value)}
              />
            </label>
          ) : null}

          <div className={tableFormActionsClassName}>
            {field ? (
              <Button
                variant="destructive"
                disabled={definition.fields.length === 1}
                onClick={remove}
              >
                删除字段
              </Button>
            ) : null}
            <Button variant="default" onClick={submit}>
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
  const checkboxId = useId();
  const [draft, setDraft] = useState(() => structuredClone(view));
  const [publicFields, setPublicFields] = useState(definition.public_field_ids);
  const [publicView, setPublicView] = useState(definition.public_view_id);

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
  const viewKindItems = [{ value: "grid", label: "表格" }, { value: "kanban", label: "看板" }];
  const groupFieldItems = [{ value: "", label: "不分组" }, ...definition.fields
                .filter((field) => field.kind === "select")
                .map((field) => ({ value: String(field.id), label: field.name }))];
  const sortFieldItems = [...definition.fields.map((field) => ({ value: String(field.id), label: field.name }))];
  const sortDirectionItems = [{ value: "false", label: "升序" }, { value: "true", label: "降序" }];
  const publicViewItems = [...definition.views.map((item) => ({ value: String(item.id), label: item.name }))];
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent


        className="w-[min(680px,95vw)]! max-w-[680px]!"
      ><DialogHeader><DialogTitle>{"视图设置"}</DialogTitle><DialogDescription>{"筛选与排序作用于整张表；公开字段由服务端限制。"}</DialogDescription></DialogHeader>
        <div className={tableFormClassName}>
          <label className="grid gap-2 text-sm font-medium">
            视图名称
            <Input
              value={draft.name}
              maxLength={120}
              onChange={(event) =>
                setDraft({ ...draft, name: event.target.value })
              }
            />
          </label>
          <label className="grid gap-2 text-sm font-medium">
            展示方式
            <Select
              value={draft.kind}
              onValueChange={nextValue => { if (nextValue === null) return; setDraft({
                                ...draft,
                                kind: nextValue as TableView["kind"],
                              }); }}
              items={viewKindItems}
            >
              <SelectTrigger aria-label="展示方式"><SelectValue /></SelectTrigger>
              <SelectContent>
                {viewKindItems.map(item => (
                  <SelectItem key={item.value} value={item.value}>{item.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </label>
          <label className="grid gap-2 text-sm font-medium">
            分组字段
            <Select
              value={draft.group_field_id ?? ""}
              onValueChange={nextValue => { if (nextValue === null) return; setDraft({
                                ...draft,
                                group_field_id: nextValue || null,
                              }); }}
              items={groupFieldItems}
            >
              <SelectTrigger aria-label="分组字段"><SelectValue /></SelectTrigger>
              <SelectContent>
                {groupFieldItems.map(item => (
                  <SelectItem key={item.value} value={item.value}>{item.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </label>
          <fieldset>
            <legend>显示字段与列宽</legend>
            {ordered.map((field) => (
              <div className={tableSettingRowClassName} key={field.id}>
                <label htmlFor={`${checkboxId}-visible-${field.id}`} className="flex items-center gap-2">
                  <Checkbox
                    id={`${checkboxId}-visible-${field.id}`}
                    checked={draft.field_ids.includes(field.id)}
                    onCheckedChange={(checked) =>
                      setDraft({
                        ...draft,
                        field_ids: checked
                          ? [...draft.field_ids, field.id]
                          : draft.field_ids.filter((id) => id !== field.id),
                      })
                    }
                  />
                  {field.name}
                </label>
                <Input
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
                <Button
                  type="button"
                  aria-label={`上移${field.name}`}
                  onClick={() => moveField(field.id, -1)} variant="ghost" size="icon"
                >
                  ↑
                </Button>
                <Button
                  type="button"
                  aria-label={`下移${field.name}`}
                  onClick={() => moveField(field.id, 1)} variant="ghost" size="icon"
                >
                  ↓
                </Button>
              </div>
            ))}
          </fieldset>
          <fieldset>
            <legend>筛选 · 同时满足</legend>
            {draft.filters.map((filter, index) => {
              const field = definition.fields.find(
                (field) => field.id === filter.field_id,
              )!;
              const filterFieldItems = [...definition.fields.map((field) => ({ value: String(field.id), label: field.name }))];
  const filterOperatorItems = [...Object.entries({
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
                    }).map(([key, value]) => ({ value: String(key), label: value }))];
  const filterValueItems = [{ value: "", label: "未选择" }, ...field.options.map((option) => ({ value: String(option.id), label: option.label }))];
  return (
                <div className={tableFilterRowClassName} key={index}>
                  <Select
                    value={filter.field_id}
                    onValueChange={nextValue => { if (nextValue === null) return; setFilter(index, {
                                            field_id: nextValue,
                                            operator:
                                              definition.fields.find(
                                                (field) => field.id === nextValue,
                                              )?.kind === "multi_select"
                                                ? "contains"
                                                : "eq",
                                            value: null,
                                          }); }}
                    items={filterFieldItems}
                  >
                    <SelectTrigger aria-label={`筛选字段 ${index + 1}`}><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {filterFieldItems.map(item => (
                        <SelectItem key={item.value} value={item.value}>{item.label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Select
                    value={filter.operator}
                    onValueChange={nextValue => { if (nextValue === null) return; setFilter(index, {
                                            operator: nextValue as TableFilter["operator"],
                                          }); }}
                    items={filterOperatorItems}
                  >
                    <SelectTrigger aria-label={`筛选条件 ${index + 1}`}><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {filterOperatorItems.map(item => (
                        <SelectItem key={item.value} value={item.value}>{item.label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  {!["empty", "not_empty"].includes(filter.operator) ? (
                    field.kind === "select" || field.kind === "multi_select" ? (
                      <Select
                        value={String(filter.value ?? "")}
                        onValueChange={nextValue => { if (nextValue === null) return; setFilter(index, {
                                                    value: nextValue || null,
                                                  }); }}
                        items={filterValueItems}
                      >
                        <SelectTrigger aria-label={`筛选值 ${index + 1}`}><SelectValue /></SelectTrigger>
                        <SelectContent>
                          {filterValueItems.map(item => (
                            <SelectItem key={item.value} value={item.value}>{item.label}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
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
                  <Button
                    type="button"
                    aria-label={`移除筛选 ${index + 1}`}
                    onClick={() =>
                      setDraft({
                        ...draft,
                        filters: draft.filters.filter((_, i) => i !== index),
                      })
                    } variant="ghost" size="icon"
                  >
                    ×
                  </Button>
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
              <div className={tableSettingRowClassName} key={index}>
                <Select
                  value={sort.field_id}
                  onValueChange={nextValue => { if (nextValue === null) return; setDraft({
                                        ...draft,
                                        sorts: draft.sorts.map((item, i) =>
                                          i === index
                                            ? { ...item, field_id: nextValue }
                                            : item,
                                        ),
                                      }); }}
                  items={sortFieldItems}
                >
                  <SelectTrigger aria-label={`排序字段 ${index + 1}`}><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {sortFieldItems.map(item => (
                      <SelectItem key={item.value} value={item.value}>{item.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Select
                  value={String(sort.descending)}
                  onValueChange={nextValue => { if (nextValue === null) return; setDraft({
                                        ...draft,
                                        sorts: draft.sorts.map((item, i) =>
                                          i === index
                                            ? {
                                                ...item,
                                                descending: nextValue === "true",
                                              }
                                            : item,
                                        ),
                                      }); }}
                  items={sortDirectionItems}
                >
                  <SelectTrigger aria-label={`排序方向 ${index + 1}`}><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {sortDirectionItems.map(item => (
                      <SelectItem key={item.value} value={item.value}>{item.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Button
                  type="button"
                  aria-label={`移除排序 ${index + 1}`}
                  onClick={() =>
                    setDraft({
                      ...draft,
                      sorts: draft.sorts.filter((_, i) => i !== index),
                    })
                  } variant="ghost" size="icon"
                >
                  ×
                </Button>
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
            <label className="grid gap-2 text-sm font-medium">
              公开视图
              <Select
                value={publicView}
                onValueChange={nextValue => { if (nextValue === null) return; setPublicView(nextValue); }}
                items={publicViewItems}
              >
                <SelectTrigger aria-label="公开视图"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {publicViewItems.map(item => (
                    <SelectItem key={item.value} value={item.value}>{item.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </label>
            {definition.fields.map((field) => (
              <label htmlFor={`${checkboxId}-public-${field.id}`} className="flex items-center gap-2" key={field.id}>
                <Checkbox
                  id={`${checkboxId}-public-${field.id}`}
                  checked={publicFields.includes(field.id)}
                  onCheckedChange={(checked) =>
                    setPublicFields(
                      checked
                        ? [...publicFields, field.id]
                        : publicFields.filter((id) => id !== field.id),
                    )
                  }
                />
                允许公开“{field.name}”
              </label>
            ))}
          </fieldset>

          <div className={tableFormActionsClassName}>
            <Button
              variant="default"
              onClick={() => {
                if (
                  !draft.name.trim() ||
                  !draft.field_ids.length ||
                  !publicFields.length
                ) {
                  reportError("请填写视图名称，至少保留一个显示字段和公开字段");
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

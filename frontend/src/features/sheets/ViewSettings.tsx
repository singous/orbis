import { Spinner } from "@orbis/ui/spinner";
import { sheetSettingRowClassName, sheetActionClassName } from "./sheet-chrome";
import { reportError } from "../../shared/api/request-feedback";
import { useId, useState } from "react";
import { Button } from "@orbis/ui/button";
import { RadioGroup, RadioGroupItem } from "@orbis/ui/radio-group";

import { Plus, Trash2 } from "../../shared/ui/icons";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@orbis/ui/select";
import { ValueEditor } from "./Cell";
import { FieldManager } from "./FieldManager";
import { KINDS, type Field, type View } from "./model";
import { Popover, type Anchor } from "./Popover";
export type SettingsMode = "columns" | "filter" | "sort" | "group" | "height";
const labels = {
  columns: "字段管理",
  filter: "筛选",
  sort: "排序",
  group: "分组",
  height: "行高",
};
export function ViewSettings({
  mode,
  anchor,
  fields,
  view,
  onSave,
  onClose,
  onFieldAction,
  initialFieldID,
}: {
  initialFieldID?: string;
  mode: SettingsMode;
  anchor: Anchor;
  fields: Field[];
  view: View;
  onSave: (v: View) => Promise<unknown>;
  onClose: () => void;
  onFieldAction?: (action: string, field: Field, anchor: Anchor) => void;
}) {
  const rowHeightId = useId();
  const [draft, setDraft] = useState(() => {
    const initial = structuredClone(view);
    const field = fields.find(field => field.id === initialFieldID);
    if (mode === "filter" && field && !KINDS[field.kind].system && !KINDS[field.kind].multiple && initial.filters.length < 20 && !initial.filters.some(filter => filter.field_id === initialFieldID)) initial.filters.push({ field_id: field.id, operator: "eq", value: null });
    return initial;
  }),
    [busy, setBusy] = useState(false);
  const sortable = fields.filter((f) => !KINDS[f.kind].multiple),
    filterable = sortable.filter((f) => !KINDS[f.kind].system);
  const choices = (items: Field[]) =>
    items.map((f) => ({ value: f.id, label: f.name }));
  async function save() {
    setBusy(true);
    try {
      await onSave(draft);
      onClose();
    } catch (e) {
      reportError(e);
    } finally {
      setBusy(false);
    }
  }
  if (mode === "columns") return <FieldManager fields={fields} view={view} anchor={anchor} onSave={onSave} onClose={onClose} onFieldAction={onFieldAction} />;
  const groupItems = [
              { value: "", label: "不分组" },
              ...choices(fields.filter((f) => f.kind === "select")),
            ];
  const sortFieldItems = choices(sortable);
  const sortDirectionItems = [
                    { value: "false", label: "升序" },
                    { value: "true", label: "降序" },
                  ];
  return (
    <Popover
      anchor={anchor}
      label={labels[mode]}
      onClose={() => {
        if (!busy) onClose();
      }}
      wide
    >
      <div className="flex flex-col gap-4 p-3 [&>strong]:text-base [&>strong]:font-semibold [&>p]:text-xs [&>p]:text-muted-foreground">
        <strong>{labels[mode]}</strong>
        {mode === "height" ? <RadioGroup aria-label="行高" value={String(draft.row_height)} disabled={busy} onValueChange={height => setDraft({ ...draft, row_height: Number(height) })}>
          {[32, 40, 64, 96].map((height, index) => <div key={height} className={sheetSettingRowClassName}>
            <RadioGroupItem id={`${rowHeightId}-${height}`} value={String(height)} />
            <label htmlFor={`${rowHeightId}-${height}`}>{["紧凑", "标准", "宽松", "超高"][index]}</label>
          </div>)}
        </RadioGroup> : null}
        {mode === "group" && (
          <label className="grid gap-2 text-sm font-medium"><span>{"按字段分组"}</span><Select
            value={draft.group_field_id}
            disabled={busy}
            onValueChange={group_field_id => { if (group_field_id === null) return; setDraft({ ...draft, group_field_id }); }}
            items={groupItems}
          >
            <SelectTrigger aria-label={"按字段分组"}><SelectValue /></SelectTrigger>
            <SelectContent>
              {groupItems.map(item => (
                <SelectItem key={item.value} value={item.value}>{item.label}</SelectItem>
              ))}
            </SelectContent>
          </Select></label>
        )}
        {mode === "sort" && (
          <>
            <p>依次按以下条件排序</p>
            {draft.sorts.map((sort, index) => (
              <div className={sheetSettingRowClassName} key={index}>
                <Select
                  value={sort.field_id}
                  disabled={busy}
                  onValueChange={field_id => { if (field_id === null) return; setDraft({
                                                          ...draft,
                                                          sorts: draft.sorts.map((s, i) =>
                                                            i === index ? { ...s, field_id } : s,
                                                          ),
                                                        }); }}
                  items={sortFieldItems}
                >
                  <SelectTrigger aria-label={`排序字段 ${index + 1}`} size="sm"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {sortFieldItems.map(item => (
                      <SelectItem key={item.value} value={item.value}>{item.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Select
                  value={String(sort.descending)}
                  disabled={busy}
                  onValueChange={v => { if (v === null) return; setDraft({
                                                          ...draft,
                                                          sorts: draft.sorts.map((s, i) =>
                                                            i === index ? { ...s, descending: v === "true" } : s,
                                                          ),
                                                        }); }}
                  items={sortDirectionItems}
                >
                  <SelectTrigger aria-label={`排序方向 ${index + 1}`} size="sm"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {sortDirectionItems.map(item => (
                      <SelectItem key={item.value} value={item.value}>{item.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Button className={`${sheetActionClassName} min-w-8`}
                  size="sm"
                  aria-label="移除排序"
                  disabled={busy}
                  onClick={() =>
                    setDraft({
                      ...draft,
                      sorts: draft.sorts.filter((_, i) => i !== index),
                    })
                  } variant="ghost"
                >
                  <Trash2 size={15} />
                </Button>
              </div>
            ))}
            <Button
              size="sm"
              variant="ghost"

              disabled={busy || !sortable.length || draft.sorts.length >= 8}
              onClick={() =>
                setDraft({
                  ...draft,
                  sorts: [
                    ...draft.sorts,
                    { field_id: sortable[0].id, descending: false },
                  ],
                })
              }
            ><Plus size={15} />
              添加排序条件
            </Button>
          </>
        )}
        {mode === "filter" && (
          <>
            <p>记录需要同时满足以下条件</p>
            {draft.filters.map((filter, index) => {
              const field = fields.find((f) => f.id === filter.field_id)!;
              const patch = (change: Partial<typeof filter>) =>
                setDraft({
                  ...draft,
                  filters: draft.filters.map((f, i) =>
                    i === index ? { ...f, ...change } : f,
                  ),
                });
              const operators = {
                eq: "等于",
                ne: "不等于",
                empty: "为空",
                not_empty: "不为空",
                ...(KINDS[field.kind].numeric
                  ? { gt: "大于", gte: "大于等于", lt: "小于", lte: "小于等于" }
                  : field.kind === "text"
                    ? { contains: "包含" }
                    : {}),
              };
              const filterFieldItems = choices(filterable);
  const filterOperatorItems = Object.entries(operators).map(
                        ([value, label]) => ({ value, label }),
                      );
  return (
                <div className="flex flex-col gap-2.5 border-b border-border pb-4 [&>div:first-child]:flex [&>div:first-child]:gap-2 [&>div>[data-slot=select-trigger]]:min-w-0 [&>div>[data-slot=select-trigger]]:flex-1" key={index}>
                  <div>
                    <Select
                      value={filter.field_id}
                      disabled={busy}
                      onValueChange={field_id => { if (field_id === null) return; patch({ field_id, value: null, operator: "eq" }); }}
                      items={filterFieldItems}
                    >
                      <SelectTrigger aria-label={`筛选字段 ${index + 1}`} size="sm"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {filterFieldItems.map(item => (
                          <SelectItem key={item.value} value={item.value}>{item.label}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <Select
                      value={filter.operator}
                      disabled={busy}
                      onValueChange={operator => { if (operator === null) return; patch({ operator }); }}
                      items={filterOperatorItems}
                    >
                      <SelectTrigger aria-label={`筛选条件 ${index + 1}`} size="sm"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {filterOperatorItems.map(item => (
                          <SelectItem key={item.value} value={item.value}>{item.label}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <Button className={sheetActionClassName}
                      size="sm"
                      aria-label="移除筛选"
                      disabled={busy}
                      onClick={() =>
                        setDraft({
                          ...draft,
                          filters: draft.filters.filter((_, i) => i !== index),
                        })
                      } variant="ghost"
                    >
                      <Trash2 size={15} />
                    </Button>
                  </div>
                  {!["empty", "not_empty"].includes(filter.operator) && (
                    <ValueEditor
                      field={field}
                      value={filter.value}
                      onChange={(value) => patch({ value })}
                    />
                  )}
                </div>
              );
            })}
            <Button
              size="sm"
              variant="ghost"

              disabled={
                busy || !filterable.length || draft.filters.length >= 20
              }
              onClick={() =>
                setDraft({
                  ...draft,
                  filters: [
                    ...draft.filters,
                    { field_id: filterable[0].id, operator: "eq", value: null },
                  ],
                })
              }
            ><Plus size={15} />
              添加筛选条件
            </Button>
          </>
        )}
        <footer className="flex justify-end gap-2 border-t border-border pt-4">
          <Button size="sm" disabled={busy} onClick={onClose}>
            取消
          </Button>
          <Button
            size="sm"
            variant="default"

            onClick={() => void save()} disabled={busy} aria-busy={busy || undefined}
          >{busy ? <Spinner aria-hidden="true" /> : null}
            应用
          </Button>
        </footer>
      </div>
    </Popover>
  );
}

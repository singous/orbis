import { sheetSettingRowClassName, sheetActionClassName } from "./sheet-chrome";
import { reportError } from "../../shared/api/request-feedback";
import { useState } from "react";
import { ActionButton } from "../../shared/ui/ActionButton";
import { Button } from "../../shared/ui/Button";
import { Plus, Trash2 } from "../../shared/ui/icons";
import { SelectField } from "../../shared/ui/SelectField";
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
  return (
    <Popover
      anchor={anchor}
      label={labels[mode]}
      onClose={() => {
        if (!busy) onClose();
      }}
      wide
    >
      <div className="flex flex-col gap-4 p-3 [&>strong]:text-[16px] [&>strong]:font-semibold [&>p]:text-[12px] [&>p]:text-(--ob-page-muted-foreground) [&>label]:flex [&>label]:flex-col [&>label]:gap-2 [&_input:not([type=checkbox],[type=radio])]:w-full [&_input:not([type=checkbox],[type=radio])]:min-w-0 [&_input:not([type=checkbox],[type=radio])]:min-h-(--ob-control-height-sm) [&_input:not([type=checkbox],[type=radio])]:rounded-[calc(var(--ob-radius)*2)] [&_input:not([type=checkbox],[type=radio])]:border [&_input:not([type=checkbox],[type=radio])]:border-ob-border [&_input:not([type=checkbox],[type=radio])]:bg-ob-card [&_input:not([type=checkbox],[type=radio])]:px-2.5 [&_input:not([type=checkbox],[type=radio])]:py-1.5 [&_input:not([type=checkbox],[type=radio])]:text-sm [&_input:not([type=checkbox],[type=radio])]:text-ob-foreground">
        <strong>{labels[mode]}</strong>
        {mode === "height" &&
          [32, 40, 64, 96].map((height, i) => (
            <label key={height} className={sheetSettingRowClassName}>
              <input
                type="radio"
                name="row-height"
                checked={draft.row_height === height}
                disabled={busy}
                onChange={() => setDraft({ ...draft, row_height: height })}
              />
              {["紧凑", "标准", "宽松", "超高"][i]}
            </label>
          ))}
        {mode === "group" && (
          <SelectField
            label="按字段分组"
            value={draft.group_field_id}
            options={[
              { value: "", label: "不分组" },
              ...choices(fields.filter((f) => f.kind === "select")),
            ]}
            disabled={busy}
            onChange={(group_field_id) =>
              setDraft({ ...draft, group_field_id })
            }
          />
        )}
        {mode === "sort" && (
          <>
            <p>依次按以下条件排序</p>
            {draft.sorts.map((sort, index) => (
              <div className={sheetSettingRowClassName} key={index}>
                <SelectField
                  density="compact"
                  aria-label={`排序字段 ${index + 1}`}
                  value={sort.field_id}
                  options={choices(sortable)}
                  disabled={busy}
                  onChange={(field_id) =>
                    setDraft({
                      ...draft,
                      sorts: draft.sorts.map((s, i) =>
                        i === index ? { ...s, field_id } : s,
                      ),
                    })
                  }
                />
                <SelectField
                  density="compact"
                  aria-label={`排序方向 ${index + 1}`}
                  value={String(sort.descending)}
                  options={[
                    { value: "false", label: "升序" },
                    { value: "true", label: "降序" },
                  ]}
                  disabled={busy}
                  onChange={(v) =>
                    setDraft({
                      ...draft,
                      sorts: draft.sorts.map((s, i) =>
                        i === index ? { ...s, descending: v === "true" } : s,
                      ),
                    })
                  }
                />
                <ActionButton className={`${sheetActionClassName} min-w-8`}
                  size="sm"
                  aria-label="移除排序"
                  disabled={busy}
                  onClick={() =>
                    setDraft({
                      ...draft,
                      sorts: draft.sorts.filter((_, i) => i !== index),
                    })
                  }
                >
                  <Trash2 size={15} />
                </ActionButton>
              </div>
            ))}
            <Button
              size="sm"
              variant="ghost"
              icon={<Plus size={15} />}
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
            >
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
              return (
                <div className="flex flex-col gap-2.5 border-b border-ob-border pb-4 [&>div:first-child]:flex [&>div:first-child]:gap-2 [&>div>.orbis-select-field]:min-w-0 [&>div>.orbis-select-field]:flex-1" key={index}>
                  <div>
                    <SelectField
                      density="compact"
                      aria-label={`筛选字段 ${index + 1}`}
                      value={filter.field_id}
                      options={choices(filterable)}
                      disabled={busy}
                      onChange={(field_id) =>
                        patch({ field_id, value: null, operator: "eq" })
                      }
                    />
                    <SelectField
                      density="compact"
                      aria-label={`筛选条件 ${index + 1}`}
                      value={filter.operator}
                      options={Object.entries(operators).map(
                        ([value, label]) => ({ value, label }),
                      )}
                      disabled={busy}
                      onChange={(operator) => patch({ operator })}
                    />
                    <ActionButton className={sheetActionClassName}
                      size="sm"
                      aria-label="移除筛选"
                      disabled={busy}
                      onClick={() =>
                        setDraft({
                          ...draft,
                          filters: draft.filters.filter((_, i) => i !== index),
                        })
                      }
                    >
                      <Trash2 size={15} />
                    </ActionButton>
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
              icon={<Plus size={15} />}
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
            >
              添加筛选条件
            </Button>
          </>
        )}
        <footer className="flex justify-end gap-2 border-t border-ob-border pt-4">
          <Button size="sm" disabled={busy} onClick={onClose}>
            取消
          </Button>
          <Button
            size="sm"
            variant="primary"
            isPending={busy}
            onClick={() => void save()}
          >
            应用
          </Button>
        </footer>
      </div>
    </Popover>
  );
}

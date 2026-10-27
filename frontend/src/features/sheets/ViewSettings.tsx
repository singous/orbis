import { reportError } from "../../shared/api/request-feedback";
import { useState } from "react";
import { ActionButton } from "../../shared/ui/ActionButton";
import { Button } from "../../shared/ui/Button";
import { ArrowDown, ArrowUp, Plus, Trash2 } from "../../shared/ui/icons";
import { SelectField } from "../../shared/ui/SelectField";
import { ValueEditor } from "./Cell";
import { FieldIcon } from "./FieldIcon";
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
}: {
  mode: SettingsMode;
  anchor: Anchor;
  fields: Field[];
  view: View;
  onSave: (v: View) => Promise<unknown>;
  onClose: () => void;
}) {
  const [draft, setDraft] = useState(structuredClone(view)),
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
  function move(id: string, delta: number) {
    const next = [...draft.field_ids],
      from = next.indexOf(id),
      to = from + delta;
    if (from < 0 || to < 0 || to >= next.length) return;
    [next[from], next[to]] = [next[to], next[from]];
    setDraft({ ...draft, field_ids: next });
  }
  return (
    <Popover
      anchor={anchor}
      label={labels[mode]}
      onClose={() => {
        if (!busy) onClose();
      }}
      wide
    >
      <div className="sheet-view-settings">
        <strong>{labels[mode]}</strong>
        {mode === "columns" &&
          [
            ...draft.field_ids.map((id) => fields.find((f) => f.id === id)!),
            ...fields.filter((f) => !draft.field_ids.includes(f.id)),
          ].map((f) => (
            <div className="sheet-setting-row" key={f.id}>
              <label>
                <input
                  type="checkbox"
                  disabled={busy}
                  checked={draft.field_ids.includes(f.id)}
                  onChange={(e) =>
                    setDraft({
                      ...draft,
                      field_ids: e.target.checked
                        ? [...draft.field_ids, f.id]
                        : draft.field_ids.filter((id) => id !== f.id),
                    })
                  }
                />
                <FieldIcon kind={f.kind} />
                {f.name}
              </label>
              <ActionButton
                size="sm"
                aria-label={`上移${f.name}`}
                disabled={busy}
                onClick={() => move(f.id, -1)}
              >
                <ArrowUp size={14} />
              </ActionButton>
              <ActionButton
                size="sm"
                aria-label={`下移${f.name}`}
                disabled={busy}
                onClick={() => move(f.id, 1)}
              >
                <ArrowDown size={14} />
              </ActionButton>
            </div>
          ))}
        {mode === "height" &&
          [32, 40, 64, 96].map((height, i) => (
            <label key={height} className="sheet-setting-row">
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
              <div className="sheet-setting-row" key={index}>
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
                <ActionButton
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
                <div className="sheet-filter-row" key={index}>
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
                    <ActionButton
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
        <footer>
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

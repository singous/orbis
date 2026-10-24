import { useState } from "react";
import { newUUID } from "../../shared/ids";
import { ActionButton } from "../../shared/ui/ActionButton";
import { Button } from "../../shared/ui/Button";
import { ArrowDown, ArrowUp, GripVertical, Plus, Trash2 } from "../../shared/ui/icons";
import { SelectField } from "../../shared/ui/SelectField";
import { showToast } from "../../shared/ui/Toast";
import { TextInput } from "../../shared/ui/TextInput";
import { ValueEditor } from "./Cell";
import { COLORS, KINDS, type Field, type Kind } from "./model";
import { Popover, type Anchor } from "./Popover";

const colorNames: Record<string, string> = {
  green: "绿色",
  amber: "黄色",
  blue: "蓝色",
  purple: "紫色",
  pink: "粉色",
  gray: "灰色",
};

export function FieldSettings({
  field,
  anchor,
  onSave,
  onClose,
}: {
  field: Field;
  anchor: Anchor;
  onSave: (field: Field) => Promise<unknown>;
  onClose: () => void;
}) {
  const [draft, setDraft] = useState(structuredClone(field)),
    [busy, setBusy] = useState(false);
  const hasOptions = draft.kind === "select" || draft.kind === "multi_select";
  function moveOption(from: number, to: number) {
    if (busy) return;
    setDraft(current => {
      if (from < 0 || to < 0 || from >= current.options.length || to >= current.options.length || from === to) return current;
      const options = [...current.options];
      options.splice(to, 0, options.splice(from, 1)[0]);
      return { ...current, options };
    });
  }
  async function save() {
    if (!draft.name.trim()) {
      showToast({ title: "无法保存字段", description: "请填写字段名称", tone: "danger" });
      return;
    }
    setBusy(true);
    try {
      await onSave({ ...draft, options: hasOptions ? draft.options : [] });
      onClose();
    } catch (e) {
      showToast({ title: "无法保存字段", description: e instanceof Error ? e.message : String(e), tone: "danger" });
    } finally {
      setBusy(false);
    }
  }
  return (
    <Popover
      anchor={anchor}
      label="字段设置"
      wide
      className="sheet-field-popover"
      onClose={() => {
        if (!busy) onClose();
      }}
    >
      <h3>字段设置</h3>
      <div className="sheet-field-form">
        <TextInput
          label="字段名称"
          aria-label="字段名称"
          value={draft.name}
          maxLength={120}
          disabled={busy}
          onChange={(e) => setDraft({ ...draft, name: e.target.value })}
        />
        <SelectField
          label="字段类型"
          value={draft.kind}
          options={Object.entries(KINDS).map(([value, info]) => ({
            value,
            label: info.label,
          }))}
          disabled={busy}
          onChange={(kind) =>
            setDraft({ ...draft, kind: kind as Kind, default: null })
          }
        />
        {hasOptions && (
          <section className="sheet-field-options">
            <div className="sheet-section-label">
              <span>选项</span>
              <span className="sheet-muted">拖动或使用箭头调整顺序</span>
            </div>
            {draft.options.map((option, index) => (
              <div
                className="sheet-option-edit"
                key={option.id}
                draggable={!busy}
                onDragStart={(event) =>
                  event.dataTransfer.setData(
                    "application/orbis-field-option",
                    String(index),
                  )
                }
                onDragOver={(event) => event.preventDefault()}
                onDrop={(event) => {
                  const raw = event.dataTransfer.getData(
                      "application/orbis-field-option",
                    ),
                    from = Number(raw);
                  if (
                    !raw ||
                    !Number.isInteger(from) ||
                    from < 0 ||
                    from >= draft.options.length
                  )
                    return;
                  event.preventDefault();
                  moveOption(from, index);
                }}
              >
                <GripVertical size={16} />
                <TextInput
                  aria-label={`选项 ${index + 1}`}
                  value={option.label}
                  disabled={busy}
                  onChange={(e) =>
                    setDraft({
                      ...draft,
                      options: draft.options.map((o) =>
                        o.id === option.id
                          ? { ...o, label: e.target.value }
                          : o,
                      ),
                    })
                  }
                />
                <SelectField
                  density="compact"
                  aria-label={`选项 ${index + 1} 颜色`}
                  value={option.color || "gray"}
                  options={COLORS.map((value) => ({
                    value,
                    label: colorNames[value],
                  }))}
                  disabled={busy}
                  onChange={(color) =>
                    setDraft({
                      ...draft,
                      options: draft.options.map((o) =>
                        o.id === option.id ? { ...o, color } : o,
                      ),
                    })
                  }
                />
                <div className="sheet-option-actions" role="group" aria-label={`选项 ${index + 1} 操作`}>
                  <ActionButton size="sm" aria-label={`上移选项 ${index + 1} ${option.label}`} disabled={busy || index === 0} onClick={() => moveOption(index, index - 1)}><ArrowUp size={15} /></ActionButton>
                  <ActionButton size="sm" aria-label={`下移选项 ${index + 1} ${option.label}`} disabled={busy || index === draft.options.length - 1} onClick={() => moveOption(index, index + 1)}><ArrowDown size={15} /></ActionButton>
                  <ActionButton
                    size="sm"
                    aria-label={`删除选项 ${index + 1}`}
                    disabled={busy}
                    onClick={() =>
                      setDraft({
                        ...draft,
                        options: draft.options.filter((o) => o.id !== option.id),
                      })
                    }
                  >
                    <Trash2 size={15} />
                  </ActionButton>
                </div>
              </div>
            ))}
            <Button
              size="sm"
              variant="ghost"
              icon={<Plus size={15} />}
              disabled={busy || draft.options.length >= 100}
              onClick={() =>
                setDraft({
                  ...draft,
                  options: [
                    ...draft.options,
                    {
                      id: newUUID(),
                      label: "新选项",
                      color: COLORS[draft.options.length % COLORS.length],
                    },
                  ],
                })
              }
            >
              添加选项
            </Button>
          </section>
        )}
        {draft.kind === "datetime" && (
          <>
            <SelectField
              label="日期格式"
              value={draft.date_format ?? "YYYY-MM-DD"}
              options={[
                { value: "YYYY-MM-DD", label: "2026-10-22" },
                { value: "YYYY/MM/DD", label: "2026/10/22" },
              ]}
              disabled={busy}
              onChange={(date_format) => setDraft({ ...draft, date_format })}
            />
            <label className="sheet-check">
              <input
                type="checkbox"
                checked={draft.include_time ?? false}
                disabled={busy}
                onChange={(e) =>
                  setDraft({ ...draft, include_time: e.target.checked })
                }
              />
              包含时间
            </label>
          </>
        )}
        {!KINDS[draft.kind].system && !KINDS[draft.kind].multiple && (
          <label className="sheet-default-field">
            <span>默认值</span>
            <ValueEditor
              field={draft}
              value={draft.default}
              onChange={(value) => setDraft({ ...draft, default: value })}
            />
          </label>
        )}
      </div>
      <div className="sheet-field-actions">
        <Button disabled={busy} onClick={onClose}>
          取消
        </Button>
        <Button variant="primary" isPending={busy} onClick={() => void save()}>
          保存字段
        </Button>
      </div>
    </Popover>
  );
}

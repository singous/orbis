import { useEffect, useRef, useState } from "react";
import { cellText, type CellValue, type TableField } from "./model";

const UTC8_MS = 8 * 60 * 60 * 1000;
function inputText(field: TableField, value: CellValue | undefined) {
  if (value == null) return "";
  return field.kind === "datetime"
    ? new Date(Number(value) + UTC8_MS).toISOString().slice(0, 16)
    : String(value);
}
export function CellEditor({
  field,
  value,
  readOnly,
  onChange,
  onCommit,
}: {
  field: TableField;
  value: CellValue | undefined;
  readOnly: boolean;
  onChange: (value: CellValue) => void;
  onCommit: () => void;
}) {
  const [text, setText] = useState(() => inputText(field, value));
  const focused = useRef(false);
  useEffect(() => {
    if (!focused.current) setText(inputText(field, value));
  }, [field.kind, value]);
  if (readOnly)
    return (
      <span className="dt-cell-value">{cellText(field, value) || "—"}</span>
    );
  if (field.kind === "checkbox")
    return (
      <input
        type="checkbox"
        aria-label={field.name}
        checked={Boolean(value)}
        onChange={(event) => {
          onChange(event.target.checked);
        }}
        onBlur={onCommit}
      />
    );
  if (field.kind === "select")
    return (
      <select
        aria-label={field.name}
        value={String(value ?? "")}
        onChange={(event) => onChange(event.target.value || null)}
        onBlur={onCommit}
      >
        <option value="">未选择</option>
        {field.options.map((option) => (
          <option key={option.id} value={option.id}>
            {option.label}
          </option>
        ))}
      </select>
    );
  if (field.kind === "multi_select")
    return (
      <details className="dt-multi">
        <summary aria-label={field.name}>
          {cellText(field, value) || "选择标签"}
        </summary>
        <div className="dt-multi-options">
          {field.options.map((option) => (
            <label key={option.id}>
              <input
                type="checkbox"
                checked={Array.isArray(value) && value.includes(option.id)}
                onChange={(event) => {
                  const next = new Set(Array.isArray(value) ? value : []);
                  if (event.target.checked) next.add(option.id);
                  else next.delete(option.id);
                  onChange([...next]);
                }}
              />
              {option.label}
            </label>
          ))}
          <button
            type="button"
            onClick={(event) => {
              onCommit();
              event.currentTarget.closest("details")?.removeAttribute("open");
            }}
          >
            完成
          </button>
        </div>
      </details>
    );
  return (
    <input
      aria-label={field.name}
      type={
        field.kind === "datetime"
          ? "datetime-local"
          : field.kind === "number"
            ? "number"
            : field.kind === "url"
              ? "url"
              : "text"
      }
      value={text}
      maxLength={8192}
      onFocus={() => {
        focused.current = true;
      }}
      onBlur={() => {
        focused.current = false;
        onCommit();
      }}
      onChange={(event) => {
        const raw = event.target.value;
        setText(raw);
        if (!raw) onChange(null);
        else if (field.kind === "number") {
          const number = Number(raw);
          if (Number.isFinite(number)) onChange(number);
        } else if (field.kind === "datetime") {
          const date = new Date(raw + "+08:00").getTime();
          if (Number.isFinite(date)) onChange(date);
        } else onChange(raw);
      }}
      onKeyDown={(event) => {
        if (event.key === "Enter" && !event.nativeEvent.isComposing) {
          event.preventDefault();
          onCommit();
          const cell = event.currentTarget.closest<HTMLElement>(
            "[data-row][data-column]",
          );
          if (cell)
            cell
              .closest("[role=grid]")
              ?.querySelector<HTMLInputElement>(
                `[data-row="${Number(cell.dataset.row) + 1}"][data-column="${cell.dataset.column}"] input`,
              )
              ?.focus();
        }
      }}
    />
  );
}

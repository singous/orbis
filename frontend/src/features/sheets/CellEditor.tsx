import "./grid.css";
import { cn } from "@orbis/ui/cn";
import { sheetActionClassName, sheetMutedClassName } from "./sheet-chrome";
import { reportError } from "../../shared/api/request-feedback";
import {
  CalendarDays,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Plus,
} from "@orbis/ui/icons";
import { useLayoutEffect, useRef, useState } from "react";
import type { AuthRequestOptions } from "../../shared/auth/use-auth-request";
import { Button } from "@orbis/ui/button";
import { CellValue, PersonChip, ValueEditor } from "./Cell";
import { KINDS, type Field, type Value } from "./model";
import { Popover, anchorAt, type Anchor } from "./Popover";

const BUSINESS_TIMEZONE_OFFSET_MS = 8 * 60 * 60 * 1000;

export type CellNavigation = "next" | "previous" | "down" | "up";
export function CellEditor({
  field,
  value,
  initial,
  auth,
  onChange,
  onCommit,
  onCancel,
  onCreateOption,
}: {
  field: Field;
  value: Value;
  initial?: string;
  auth: AuthRequestOptions;
  onChange: (value: Value) => void;
  onCommit: (value?: Value, navigation?: CellNavigation) => Promise<boolean>;
  onCancel: () => void;
  onCreateOption?: (label: string) => Promise<string>;
}) {
  const host = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement | HTMLTextAreaElement>(null);
  const choosing = [
    "select",
    "multi_select",
    "person",
    "datetime",
    "attachment",
    "image",
  ].includes(field.kind);
  const [anchor, setAnchor] = useState<Anchor | null>(null);
  const [search, setSearch] = useState(initial ?? ""),
    [creating, setCreating] = useState(false);
  useLayoutEffect(() => {
    if (choosing) setAnchor(anchorAt(host.current!));
    else {
      input.current?.focus();
      if (initial === undefined) input.current?.select();
    }
  }, []);
  const commit = (next?: Value, navigation?: CellNavigation) =>
    onCommit(next, navigation);
  function key(event: React.KeyboardEvent) {
    if (event.nativeEvent.isComposing) return;
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      onCancel();
    }
    if (event.key === "Enter" && event.shiftKey && field.kind === "text")
      return;
    if (event.key === "Enter" || event.key === "Tab") {
      event.preventDefault();
      event.stopPropagation();
      void commit(
        undefined,
        event.key === "Tab"
          ? event.shiftKey
            ? "previous"
            : "next"
          : event.shiftKey
            ? "up"
            : "down",
      );
    }
  }
  const options = field.options.filter((option) =>
    option.label.toLocaleLowerCase().includes(search.toLocaleLowerCase()),
  );
  const multiple = field.kind === "multi_select" || field.kind === "person";
  function choose(id: string) {
    if (!multiple) {
      void commit(id || null);
      return;
    }
    const ids = new Set(Array.isArray(value) ? value : []);
    if (ids.has(id)) ids.delete(id);
    else ids.add(id);
    onChange([...ids]);
  }
  return (
    <div
      className="sheet-inline-editor"
      ref={host}
      onPointerDown={(e) => e.stopPropagation()}
      onKeyDown={key}
    >
      {choosing ? (
        <>
          <div className="sheet-inline-value">
            <CellValue field={field} value={value} />
            {value == null && (
              <span className={sheetMutedClassName}>
                {field.kind === "datetime" ? "请选择日期" : "请选择"}
              </span>
            )}
          </div>
          <button
            className="sheet-cell-picker rounded-[4px] border-0 border-current bg-transparent text-(--muted-foreground) hover:bg-(--accent) focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring"
            aria-label={`选择${field.name}`}
            onClick={() => setAnchor(anchorAt(host.current!))}
          >
            {field.kind === "datetime" ? (
              <CalendarDays size={15} />
            ) : (
              <ChevronDown size={14} />
            )}
          </button>
        </>
      ) : (
        <>
          {field.kind === "text" ? (
            <textarea
              ref={(node) => {
                input.current = node;
              }}
              rows={1}
              className="sheet-inline-input"
              aria-label={field.name}
              value={String(value ?? "")}
              onChange={(e) => onChange(e.target.value)}
              onBlur={() => void commit()}
            />
          ) : (
            <input
              ref={(node) => {
                input.current = node;
              }}
              className="sheet-inline-input"
              aria-label={field.name}
              value={String(value ?? "")}
              inputMode={KINDS[field.kind].numeric ? "decimal" : undefined}
              onChange={(e) => onChange(e.target.value)}
              onBlur={() => void commit()}
            />
          )}
        </>
      )}
      {anchor && choosing && (
        <Popover
          anchor={anchor}
          anchorElement={host.current}
          onEscape={onCancel}
          onTab={(backward) => {
            void commit(undefined, backward ? "previous" : "next");
          }}
          label={`${field.name}选择`}
          className="sheet-cell-picker-popover w-75 p-2.5 animate-none pointer-coarse:w-90"
          onClose={() => {
            if (!creating) void commit();
          }}
        >
          {field.kind === "datetime" ? (
            <DatePicker
              value={typeof value === "number" ? value : null}
              includeTime={field.include_time}
              onChoose={(next) => void commit(next)}
            />
          ) : ["attachment", "image"].includes(field.kind) ? (
            <ValueEditor
              field={field}
              value={value}
              auth={auth}
              onChange={onChange}
            />
          ) : (
            <>
              <input
                autoFocus
                className="mb-1.5 w-full min-h-(--ob-control-height-lg) border-0 border-b border-current border-b-border bg-transparent p-2 text-foreground outline-none focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring pointer-coarse:min-h-(--ob-control-height-touch)"
                aria-label={`搜索${field.name}选项`}
                placeholder={onCreateOption ? "可搜索或新建选项" : "搜索选项"}
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                onKeyDown={(e) => {
                  if (e.nativeEvent.isComposing) return;
                  if (e.key === "Enter" && options[0]) {
                    e.preventDefault();
                    choose(options[0].id);
                  }
                  if (e.key === "ArrowDown") {
                    e.preventDefault();
                    e.currentTarget.parentElement
                      ?.querySelector<HTMLButtonElement>('[role="option"]')
                      ?.focus();
                  }
                }}
              />
              <div
                className="max-h-60 overflow-auto"
                role="listbox"
                aria-label={`${field.name}选项`}
                aria-multiselectable={multiple || undefined}
                onKeyDown={(e) => {
                  if (!["ArrowDown", "ArrowUp"].includes(e.key)) return;
                  e.preventDefault();
                  const buttons = Array.from(
                    e.currentTarget.querySelectorAll<HTMLButtonElement>(
                      '[role="option"]',
                    ),
                  );
                  const index = buttons.indexOf(
                    document.activeElement as HTMLButtonElement,
                  );
                  buttons[
                    (index +
                      (e.key === "ArrowDown" ? 1 : -1) +
                      buttons.length) %
                      buttons.length
                  ]?.focus();
                }}
              >
                {options.map((option) => {
                  const selected = multiple
                    ? Array.isArray(value) && value.includes(option.id)
                    : value === option.id;
                  return (
                    <button
                      className="flex min-h-(--ob-control-height-md) w-full items-center justify-between rounded-md px-[9px] py-1.5 hover:bg-(--accent) focus-visible:bg-(--accent) focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring pointer-coarse:min-h-(--ob-control-height-touch)"
                      role="option"
                      aria-selected={selected}
                      key={option.id}
                      onClick={() => choose(option.id)}
                    >
                      {field.kind === "person" ? (
                        <PersonChip id={option.id} label={option.label} />
                      ) : (
                        <span
                          className="sheet-tag"
                          style={{
                            background: `var(--sheet-${option.color})`,
                            color: `var(--sheet-ink-${option.color}, var(--foreground))`,
                          }}
                        >
                          {option.label}
                        </span>
                      )}
                      {selected && <Check size={14} />}
                    </button>
                  );
                })}
                {!options.length && (
                  <p className={sheetMutedClassName}>没有匹配的选项</p>
                )}
              </div>
              {onCreateOption &&
                search.trim() &&
                !field.options.some((o) => o.label === search.trim()) && (
                  <Button className={sheetActionClassName}
                    size="sm"
                    disabled={creating}
                    onClick={async () => {
                      setCreating(true);

                      try {
                        const id = await onCreateOption(search.trim());
                        setSearch("");
                        choose(id);
                      } catch (e) { reportError(e);
                      } finally {
                        setCreating(false);
                      }
                    }} variant="ghost"
                  >
                    <Plus size={14} />
                    新建选项「{search.trim()}」
                  </Button>
                )}
              {value != null && (
                <Button className={sheetActionClassName} size="sm" onClick={() => void commit(null)} variant="ghost">
                  清空
                </Button>
              )}

            </>
          )}
        </Popover>
      )}
    </div>
  );
}

function DatePicker({
  value,
  includeTime,
  onChoose,
}: {
  value: number | null;
  includeTime?: boolean;
  onChoose: (value: Value) => void;
}) {
  const current = new Date((value ?? Date.now()) + BUSINESS_TIMEZONE_OFFSET_MS);
  const [month, setMonth] = useState(
    () =>
      new Date(Date.UTC(current.getUTCFullYear(), current.getUTCMonth(), 1)),
  );
  const [time, setTime] = useState(current.toISOString().slice(11, 16));
  const year = month.getUTCFullYear(),
    index = month.getUTCMonth();
  const offset = (month.getUTCDay() + 6) % 7;
  const days = Array.from(
    { length: 42 },
    (_, i) => new Date(Date.UTC(year, index, i - offset + 1)),
  );
  function pick(day: Date) {
    onChoose(
      Date.parse(
        `${day.toISOString().slice(0, 10)}T${includeTime ? time : "00:00"}:00+08:00`,
      ),
    );
  }
  return (
    <div className="sheet-date-picker">
      <header className="flex items-center justify-between p-1">
        <Button className={cn(sheetActionClassName, "min-w-8")}
          size="sm"
          aria-label="上个月"
          onClick={() => setMonth(new Date(Date.UTC(year, index - 1, 1)))} variant="ghost"
        >
          <ChevronLeft size={16} />
        </Button>
        <strong>
          {year} 年 {index + 1} 月
        </strong>
        <Button className={cn(sheetActionClassName, "min-w-8")}
          size="sm"
          aria-label="下个月"
          onClick={() => setMonth(new Date(Date.UTC(year, index + 1, 1)))} variant="ghost"
        >
          <ChevronRight size={16} />
        </Button>
      </header>
      <div className="grid grid-cols-7 gap-[3px] text-center">
        {["一", "二", "三", "四", "五", "六", "日"].map((day) => (
          <span className="py-2.5 text-(--muted-foreground)" key={day}>{day}</span>
        ))}
        {days.map((day) => (
          <button
            key={day.toISOString()}
            aria-label={day.toISOString().slice(0, 10)}
            aria-pressed={
              value != null &&
              day.toISOString().slice(0, 10) ===
                current.toISOString().slice(0, 10)
            }
            className={cn("h-(--ob-control-height-sm) rounded-md hover:bg-(--accent) aria-pressed:bg-primary aria-pressed:text-primary-foreground focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring pointer-coarse:h-(--ob-control-height-touch)", day.getUTCMonth() !== index && "text-[12px] text-(--muted-foreground)")}
            onClick={() => pick(day)}
          >
            {day.getUTCDate()}
          </button>
        ))}
      </div>
      {includeTime && (
        <input
          type="time"
          aria-label="时间"
          value={time}
          onChange={(e) => setTime(e.target.value || "00:00")}
        />
      )}
      <footer className="mt-2 flex items-center justify-between border-t border-t-border p-1">
        <Button className={sheetActionClassName}
          size="sm"
          onClick={() =>
            pick(new Date(Date.now() + BUSINESS_TIMEZONE_OFFSET_MS))
          } variant="ghost"
        >
          今天
        </Button>
        <Button className={sheetActionClassName} size="sm" onClick={() => onChoose(null)} variant="ghost">
          清空日期
        </Button>
      </footer>
    </div>
  );
}

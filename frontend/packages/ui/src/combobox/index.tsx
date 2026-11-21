import { Combobox as Primitive } from "@base-ui/react/combobox";
import { Check, ChevronDown, Search, X } from "lucide-react";
import { Fragment, useContext, useMemo, useRef, useState, type ComponentProps, type KeyboardEvent, type ReactElement, type ReactNode } from "react";
import { Button } from "../button";
import { InputGroup, InputGroupAddon, InputGroupInput } from "../input-group";
import { useOverlayScope } from "../internal/overlay-scope";
import type { ControlSize } from "../internal/control-size";
import { PickerSizeContext, pickerSizeStyles } from "../internal/picker-styles";
import { Input } from "../input";
import { cn } from "../cn";
import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectSeparator, SelectTrigger, SelectValue } from "../select";
import { Spinner } from "../spinner";

const ComboboxRoot = Primitive.Root;

function ComboboxInput({ className, ...props }: Primitive.Input.Props) {
  return <Primitive.Input render={<Input className={cn("h-9 rounded-lg pointer-coarse:min-h-11", className)} />} {...props} />;
}

function ComboboxList({ className, ...props }: Primitive.List.Props) {
  return <Primitive.List data-slot="combobox-list" className={cn("max-h-60 min-w-0 overflow-auto overscroll-contain p-0.5", className)} {...props} />;
}

function ComboboxItem({ className, children, ...props }: Primitive.Item.Props) {
  const size = useContext(PickerSizeContext);
  return (
    <Primitive.Item
      data-slot="combobox-item"
      className={cn(
        "flex min-w-0 items-center rounded-lg select-none pointer-coarse:min-h-11",
        pickerSizeStyles[size].option,
        "data-highlighted:bg-accent data-highlighted:text-accent-foreground forced-colors:data-highlighted:outline-2 forced-colors:data-highlighted:outline-solid forced-colors:data-highlighted:-outline-offset-2 forced-colors:data-highlighted:outline-ring",
        "data-disabled:opacity-50",
        className,
      )}
      {...props}
    >
      {children}
      <Primitive.ItemIndicator className="ms-auto shrink-0">
        <Check className={pickerSizeStyles[size].icon} aria-hidden="true" />
      </Primitive.ItemIndicator>
    </Primitive.Item>
  );
}

function ComboboxEmpty({ className, ...props }: Primitive.Empty.Props) {
  const size = useContext(PickerSizeContext);
  return <Primitive.Empty className={cn("px-2.5 py-3 text-center text-muted-foreground empty:hidden", pickerSizeStyles[size].caption, className)} {...props} />;
}

function ComboboxContent({
  className, anchor, side = "bottom", align = "start", sideOffset = 6, size = "default", initialFocus = false, children, ...props
}: Primitive.Popup.Props & Pick<Primitive.Positioner.Props, "anchor" | "side" | "align" | "sideOffset"> & { size?: ControlSize }) {
  const scope = useOverlayScope();
  return (
    <Primitive.Portal {...scope}>
      <Primitive.Positioner anchor={anchor} side={side} align={align} sideOffset={sideOffset} className="isolate z-50">
        <Primitive.Popup
          {...props}
          initialFocus={initialFocus}
          data-slot="combobox-content"
          data-size={size}
          className={cn("grid max-h-(--available-height) w-(--anchor-width) min-w-0 max-w-(--available-width) grid-rows-[auto_minmax(0,1fr)] overflow-hidden rounded-xl bg-popover text-popover-foreground shadow-lg", pickerSizeStyles[size].panel, className)}
        >
          <PickerSizeContext.Provider value={size}>{children}</PickerSizeContext.Provider>
        </Primitive.Popup>
      </Primitive.Positioner>
    </Primitive.Portal>
  );
}

function ComboboxTrigger({ className, children, size = "default", ...props }: Primitive.Trigger.Props & { size?: ControlSize }) {
  return (
    <Primitive.Trigger
      {...props}
      data-slot="combobox-trigger"
      data-size={size}
      className={cn("focus-ring flex w-full min-w-0 items-center justify-between rounded-lg border-0 bg-muted text-start disabled:opacity-50", pickerSizeStyles[size].trigger, className)}
    >
      {children}
      <Primitive.Icon aria-hidden="true" className={cn("shrink-0 text-muted-foreground transition-transform data-popup-open:rotate-180", pickerSizeStyles[size].icon)}>
        <ChevronDown className="size-full" />
      </Primitive.Icon>
    </Primitive.Trigger>
  );
}

function ComboboxSearch({ className, loading, ...props }: Omit<Primitive.Input.Props, "render"> & { loading?: boolean }) {
  const size = useContext(PickerSizeContext);
  const scale = pickerSizeStyles[size];
  return (
    <InputGroup className={cn("border-transparent bg-muted", scale.searchGroup)}>
      <InputGroupAddon aria-hidden="true"><Search className={scale.icon} /></InputGroupAddon>
      <Primitive.Input {...props} render={<InputGroupInput className={cn("pointer-coarse:min-h-11", scale.field, className)} />} />
      {loading ? <InputGroupAddon><Spinner className={scale.icon} aria-label="正在搜索" /></InputGroupAddon> : null}
    </InputGroup>
  );
}

function ComboboxGroup({ className, ...props }: Primitive.Group.Props) {
  const size = useContext(PickerSizeContext);
  return <Primitive.Group {...props} data-slot="combobox-group" className={cn("grid min-w-0 [&+&]:border-t [&+&]:border-border [&+&]:pt-2", pickerSizeStyles[size].group, className)} />;
}

function ComboboxGroupLabel({ className, ...props }: Primitive.GroupLabel.Props) {
  const size = useContext(PickerSizeContext);
  return <Primitive.GroupLabel {...props} data-slot="combobox-group-label" className={cn("py-1 font-medium text-muted-foreground", pickerSizeStyles[size].label, className)} />;
}

type PickerValue = string | number;
type PickerOption<Value extends PickerValue> = { value: Value; label: string };
type PickerGroup<Value extends PickerValue> = { label: string; items: readonly PickerOption<Value>[] };
type PickerItems<Value extends PickerValue> = readonly PickerOption<Value>[] | readonly PickerGroup<Value>[];

type LocalSearch = {
  mode: "local";
  placement?: "trigger" | "popup";
  placeholder?: string;
  query?: string;
  onQueryChange?: (query: string) => void;
};

type RemoteSearch<Value extends PickerValue> = {
  mode: "remote";
  placeholder?: string;
  query: string;
  onQueryChange: (query: string) => void;
  results?: PickerItems<Value>;
  loading?: boolean;
  error?: string;
};

type ComboboxProps<Value extends PickerValue> = {
  items: PickerItems<Value>;
  label: string;
  id?: string;
  name?: string;
  size?: ControlSize;
  "aria-describedby"?: string;
  className?: string;
  triggerIcon?: ReactNode;
  renderTrigger?: (element: ReactElement) => ReactElement;
  displayValue?: ReactNode;
  popupProps?: Pick<ComponentProps<typeof SelectContent>, "role" | "aria-label" | "align" | "alignItemWithTrigger" | "className">;
  placeholder?: string;
  emptyText?: string;
  search?: LocalSearch | RemoteSearch<Value>;
  disabled?: boolean;
  readOnly?: boolean;
  required?: boolean;
} & (
  | { multiple?: false; value?: Value | null; defaultValue?: Value | null; onValueChange?: (value: Value | null) => void }
  | { multiple: true; selectionDisplay?: "tags" | "text"; value?: readonly Value[] | null; defaultValue?: readonly Value[] | null; onValueChange?: (value: Value[]) => void }
);

function flatten<Value extends PickerValue>(items: PickerItems<Value>) {
  return items.flatMap(entry => "items" in entry ? entry.items : [entry]);
}

function PickerOptions<Value extends PickerValue>({ label, emptyText, loading, error }: {
  label: string; emptyText: string; loading?: boolean; error?: string;
}) {
  const size = useContext(PickerSizeContext);
  const scale = pickerSizeStyles[size];
  function option(item: PickerOption<Value>) {
    return <ComboboxItem key={JSON.stringify(item.value)} value={item.value}><span className="min-w-0 flex-1 truncate">{item.label}</span></ComboboxItem>;
  }
  return (
    <div className="min-h-0 overflow-auto" aria-busy={loading || undefined}>
      {error ? <p role="alert" className={cn("px-2.5 py-2 text-destructive", scale.caption)}>{error}</p>
        : !loading ? <ComboboxEmpty>{emptyText}</ComboboxEmpty> : null}
      <ComboboxList aria-label={label} className={cn("grid max-h-none", scale.list)}>
        {(entry: PickerOption<Value> | PickerGroup<Value>) => "items" in entry ? (
          <ComboboxGroup key={entry.label} items={entry.items}>
            <ComboboxGroupLabel>{entry.label}</ComboboxGroupLabel>
            <Primitive.Collection>{option}</Primitive.Collection>
          </ComboboxGroup>
        ) : option(entry)}
      </ComboboxList>
    </div>
  );
}

function SelectionTags<Value extends PickerValue>({ values, labels, disabled, onRemove, size }: {
  values: readonly Value[];
  labels: ReadonlyMap<Value, string>;
  disabled: boolean;
  onRemove: (value: Value) => void;
  size: ControlSize;
}) {
  const scale = pickerSizeStyles[size];
  return (
    <div role="group" aria-label="已选选项" className={cn("flex min-w-0 flex-1 flex-wrap items-center", scale.tags)}>
      {values.map(value => {
        const label = labels.get(value) ?? String(value);
        return (
          <span key={JSON.stringify(value)} className={cn("flex min-w-0 max-w-full items-center rounded-md bg-card", scale.tag)}>
            <span className="truncate">{label}</span>
            <Button type="button" variant="ghost" size={scale.tagButton} className="shrink-0" aria-label={`移除 ${label}`} disabled={disabled} onClick={() => onRemove(value)}>
              <X aria-hidden="true" />
            </Button>
          </span>
        );
      })}
    </div>
  );
}

function Combobox<Value extends PickerValue>(props: ComboboxProps<Value>) {
  const {
    items, label, id, className, placeholder = "请选择", emptyText = "没有匹配的选项",
    multiple = false, name, size = "default", disabled, readOnly, required, search, triggerIcon, displayValue, popupProps,
  } = props;
  const scale = pickerSizeStyles[size];
  const [draft, setDraft] = useState<Value | readonly Value[] | null>(() => props.defaultValue ?? null);
  const control = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const popupActions = useRef<Primitive.Root.Actions>(null);
  const selection = props.value === undefined ? draft : props.value;
  const single = typeof selection === "string" || typeof selection === "number" ? selection : null;
  const selected = Array.isArray(selection) ? selection : [];
  const value = multiple ? selected : single;
  const useTags = props.multiple && props.selectionDisplay !== "text";
  const inputInTrigger = search?.mode === "local" && search.placement !== "popup";
  const remote = search?.mode === "remote" ? search : undefined;
  const options = useMemo(() => flatten(items), [items]);
  const labels = useMemo(() => new Map(options.map(item => [item.value, item.label])), [options]);
  const collection = useMemo(() => Primitive.createItems<PickerOption<Value>, Value>(items, {
    getValue: item => item.value,
    getLabel: item => item.label,
  }), [items]);
  const searchPlaceholder = search?.placeholder ?? "搜索选项…";
  const triggerAccessibility = { id, "aria-label": label, "aria-describedby": props["aria-describedby"] };
  const { alignItemWithTrigger = false, className: popupClassName, ...popupAttributes } = popupProps ?? {};
  const popupLabel = popupAttributes["aria-label"] ?? label;
  const icon = triggerIcon != null ? (
    <span aria-hidden="true" className={cn("inline-flex shrink-0 items-center justify-center [&>svg]:size-full", scale.icon)}>{triggerIcon}</span>
  ) : null;

  function updateSelection(next: Value | Value[] | null) {
    if (props.value === undefined) setDraft(next);
    if (props.multiple) props.onValueChange?.(Array.isArray(next) ? next : []);
    else if (!Array.isArray(next)) props.onValueChange?.(next);
  }

  function updateTags(next: Value[]) {
    (inputInTrigger ? input.current : trigger.current)?.focus();
    updateSelection(next);
  }

  function closePopupFromTrigger(event: KeyboardEvent<HTMLButtonElement>) {
    if (event.key !== "Escape" || event.nativeEvent.isComposing || event.currentTarget.getAttribute("aria-expanded") !== "true") return;
    // 焦点留在触发按钮时，先关闭下拉，再让后续 Escape 交给外层弹窗。
    event.preventDefault();
    event.stopPropagation();
    popupActions.current?.close();
  }

  const tags = useTags && selected.length ? (
    <SelectionTags values={selected} labels={labels} size={size} disabled={!!(disabled || readOnly)} onRemove={id => updateTags(selected.filter(value => value !== id))} />
  ) : null;
  const clear = useTags && selected.length ? (
    <Button type="button" variant="ghost" size={scale.clearButton} className="shrink-0" aria-label="清空已选选项" disabled={disabled || readOnly} onClick={() => updateTags([])}><X aria-hidden="true" /></Button>
  ) : null;
  const controlClass = cn("flex min-w-0 items-center gap-1 rounded-lg bg-muted", scale.control, className);
  const renderTrigger = props.renderTrigger ?? ((element: ReactElement) => element);
  const compactTriggerClass = cn("shrink-0 justify-center bg-transparent p-0 hover:bg-accent", scale.compactTrigger);

  if (!search) {
    function option(item: PickerOption<Value>) {
      return <SelectItem key={JSON.stringify(item.value)} value={item.value}>{item.label}</SelectItem>;
    }
    return (
      <Select<Value, boolean> items={options} value={value} multiple={multiple} onValueChange={updateSelection} name={name} disabled={disabled} readOnly={readOnly} required={required}>
        {useTags ? (
          <div ref={control} className={controlClass}>
            {tags ?? <span className={cn("min-w-0 flex-1 truncate px-1 text-muted-foreground", scale.text)}>{placeholder}</span>}
            {clear}
            {renderTrigger(<SelectTrigger {...triggerAccessibility} ref={trigger} size={size} className={compactTriggerClass} />)}
          </div>
        ) : (
          renderTrigger(<SelectTrigger {...triggerAccessibility} ref={trigger} size={size} className={className}>{icon}{displayValue != null ? <SelectValue>{displayValue}</SelectValue> : <SelectValue placeholder={placeholder} />}</SelectTrigger>)
        )}
        <SelectContent {...popupAttributes} size={size} anchor={useTags ? control : undefined} aria-label={popupLabel} alignItemWithTrigger={alignItemWithTrigger} className={popupClassName}>
          {items.map((entry, index) => "items" in entry ? (
            <Fragment key={entry.label}>
              {index > 0 ? <SelectSeparator /> : null}
              <SelectGroup><SelectLabel>{entry.label}</SelectLabel>{entry.items.map(option)}</SelectGroup>
            </Fragment>
          ) : option(entry))}
        </SelectContent>
      </Select>
    );
  }

  return (
    <ComboboxRoot<Value, boolean, PickerOption<Value>>
      actionsRef={popupActions}
      items={collection}
      filteredItems={remote ? (remote.results ?? items) : undefined}
      filter={remote ? null : undefined}
      inputValue={search.query}
      value={value}
      multiple={multiple}
      name={name}
      disabled={disabled}
      readOnly={readOnly}
      required={required}
      onValueChange={updateSelection}
      onInputValueChange={(query, details) => {
        if (multiple && !inputInTrigger && details.isItemPress) {
          details.cancel();
          return;
        }
        if (!remote || details.reason === "input-change" || details.reason === "input-clear") search.onQueryChange?.(query);
      }}
    >
      {inputInTrigger ? (
        <Primitive.InputGroup
          ref={control}
          className={cn(controlClass, "has-[[data-slot=input]:focus-visible]:ring-3 has-[[data-slot=input]:focus-visible]:ring-ring/50")}
        >
          {tags}
          {icon}
          <ComboboxInput
            {...triggerAccessibility}
            ref={input}
            placeholder={searchPlaceholder}
            className={cn("w-0 min-w-16 flex-1 border-0 bg-transparent px-1 focus-visible:ring-0", scale.inlineInput)}
          />
          {clear}
          {renderTrigger(<ComboboxTrigger ref={trigger} size={size} aria-label={`展开${label}选项`} className={compactTriggerClass} />)}
        </Primitive.InputGroup>
      ) : useTags ? (
        <Primitive.InputGroup ref={control} className={controlClass}>
          {tags ?? <span className={cn("min-w-0 flex-1 truncate px-1 text-muted-foreground", scale.text)}>{placeholder}</span>}
          {clear}
          {renderTrigger(<ComboboxTrigger {...triggerAccessibility} ref={trigger} size={size} className={compactTriggerClass} onKeyDown={closePopupFromTrigger} />)}
        </Primitive.InputGroup>
      ) : renderTrigger(
        <ComboboxTrigger {...triggerAccessibility} ref={trigger} size={size} className={className} onKeyDown={closePopupFromTrigger}>
          {icon}<span className="min-w-0 flex-1 truncate">{displayValue ?? <Primitive.Value placeholder={placeholder} />}</span>
        </ComboboxTrigger>,
      )}
      <ComboboxContent
        {...popupAttributes}
        size={size}
        anchor={useTags || inputInTrigger ? control : undefined}
        aria-label={popupLabel}
        className={cn(inputInTrigger && "grid-rows-[minmax(0,1fr)]", popupClassName)}
      >
        {!inputInTrigger ? (
          <ComboboxSearch
            aria-label={searchPlaceholder}
            placeholder={searchPlaceholder}
            loading={remote?.loading}
            className={remote ? scale.remoteFieldHeight : undefined}
          />
        ) : null}
        <PickerOptions<Value> label={popupLabel} emptyText={emptyText} loading={remote?.loading} error={remote?.error} />
      </ComboboxContent>
    </ComboboxRoot>
  );
}

export {
  Combobox, ComboboxRoot, ComboboxContent, ComboboxEmpty, ComboboxGroup, ComboboxGroupLabel, ComboboxInput,
  ComboboxItem, ComboboxList, ComboboxSearch, ComboboxTrigger,
};
export type { ComboboxProps };

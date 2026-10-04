import { Label } from "@heroui/react/label";
import { ListBox } from "@heroui/react/list-box";
import { Select } from "@heroui/react/select";
import { useId } from "react";
import { cn } from "./cn";

type SelectFieldProps = {
  label?: string;
  "aria-label"?: string;
  value: string;
  options: Array<{ value: string; label: string }>;
  onChange: (value: string) => void;
  disabled?: boolean;
  description?: string;
  className?: string;
  density?: "compact" | "default" | "form";
};

// Prefix keys so an empty business value remains a real selectable option.
const optionKey = (value: string) => `option:${value}`;

export function SelectField({ label, "aria-label": ariaLabel, value, options, onChange, disabled, description, className, density = "form" }: SelectFieldProps) {
  const descriptionId = useId();
  return <Select className={cn("orbis-select-field", `orbis-select-field--${density}`, className)} fullWidth aria-label={label ? undefined : ariaLabel} aria-describedby={description ? descriptionId : undefined} value={optionKey(value)} onChange={(key) => { if (typeof key === "string") onChange(key.slice("option:".length)); }} isDisabled={disabled}>
    {label ? <Label aria-label={ariaLabel}>{label}</Label> : null}
    <Select.Trigger><Select.Value /><Select.Indicator /></Select.Trigger>
    <Select.Popover className="orbis-select-popover"><ListBox>
      {options.map((option) => <ListBox.Item key={optionKey(option.value)} id={optionKey(option.value)} textValue={option.label}><Label>{option.label}</Label><ListBox.ItemIndicator /></ListBox.Item>)}
    </ListBox></Select.Popover>
    {description ? <span id={descriptionId} className="orbis-field-description">{description}</span> : null}
  </Select>;
}

import { Select } from "@orbis/ui/select";
import { cn } from "@orbis/ui/cn";
type SelectFieldProps = { label?: string; "aria-label"?: string; value: string; options: Array<{ value: string; label: string }>; onChange: (value: string) => void; disabled?: boolean; description?: string; className?: string; triggerClassName?: string; density?: "compact" | "default" | "form" };
export function SelectField({ label, "aria-label": ariaLabel, value, options, onChange, disabled, description, className, triggerClassName, density = "form" }: SelectFieldProps) {
  // 空字符串是业务选项；null 表示未选择，不改变旧的 string 回调契约。
  return <Select label={label} aria-label={ariaLabel} value={value} options={options} onValueChange={next => { if (next !== null) onChange(next); }} disabled={disabled} description={description} density={density} wrapperClassName={cn("orbis-select-field min-w-0 gap-2", `orbis-select-field--${density}`, className)} className={cn("select__trigger border-0 shadow-ob-field", triggerClassName)} />;
}

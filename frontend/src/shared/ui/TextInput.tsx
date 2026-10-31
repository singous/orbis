import { Input } from "@orbis/ui/input";
import type { ComponentProps } from "react";
import { cn } from "@orbis/ui/cn";
type TextInputProps = ComponentProps<"input"> & { label?: string };
export function TextInput({ label, className, ...props }: TextInputProps) {
  const input = <Input {...props} className={cn("input orbis-text-input w-full border-0 shadow-ob-field", className)} />;
  return label ? <label className="grid gap-1.5 text-sm font-medium text-[var(--text-primary)]"><span>{label}</span>{input}</label> : input;
}

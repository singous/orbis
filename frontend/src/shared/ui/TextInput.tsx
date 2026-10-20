import { Input as HeroInput } from "@heroui/react/input";
import type { ComponentProps } from "react";

import { cn } from "./cn";

type TextInputProps = Omit<ComponentProps<typeof HeroInput>, "className"> & {
  className?: string;
  label?: string;
};

export function TextInput({ label, className, ...props }: TextInputProps) {
  const input = (
    <HeroInput
      className={cn(
        "orbis-text-input w-full",
        className,
      )}
      {...props}
    />
  );

  if (!label) {
    return input;
  }

  return (
    <label className="grid gap-1.5 text-sm font-medium text-[var(--text-primary)]">
      <span>{label}</span>
      {input}
    </label>
  );
}

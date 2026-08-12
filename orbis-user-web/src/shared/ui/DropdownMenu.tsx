import * as RadixMenu from "@radix-ui/react-dropdown-menu";
import type { ComponentPropsWithoutRef } from "react";

import { cn } from "./cn";

export const DropdownMenu = RadixMenu.Root;
export const DropdownMenuTrigger = RadixMenu.Trigger;

export function DropdownMenuContent({
  className,
  children,
  ...props
}: ComponentPropsWithoutRef<typeof RadixMenu.Content>) {
  return (
    <RadixMenu.Portal>
      <RadixMenu.Content
        sideOffset={6}
        align="start"
        className={cn(
          "z-50 min-w-40 rounded-[var(--radius-pop)] border border-[var(--border-subtle)] bg-[var(--surface-overlay)] p-1",
          "shadow-[var(--shadow-pop)]",
          className,
        )}
        {...props}
      >
        {children}
      </RadixMenu.Content>
    </RadixMenu.Portal>
  );
}

export function DropdownMenuItem({
  className,
  destructive = false,
  ...props
}: ComponentPropsWithoutRef<typeof RadixMenu.Item> & { destructive?: boolean }) {
  return (
    <RadixMenu.Item
      className={cn(
        "flex cursor-pointer select-none items-center gap-2 rounded-[var(--radius-control)] px-2.5 py-1.5 text-sm outline-none",
        "data-[highlighted]:bg-[var(--surface-hover)]",
        "data-[disabled]:pointer-events-none data-[disabled]:opacity-50",
        destructive
          ? "text-[var(--danger)] data-[highlighted]:bg-[var(--danger-bg)]"
          : "text-[var(--text-primary)]",
        className,
      )}
      {...props}
    />
  );
}

export function DropdownMenuLabel({
  className,
  ...props
}: ComponentPropsWithoutRef<typeof RadixMenu.Label>) {
  return (
    <RadixMenu.Label
      className={cn("px-2.5 py-1.5 text-xs font-medium text-[var(--text-tertiary)]", className)}
      {...props}
    />
  );
}

export function DropdownMenuSeparator({
  className,
  ...props
}: ComponentPropsWithoutRef<typeof RadixMenu.Separator>) {
  return <RadixMenu.Separator className={cn("my-1 h-px bg-[var(--border-subtle)]", className)} {...props} />;
}

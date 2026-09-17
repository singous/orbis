import * as RadixDialog from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import type { ReactNode } from "react";

import { cn } from "./cn";
import { IconButton } from "./IconButton";

export const Dialog = RadixDialog.Root;
export const DialogTrigger = RadixDialog.Trigger;
export const DialogClose = RadixDialog.Close;

export function DialogContent({
  title,
  description,
  className,
  children,
  hideCloseButton = false,
}: {
  title: string;
  description?: string;
  className?: string;
  children?: ReactNode;
  hideCloseButton?: boolean;
}) {
  return (
    <RadixDialog.Portal>
      <RadixDialog.Overlay className="fixed inset-0 z-40 bg-[#24252a]/30" />
      <RadixDialog.Content
        className={cn(
          "fixed left-1/2 top-1/2 z-50 w-[calc(100vw-32px)] max-w-md -translate-x-1/2 -translate-y-1/2",
          "max-h-[calc(100dvh-48px)] overflow-y-auto rounded-[var(--radius-pop)] border border-[var(--border-subtle)] bg-[var(--surface-overlay)] p-7",
          "shadow-[var(--shadow-pop)]",
          "focus:outline-none",
          className,
        )}
      >
        <div className="flex items-start justify-between gap-4">
          <div className="grid gap-1">
            <RadixDialog.Title className="text-lg font-semibold tracking-tight text-[var(--text-primary)]">
              {title}
            </RadixDialog.Title>
            {description ? (
              <RadixDialog.Description className="text-sm leading-6 text-[var(--text-secondary)]">
                {description}
              </RadixDialog.Description>
            ) : null}
          </div>
          {hideCloseButton ? null : (
            <RadixDialog.Close asChild>
              <IconButton aria-label="关闭" size="sm">
                <X aria-hidden="true" size={14} />
              </IconButton>
            </RadixDialog.Close>
          )}
        </div>
        {children}
      </RadixDialog.Content>
    </RadixDialog.Portal>
  );
}

export function DialogFooter({ className, children }: { className?: string; children?: ReactNode }) {
  return <div className={cn("mt-5 flex justify-end gap-2", className)}>{children}</div>;
}

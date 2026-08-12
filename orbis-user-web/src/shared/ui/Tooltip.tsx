import * as RadixTooltip from "@radix-ui/react-tooltip";
import type { ReactNode } from "react";

import { cn } from "./cn";

/** Mount once near the app root. */
export function TooltipProvider({ children }: { children: ReactNode }) {
  return <RadixTooltip.Provider delayDuration={300}>{children}</RadixTooltip.Provider>;
}

export function Tooltip({
  label,
  children,
  side = "top",
  align = "center",
}: {
  label: string;
  children: ReactNode;
  side?: "top" | "right" | "bottom" | "left";
  align?: "start" | "center" | "end";
}) {
  return (
    <RadixTooltip.Root>
      <RadixTooltip.Trigger asChild>{children}</RadixTooltip.Trigger>
      <RadixTooltip.Portal>
        <RadixTooltip.Content
          side={side}
          align={align}
          sideOffset={6}
          className={cn(
            "z-50 rounded-[var(--radius-control)] border border-[var(--border-inverse)] bg-[var(--surface-inverse)] px-2 py-1",
            "text-xs text-[var(--text-oninverse)] shadow-[var(--shadow-pop)]",
          )}
        >
          {label}
        </RadixTooltip.Content>
      </RadixTooltip.Portal>
    </RadixTooltip.Root>
  );
}

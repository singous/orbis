import * as RadixTooltip from "@radix-ui/react-tooltip";
import type { ReactNode } from "react";

import { cn } from "./cn";

/**
 * Self-contained tooltip: ships its own provider so it works anywhere
 * without app-level wiring.
 */
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
    <RadixTooltip.Provider delayDuration={300}>
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
    </RadixTooltip.Provider>
  );
}

import { Tooltip as TooltipRoot, TooltipTrigger, TooltipContent } from "@orbis/ui/tooltip";
import type { ReactElement } from "react";

export function Tooltip({ label, children, side = "top", align = "center" }: {
  label: string;
  children: ReactElement;
  side?: "top" | "right" | "bottom" | "left";
  align?: "start" | "center" | "end";
}) {
  return <TooltipRoot delayMs={300}><TooltipTrigger asChild>{children}</TooltipTrigger><TooltipContent side={side} align={align} className="orbis-tooltip max-w-[min(20rem,calc(100vw-32px))] wrap-anywhere">{label}</TooltipContent></TooltipRoot>;
}

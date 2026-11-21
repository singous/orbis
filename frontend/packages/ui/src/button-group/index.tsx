import type { ComponentProps } from "react";
import { cn } from "../cn";

export function ButtonGroup({ className, ...props }: ComponentProps<"div">) {
  return (
    <div
      {...props}
      data-slot="button-group"
      role="group"
      className={cn("inline-flex w-fit min-w-0 items-stretch gap-1 rounded-xl bg-muted/60 p-1", className)}
    />
  );
}

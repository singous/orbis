import type { ComponentProps } from "react";
import { cn } from "../cn";
type SpinnerProps = ComponentProps<"span"> & { size?: "sm" | "md"; color?: "current" };
function Spinner({ size = "md", color: _color, className, "aria-label": label = "加载中", ...props }: SpinnerProps) {
  return <span role="status" aria-label={label} {...props} data-slot="ob-spinner" className={cn("inline-block shrink-0 animate-spin rounded-full border-2 border-current border-e-transparent motion-reduce:animate-none", size === "sm" ? "size-4" : "size-5", className)} />;
}
export { Spinner };
export type { SpinnerProps };

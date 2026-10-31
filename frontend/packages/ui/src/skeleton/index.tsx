import type { ComponentProps } from "react";
import { cn } from "../cn";
type SkeletonProps = ComponentProps<"div"> & { animationType?: "pulse" | "none" };
function Skeleton({ animationType = "pulse", className, ...props }: SkeletonProps) {
  return <div aria-hidden="true" {...props} data-slot="ob-skeleton" className={cn("rounded-ob-sm bg-ob-secondary", animationType === "pulse" && "animate-pulse motion-reduce:animate-none", className)} />;
}
export { Skeleton };
export type { SkeletonProps };

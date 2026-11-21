import type * as React from "react"
import { cn } from "cn"
import { Skeleton as BoneyardSkeleton, type SkeletonProps } from "boneyard-js/react"

function Skeleton({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="skeleton"
      className={cn("animate-pulse rounded-md bg-muted", className)}
      {...props}
    />
  )
}

function AutoSkeleton({ name, loading, children, fallback, className }: Pick<SkeletonProps, "loading" | "children" | "fallback" | "className"> & { name: string }) {
  return <BoneyardSkeleton name={name} loading={loading} fallback={fallback} className={className}
    color="var(--muted)" darkColor="var(--muted)" animate="solid" boneClass="motion-safe:animate-pulse" select="viewport"
  >{children}</BoneyardSkeleton>
}

export { AutoSkeleton, Skeleton }

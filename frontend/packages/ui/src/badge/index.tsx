import { cva } from "class-variance-authority";
import type { ComponentProps } from "react";
import { cn } from "../cn";
const badgeVariants = cva("inline-flex min-h-6 items-center gap-1 rounded-ob-sm px-2 text-xs font-medium", { variants: { tone: {
  neutral: "bg-ob-secondary text-ob-foreground", accent: "bg-ob-primary/10 text-ob-foreground",
  success: "bg-ob-success/10 text-ob-foreground", warning: "bg-ob-warning/15 text-ob-foreground", danger: "bg-ob-destructive/10 text-ob-danger-text",
} }, defaultVariants: { tone: "neutral" } });
type BadgeProps = ComponentProps<"span"> & { tone?: "neutral" | "accent" | "success" | "warning" | "danger" };
function Badge({ tone, className, ...props }: BadgeProps) { return <span {...props} data-slot="ob-badge" className={cn(badgeVariants({ tone }), className)} />; }
export { Badge };
export type { BadgeProps };

import type { ReactNode } from "react";
import type { ControlSize } from "../internal/control-size";
import { Button } from "../button";
import { cn } from "../cn";

type PaginationProps = {
  label: string;
  hasPrevious: boolean;
  hasNext: boolean;
  onPrevious: () => void;
  onNext: () => void;
  previousLabel?: string;
  nextLabel?: string;
  size?: ControlSize;
  className?: string;
  children?: ReactNode;
};

const paginationSize = {
  xs: { button: "text-[11px]", layout: "gap-0.5 text-xs", status: "px-1.5 py-0.5 text-[11px]" },
  sm: { button: "text-xs", layout: "gap-1 text-sm", status: "px-2.5 py-1 text-xs" },
  default: { button: "text-sm", layout: "gap-1.5 text-sm", status: "px-3 py-1 text-sm" },
  lg: { button: "text-base", layout: "gap-2 text-base", status: "px-3.5 py-1.5 text-base" },
  xl: { button: "h-11 px-4 text-lg", layout: "gap-2.5 text-lg", status: "px-4 py-2 text-lg" },
} as const;

export function Pagination({
  label, hasPrevious, hasNext, onPrevious, onNext,
  previousLabel = "上一页", nextLabel = "下一页", size = "sm", className, children,
}: PaginationProps) {
  const scale = paginationSize[size];
  const buttonSize = size === "xl" ? "lg" : size;
  return (
    <nav aria-label={label} data-size={size} className={cn("flex min-w-0 flex-wrap items-center", scale.layout, className)}>
      <Button type="button" variant="ghost" size={buttonSize} className={cn("rounded-lg pointer-coarse:min-h-11", scale.button)} disabled={!hasPrevious} onClick={onPrevious}>
        {previousLabel}
      </Button>
      {children != null ? <span className={cn("text-muted-foreground tabular-nums", scale.status)}>{children}</span> : null}
      <Button type="button" variant="ghost" size={buttonSize} className={cn("rounded-lg pointer-coarse:min-h-11", scale.button)} disabled={!hasNext} onClick={onNext}>
        {nextLabel}
      </Button>
    </nav>
  );
}

import { type ComponentProps, type ReactNode } from "react";
import { Button } from "@orbis/ui/button";
import { ArrowDown, ArrowUp, Trash2, X } from "../../shared/ui/icons";
import { cn } from "@orbis/ui/cn";

export function SiteField({ className, ...props }: ComponentProps<"label">) {
  return <label {...props} className={cn("grid min-w-0 gap-2 text-sm font-medium [&_input]:min-w-0 [&_textarea]:min-w-0 [&_small]:text-xs [&_small]:font-normal [&_small]:text-muted-foreground", className)} />;
}

export function SiteSectionHeading({ title, description, actions }: { title: ReactNode; description: ReactNode; actions?: ReactNode }) {
  return <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
    <div><h2 className="mb-2 flex items-center gap-2 text-base font-semibold">{title}</h2><p className="text-sm text-muted-foreground">{description}</p></div>
    {actions}
  </div>;
}

export function SitePagination({ hasPrevious, hasNext, onPrevious, onNext, children }: {
  hasPrevious: boolean;
  hasNext: boolean;
  onPrevious: () => void;
  onNext: () => void;
  children: ReactNode;
}) {
  return <div className="flex flex-wrap items-center justify-end gap-3 py-4 text-sm text-muted-foreground">
    <Button variant="outline" size="sm" disabled={!hasPrevious} onClick={onPrevious}>上一页</Button>
    <span>{children}</span>
    <Button variant="outline" size="sm" disabled={!hasNext} onClick={onNext}>下一页</Button>
  </div>;
}

export function SiteInfoPanel({ className, ...props }: ComponentProps<"div">) {
  return <div {...props} className={cn("rounded-lg border bg-muted/50 p-4", className)} />;
}

/** 来源顺序和手动目录共用重排动作，集合更新仍由调用方负责。 */
export function SiteReorderControls({ appearance, first, last, upLabel, downLabel, removeLabel, onMove, onRemove }: {
  appearance: "source" | "navigation";
  first: boolean;
  last: boolean;
  upLabel: string;
  downLabel: string;
  removeLabel: string;
  onMove: (direction: number) => void;
  onRemove: () => void;
}) {
  const RemoveIcon = appearance === "source" ? Trash2 : X;
  return <div className={cn("flex gap-1", appearance === "navigation" && "flex-col")}>
    <Button variant="ghost" size="icon-xs" disabled={first} aria-label={upLabel} onClick={() => onMove(-1)}><ArrowUp aria-hidden="true" /></Button>
    <Button variant="ghost" size="icon-xs" disabled={last} aria-label={downLabel} onClick={() => onMove(1)}><ArrowDown aria-hidden="true" /></Button>
    <Button variant="ghost" size="icon-xs" aria-label={removeLabel} onClick={onRemove}><RemoveIcon aria-hidden="true" /></Button>
  </div>;
}

export function SiteNotice({ title, description, icon, className, descriptionClassName }: {
  title: ReactNode;
  description: ReactNode;
  icon?: ReactNode;
  className?: string;
  descriptionClassName?: string;
}) {
  return <SiteInfoPanel className={cn(icon && "flex items-start gap-3", className)}>
    {icon}<div><strong className="text-sm">{title}</strong><p className={cn("mt-1 text-sm text-muted-foreground", descriptionClassName)}>{description}</p></div>
  </SiteInfoPanel>;
}

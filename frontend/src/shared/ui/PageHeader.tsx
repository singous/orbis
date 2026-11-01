import type { ComponentProps, ReactNode } from "react";
import { cn } from "@orbis/ui/cn";

export const pageActionsClassName = "page-actions flex min-w-0 max-w-full flex-none flex-wrap items-center gap-2 [&>.icon-button]:size-(--ob-control-height-md) [&>.icon-button]:pointer-coarse:size-(--ob-control-height-touch) [&>.icon-button>svg]:size-[1.125rem]";

type PageHeaderProps = {
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  className?: string;
} & ({
  layout?: "page";
  eyebrow?: string;
  actionsProps?: never;
} | {
  layout: "compact";
  eyebrow?: never;
  actionsProps?: Pick<ComponentProps<"div">, "className" | "role" | "aria-label">;
});

/** 页面标题共享语义；宽松工作台与紧凑记录区各自保留原有排版。 */
export function PageHeader({ title, description, actions, className, layout = "page", eyebrow, actionsProps }: PageHeaderProps) {
  const compact = layout === "compact";
  return <header className={cn(compact ? "mb-6 flex items-center justify-between gap-4" : "page-header mb-8 flex flex-wrap items-start justify-between gap-6 border-b border-[color:var(--ob-page-header-border,var(--ob-border))] pb-7 max-[641px]:mb-6 max-[641px]:gap-[18px] max-[641px]:pb-[22px]", className)}>
    <div className={compact ? "flex items-baseline gap-4 [@media(max-width:650px)]:block" : "min-w-0"}>
      {eyebrow ? <div className="mb-2 text-sm font-medium text-ob-muted-foreground">{eyebrow}</div> : null}
      <h1 className={compact ? "m-0 text-2xl font-semibold" : "text-2xl font-semibold tracking-[-0.025em] text-ob-foreground"}>{title}</h1>
      {description ? compact ? <span className="text-xs leading-5 text-ob-muted-foreground [@media(max-width:650px)]:hidden">{description}</span> : <p className="mt-[7px] max-w-[46rem] text-sm text-ob-muted-foreground">{description}</p> : null}
    </div>
    {actions ? <div {...actionsProps} className={compact ? actionsProps?.className : pageActionsClassName}>{actions}</div> : null}
  </header>;
}

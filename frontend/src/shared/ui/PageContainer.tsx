import type { ReactNode } from "react";
import { cn } from "@orbis/ui/cn";

export const pageBaseColumnClassName = "mx-auto w-full max-w-[1360px] px-[clamp(28px,4.8vw,76px)] pt-[46px] pb-[72px]";
export const pageColumnClassName = `page-container ${pageBaseColumnClassName} max-[1024px]:px-7 max-[1024px]:pt-8 max-[1024px]:pb-[60px] max-[641px]:px-5 max-[641px]:pt-6 max-[641px]:pb-12 [&_time]:[font-family:var(--ob-font-mono)] [&_time]:tracking-[-0.02em]`;
export const pageActionsClassName = "page-actions flex min-w-0 max-w-full flex-none flex-wrap items-center gap-2 [&>.icon-button]:size-(--ob-control-height-md) [&>.icon-button]:pointer-coarse:size-(--ob-control-height-touch) [&>.icon-button>svg]:size-[1.125rem]";

export type PageContainerProps = {
  /** Optional section context above the title, e.g. 文档中心. */
  eyebrow?: string;
  title: ReactNode;
  description?: ReactNode;
  /** Right-aligned header actions (buttons, links). */
  actions?: ReactNode;
  headerClassName?: string;
  children: ReactNode;
};

/**
 * Shared workbench column with a spacious, quiet title row.
 */
export function PageContainer({ eyebrow, title, description, actions, headerClassName, children }: PageContainerProps) {
  return (
    <div className={pageColumnClassName}>
      <header className={cn("page-header mb-8 flex flex-wrap items-start justify-between gap-6 border-b border-[color:var(--ob-page-header-border,var(--ob-border))] pb-7 max-[641px]:mb-6 max-[641px]:gap-[18px] max-[641px]:pb-[22px]", headerClassName)}>
        <div className="min-w-0">
          {eyebrow ? <div className="mb-2 text-sm font-medium text-ob-muted-foreground">{eyebrow}</div> : null}
          <h1 className="text-2xl font-semibold tracking-[-0.025em] text-ob-foreground">{title}</h1>
          {description ? <p className="mt-[7px] max-w-[46rem] text-sm text-ob-muted-foreground">{description}</p> : null}
        </div>
        {actions ? <div className={pageActionsClassName}>{actions}</div> : null}
      </header>
      {children}
    </div>
  );
}

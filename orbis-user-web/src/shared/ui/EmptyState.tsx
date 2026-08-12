import type { ReactNode } from "react";

import { cn } from "./cn";

export function EmptyState({
  icon,
  title,
  description,
  action,
  className,
}: {
  icon?: ReactNode;
  title: string;
  description?: string;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center gap-2 rounded-[var(--radius-container)]",
        "border border-dashed border-[var(--border-strong)] px-6 py-14 text-center",
        className,
      )}
    >
      {icon ? <div className="text-[var(--text-tertiary)]">{icon}</div> : null}
      <div className="text-sm font-semibold text-[var(--text-primary)]">{title}</div>
      {description ? (
        <p className="max-w-sm text-sm leading-6 text-[var(--text-secondary)]">{description}</p>
      ) : null}
      {action ? <div className="mt-2">{action}</div> : null}
    </div>
  );
}

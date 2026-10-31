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
    <div data-slot="ob-empty-state"
      className={cn(
        "flex flex-col items-center justify-center gap-3 px-6 py-16 text-center",
        className,
      )}
    >
      {icon ? <div className="mb-1 grid h-12 w-12 place-items-center rounded-xl bg-ob-accent text-ob-muted-foreground">{icon}</div> : null}
      <div className="text-base font-semibold text-ob-foreground">{title}</div>
      {description ? (
        <p className="max-w-sm text-sm leading-6 text-ob-muted-foreground">{description}</p>
      ) : null}
      {action ? <div className="mt-2">{action}</div> : null}
    </div>
  );
}

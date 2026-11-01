import type { ReactNode } from "react";

import { cn } from "./cn";

export function EmptyState({
  icon,
  title,
  description,
  action,
  className,
  appearance = "framed",
}: {
  icon?: ReactNode;
  title: string;
  description?: string;
  action?: ReactNode;
  className?: string;
  appearance?: "framed" | "plain";
}) {
  return (
    <div data-slot="ob-empty-state"
      className={cn(
        "flex flex-col items-center justify-center gap-3 px-6 text-center",
        appearance === "plain" ? "py-6 text-ob-muted-foreground" : "py-16",
        className,
      )}
    >
      {icon ? appearance === "plain" ? icon : <div className="mb-1 grid h-12 w-12 place-items-center rounded-ob-md bg-ob-accent text-ob-muted-foreground">{icon}</div> : null}
      {appearance === "plain" ? <h2 className="m-0 text-base font-medium text-ob-foreground">{title}</h2> : <div className="text-base font-semibold text-ob-foreground">{title}</div>}
      {description ? (
        <p className={appearance === "plain" ? "m-0 text-sm" : "max-w-sm text-sm leading-6 text-ob-muted-foreground"}>{description}</p>
      ) : null}
      {action ? <div className="mt-2">{action}</div> : null}
    </div>
  );
}

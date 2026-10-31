import type { ReactNode } from "react";

export function SectionHeading({ title, description, actions }: { title: ReactNode; description?: ReactNode; actions?: ReactNode }) {
  return <div className="section-heading mb-[18px] flex items-end justify-between gap-4">
    <div>
      <h2 className="text-base font-semibold tracking-[-0.025em]">{title}</h2>
      {description != null ? <p className="mt-1 text-ob-caption text-ob-muted-foreground">{description}</p> : null}
    </div>
    {actions}
  </div>;
}

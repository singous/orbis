import type { ComponentProps, ReactNode } from "react";
import { cn } from "@orbis/ui/cn";

export const homeCardClassName = "home-card min-w-0 rounded-ob-lg border border-ob-surface-edge bg-ob-card p-4 shadow-ob-card min-[541px]:p-6";

/** 首页与启动占位共用几何，加载完成时保持列宽、留白和标题位置。 */
export function HomeSurface({ className, ...props }: ComponentProps<"div">) {
  return <div {...props} className={cn("home-page min-h-full bg-ob-canvas p-4 text-sm text-ob-foreground min-[541px]:p-6", className)} />;
}

export function HomeHeader({ children }: { children: ReactNode }) {
  return <header className="home-header mb-6 flex flex-wrap items-center justify-between gap-4 min-[541px]:flex-nowrap min-[541px]:gap-6"><h1 className="m-0 text-2xl font-semibold">首页</h1>{children}</header>;
}

export function HomeGrid({ className, ...props }: ComponentProps<"div">) {
  return <div {...props} className={cn("home-grid mx-auto grid max-w-450 grid-cols-1 gap-4 min-[1001px]:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)] min-[1201px]:grid-cols-[minmax(0,1.39fr)_minmax(0,1fr)]", className)} />;
}

export function HomeCard({ className, ...props }: ComponentProps<"section">) {
  return <section {...props} className={cn(homeCardClassName, className)} />;
}

export function HomeCardHeading({ title, description, actions, className }: { title: string; description?: string; actions?: ReactNode; className?: string }) {
  return <header className={cn("home-card-heading mb-3 flex items-center justify-between gap-4", className)}><div><h2 className="m-0 text-base font-semibold text-ob-foreground">{title}</h2>{description ? <p className="mt-1 text-ob-muted-foreground">{description}</p> : null}</div>{actions}</header>;
}

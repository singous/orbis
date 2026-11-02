import type { ReactNode } from "react";
import type { Notebook } from "@/shared/api/schemas";
import { NotebookIcon } from "./NotebookIcon";

type NotebookIdentityProps = {
  notebook?: Pick<Notebook, "icon" | "title">;
} & (
  | { variant: "cover"; metadata: ReactNode; children?: never }
  | { variant: "overview"; metadata: ReactNode; children?: ReactNode }
  | { variant: "sidebar"; metadata?: never; children?: never }
);

/** 笔记本的同一视觉身份，在封面、卡片和目录中保留各自的阅读层级。 */
export function NotebookIdentity({ notebook, variant, metadata, children }: NotebookIdentityProps) {
  const title = notebook?.title ?? "正在加载…";
  if (variant === "sidebar") return <><NotebookIcon icon={notebook?.icon} size="sm" /><span className="truncate">{title}</span></>;
  if (variant === "cover") return <div className="notebook-identity flex min-w-0 max-w-full flex-[1_1_240px] items-start gap-5 max-[600px]:basis-full max-[600px]:gap-3.5 max-[600px]:pe-[calc(var(--ob-control-height-md)+8px)]">
    <NotebookIcon icon={notebook?.icon} size="lg" className="max-[600px]:size-11" />
    <div className="notebook-identity-copy grid min-w-0 gap-3 max-[600px]:gap-2">
      <h1 className="page-title m-0 truncate text-[28px] font-semibold leading-10 tracking-[-.02em] wrap-anywhere text-foreground max-[600px]:text-[24px] max-[600px]:leading-8" title={title}>{title}</h1>
      <p className="page-description notebook-home-stats m-0 flex max-w-[46rem] items-baseline gap-1.5 text-sm leading-5 text-(--muted-foreground) [&>strong]:text-base [&>strong]:font-medium [&>strong]:leading-6" role="status" aria-label="文档统计">{metadata}</p>
    </div>
  </div>;
  return <><NotebookIcon icon={notebook?.icon} /><span className="notebook-overview-card-copy flex min-w-0 flex-1 flex-col gap-2.5">
    <strong className="line-clamp-2 text-sm font-medium leading-5 text-foreground">{title}</strong>
    <span className="text-xs leading-[18px] text-(--muted-foreground)">{metadata}</span>
    {children}
  </span></>;
}

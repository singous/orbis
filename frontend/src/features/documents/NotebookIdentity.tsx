import type { ReactNode } from "react";
import type { Notebook } from "@/shared/api/schemas";
import { NotebookIcon } from "./NotebookIcon";

type NotebookIdentityProps = {
  notebook?: Pick<Notebook, "icon" | "title">;
} & (
  | { variant: "cover"; metadata: ReactNode }
  | { variant: "sidebar"; metadata?: never }
);

/** 笔记本的同一视觉身份，在封面、卡片和目录中保留各自的阅读层级。 */
export function NotebookIdentity({ notebook, variant, metadata }: NotebookIdentityProps) {
  const title = notebook?.title ?? "正在加载…";
  if (variant === "sidebar") return <><NotebookIcon icon={notebook?.icon} size="sm" /><span className="truncate">{title}</span></>;
  return <div className="notebook-identity flex min-w-0 max-w-full flex-[1_1_260px] items-center gap-4 max-[600px]:basis-full max-[600px]:gap-3.5">
    <NotebookIcon icon={notebook?.icon} size="lg" className="h-16 w-[54px] rounded-lg max-[600px]:size-11" />
    <div className="notebook-identity-copy grid min-w-0 gap-1.5">
      <h1 className="page-title m-0 truncate text-[28px] font-semibold leading-10 tracking-[-.02em] wrap-anywhere text-foreground max-[600px]:text-[24px] max-[600px]:leading-8" title={title}>{title}</h1>
      <p className="page-description notebook-home-stats m-0 flex max-w-[46rem] flex-wrap items-baseline gap-x-1.5 text-xs leading-5 text-muted-foreground" role="status" aria-label="文档统计">{metadata}</p>
    </div>
  </div>;
}

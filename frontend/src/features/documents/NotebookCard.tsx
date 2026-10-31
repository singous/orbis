import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { cn } from "@orbis/ui/cn";
import type { Notebook } from "@/shared/api/schemas";
import { formatDate } from "@/shared/format/date";
import { WorkbenchResourceLink } from "@/shared/ui/WorkbenchResourceLink";
import { NotebookIcon } from "./NotebookIcon";
import { NotebookIdentity } from "./NotebookIdentity";

type NotebookCardProps = { notebook: Notebook; variant: "collection" | "overview" | "compact"; noteCount?: number; actions?: ReactNode; footer?: ReactNode };

/** 卡片只拥有展示与布局，常用、创建、归档等权限和操作由调用方提供。 */
export function NotebookCard({ notebook, variant, noteCount, actions, footer }: NotebookCardProps) {
  const collection = variant === "collection";
  const Wrapper = collection ? "article" : "div";
  return <Wrapper className={cn("min-w-0 border border-ob-surface-edge bg-ob-card shadow-ob-card transition-[border-color,background-color,box-shadow] duration-(--ob-motion-feedback) hover:border-ob-border hover:shadow-ob-card-hover motion-reduce:transition-none", collection ? "workbench-collection-card flex min-h-24 flex-wrap items-center gap-x-2.5 gap-y-[5px] rounded-[15px] py-[18px] ps-5 pe-[15px] max-[560px]:p-4" : "notebook-overview-card relative rounded-ob-xl", variant === "compact" && "is-compact")}>
    {collection ? <WorkbenchResourceLink appearance="inline" to={`/collections/${notebook.id}`} icon={<NotebookIcon icon={notebook.icon} />} title={notebook.title} caption={noteCount !== undefined ? `${noteCount} 篇文档 · 更新于 ${formatDate(notebook.updated_at_ms)}` : `更新于 ${formatDate(notebook.updated_at_ms)}`} className="workbench-collection-link flex-1 gap-[15px]" /> : <Link to={`/collections/${notebook.id}`} title={notebook.title} className={cn("notebook-overview-card-link flex h-full min-w-0 gap-3.5 ps-5 pe-11", variant === "compact" ? "min-h-[78px] py-[18px]" : "min-h-[136px] py-5")}>
      <NotebookIdentity notebook={notebook} variant="overview" metadata={`更新于 ${formatDate(notebook.updated_at_ms)}`}>
        {variant === "overview" && noteCount !== undefined ? <span className="notebook-overview-count mt-auto pt-[18px] text-xs leading-[18px] text-(--ob-page-muted-foreground)">文档 {noteCount}</span> : null}
      </NotebookIdentity>
    </Link>}
    {collection ? <div className="workbench-collection-actions flex shrink-0 items-center gap-0 [&>.icon-button]:size-(--ob-control-height-sm) [&>.icon-button]:text-(--ob-page-muted-foreground) [&>.is-pinned]:bg-(--ob-item-selected-bg) [&>.is-pinned]:text-ob-foreground [&>.is-pinned_svg]:fill-current max-[1150px]:basis-full max-[1150px]:justify-end max-[850px]:basis-auto max-[560px]:basis-full">{actions}</div> : actions}
    {footer ? <div className="workbench-collection-footer mt-[3px] basis-full">{footer}</div> : null}
  </Wrapper>;
}

import type { ReactNode } from "react";
import type { Notebook } from "@/shared/api/schemas";
import { NotebookIcon } from "./NotebookIcon";
import { NotebookCoverIdentity, NotebookCoverPending } from "./NotebookCoverIdentity";

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
  if (!notebook) return <NotebookCoverPending metadata={metadata} />;
  return <NotebookCoverIdentity title={title} metadata={metadata}
    icon={<NotebookIcon icon={notebook.icon} size="lg" className="h-16 w-[54px] rounded-lg max-[600px]:size-11" />}
  />;
}

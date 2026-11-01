import type { ComponentProps } from "react";

/** 预览缺失、受限和加载反馈共用固定的占位空间，状态与操作仍由调用方拥有。 */
export function BoardPreviewState({ children, role }: Pick<ComponentProps<"div">, "children" | "role">) {
  return <div className="board-preview-empty flex min-h-[180px] flex-col items-center justify-center gap-2.5 p-5 text-(--ob-page-muted-foreground)" role={role}>{children}</div>;
}

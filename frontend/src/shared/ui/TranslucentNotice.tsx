import type { ComponentProps } from "react";

import "../../styles/translucent-notice.css";
import { cn } from "./cn";

export type TranslucentNoticeProps = ComponentProps<"aside">;

/** 灰色半透明的静态文案提示，沿用 Glass 材质与明暗主题。 */
export function TranslucentNotice({ children, className, role = "note", ...props }: TranslucentNoticeProps) {
  return (
    <aside {...props} role={role} className={cn("orbis-translucent-notice", className)}>
      {children}
    </aside>
  );
}

import { useEffect, useState } from "react";
import { Skeleton } from "@orbis/ui/skeleton";
import { Spinner } from "@orbis/ui/spinner";
import { cn } from "@orbis/ui/cn";

export const loadingLineClassName = "loading-line h-[12px] w-full rounded-ob-sm";

type LoadingStateProps = { label: string; variant?: "cards" | "rows" | "editor" | "editor-body"; compact?: boolean; delayMs?: number };

/** Layout placeholders are decorative; announce the pending state once. */
export function LoadingState({ label, variant = "rows", compact = false, delayMs = 0 }: LoadingStateProps) {
  const [visible, setVisible] = useState(delayMs === 0);
  useEffect(() => {
    if (!delayMs) { setVisible(true); return; }
    const timer = window.setTimeout(() => setVisible(true), delayMs);
    return () => window.clearTimeout(timer);
  }, [delayMs]);
  if (!visible) return <div className="editor-loading-reserve min-h-[160px]" aria-busy="true" />;
  const editor = variant === "editor" || variant === "editor-body";
  return <div role="status" aria-label={label} aria-busy="true" className={cn("loading-state min-w-0 py-[18px]", `loading-state--${variant}`, compact && "loading-state--compact", variant === "editor-body" && "max-w-full")}>
    <div className={cn("loading-state-label mb-[18px] flex items-center gap-[9px] text-sm text-ob-muted-foreground", variant === "editor-body" && "mb-5 text-ob-caption")}><Spinner size="sm" color="current" aria-hidden="true" /><span>{label}</span></div>
    <div aria-hidden="true" className={cn("loading-layout grid min-w-0 grid-cols-1 gap-[14px]", `loading-layout--${variant}`, variant === "cards" && "grid-cols-2 max-[851px]:grid-cols-1", editor && "max-w-[760px] content-start", variant === "editor" && "min-h-[300px] gap-[23px]", variant === "editor-body" && "min-h-[140px] w-full gap-[18px]")}>
      {Array.from({ length: editor ? (variant === "editor-body" ? 4 : 6) : compact ? 3 : variant === "cards" ? 4 : 5 }, (_, index) => editor ?
        <Skeleton key={index} animationType="pulse" className={cn(loadingLineClassName, index % 3 === 2 && "loading-line--short w-[64%]", variant === "editor-body" && "h-[10px]", variant === "editor" && index === 0 && "mb-4 h-[30px] w-[55%]")} /> :
        <div key={index} className={cn("loading-item flex items-center gap-4", variant === "cards" && "rounded-[15px] border border-ob-border in-[.workspace-shell]:border-ob-workspace-outline", compact ? "min-h-[42px] px-0 py-[6px]" : variant === "cards" ? "min-h-[96px] p-[18px]" : "min-h-[74px] px-3 py-[14px]")}>
          <Skeleton animationType="pulse" className={cn("loading-icon shrink-0 rounded-ob-lg", compact ? "size-[22px]" : "size-[32px]")} />
          <div className="loading-copy grid min-w-0 flex-1 gap-3"><Skeleton animationType="pulse" className={cn(loadingLineClassName, "loading-line--short w-[64%]")} /><Skeleton animationType="pulse" className={loadingLineClassName} /></div>
        </div>)}
    </div>
  </div>;
}

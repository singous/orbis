import { lazy, Suspense, useEffect, useState } from "react";
import { Spinner } from "@orbis/ui/spinner";
import { cn } from "@orbis/ui/cn";

const GeneratedSkeleton = lazy(() => import("./GeneratedSkeleton"));

type LoadingStateProps = {
  label: string;
  variant?: "cards" | "rows" | "editor" | "editor-body";
  compact?: boolean;
  delayMs?: number;
  bones?: "notebook-shelf" | "document-body";
};

/** Keep the label accessible whether generated bones are available or not. */
export function LoadingState({ label, variant = "rows", compact = false, delayMs = 0, bones }: LoadingStateProps) {
  const [visible, setVisible] = useState(delayMs === 0);
  useEffect(() => {
    if (!delayMs) { setVisible(true); return; }
    const timer = window.setTimeout(() => setVisible(true), delayMs);
    return () => window.clearTimeout(timer);
  }, [delayMs]);
  if (!visible) return <div className="editor-loading-reserve min-h-40" aria-busy="true" />;
  return (
    <div role="status" aria-label={label} aria-busy="true" className={cn("loading-state min-w-0 py-[18px]", `loading-state--${variant}`, compact && "loading-state--compact py-2")}>
      <div className={cn("loading-state-label flex items-center gap-2 text-sm text-muted-foreground", variant === "editor-body" && "text-xs")}><Spinner aria-hidden="true" /><span>{label}</span></div>
      {bones ? <Suspense fallback={null}><div aria-hidden="true" className="mt-4"><GeneratedSkeleton name={bones} /></div></Suspense> : null}
    </div>
  );
}

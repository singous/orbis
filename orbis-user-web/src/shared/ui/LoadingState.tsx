import { useEffect, useState } from "react";
import { Skeleton } from "@heroui/react/skeleton";
import { Spinner } from "@heroui/react/spinner";

type LoadingStateProps = { label: string; variant?: "cards" | "rows" | "editor" | "editor-body"; compact?: boolean; delayMs?: number };

/** Layout placeholders are decorative; announce the pending state once. */
export function LoadingState({ label, variant = "rows", compact = false, delayMs = 0 }: LoadingStateProps) {
  const [visible, setVisible] = useState(delayMs === 0);
  useEffect(() => {
    if (!delayMs) { setVisible(true); return; }
    const timer = window.setTimeout(() => setVisible(true), delayMs);
    return () => window.clearTimeout(timer);
  }, [delayMs]);
  if (!visible) return <div className="editor-loading-reserve" aria-busy="true" />;
  const editor = variant === "editor" || variant === "editor-body";
  return <div role="status" aria-label={label} aria-busy="true" className={`loading-state loading-state--${variant}${compact ? " loading-state--compact" : ""}`}>
    <div className="loading-state-label"><Spinner size="sm" color="current" aria-hidden="true" /><span>{label}</span></div>
    <div aria-hidden="true" className={`loading-layout loading-layout--${variant}`}>
      {Array.from({ length: editor ? (variant === "editor-body" ? 4 : 6) : compact ? 3 : variant === "cards" ? 4 : 5 }, (_, index) => editor ?
        <Skeleton key={index} animationType="pulse" className={`loading-line${index % 3 === 2 ? " loading-line--short" : ""}`} /> :
        <div key={index} className="loading-item">
          <Skeleton animationType="pulse" className="loading-icon" />
          <div className="loading-copy"><Skeleton animationType="pulse" className="loading-line loading-line--short" /><Skeleton animationType="pulse" className="loading-line" /></div>
        </div>)}
    </div>
  </div>;
}

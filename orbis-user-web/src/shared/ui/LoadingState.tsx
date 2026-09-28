import { Skeleton } from "@heroui/react/skeleton";
import { Spinner } from "@heroui/react/spinner";

type LoadingStateProps = { label: string; variant?: "cards" | "rows" | "editor"; compact?: boolean };

/** Layout placeholders are decorative; announce the pending state once. */
export function LoadingState({ label, variant = "rows", compact = false }: LoadingStateProps) {
  return <div role="status" aria-label={label} aria-busy="true" className={`loading-state loading-state--${variant}${compact ? " loading-state--compact" : ""}`}>
    <div className="loading-state-label"><Spinner size="sm" color="current" aria-hidden="true" /><span>{label}</span></div>
    <div aria-hidden="true" className={`loading-layout loading-layout--${variant}`}>
      {Array.from({ length: variant === "editor" ? 6 : compact ? 3 : variant === "cards" ? 4 : 5 }, (_, index) => variant === "editor" ?
        <Skeleton key={index} animationType="pulse" className={`loading-line${index % 3 === 2 ? " loading-line--short" : ""}`} /> :
        <div key={index} className="loading-item">
          <Skeleton animationType="pulse" className="loading-icon" />
          <div className="loading-copy"><Skeleton animationType="pulse" className="loading-line loading-line--short" /><Skeleton animationType="pulse" className="loading-line" /></div>
        </div>)}
    </div>
  </div>;
}

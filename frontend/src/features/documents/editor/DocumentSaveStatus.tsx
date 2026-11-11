import { useSyncExternalStore } from "react";
import { cn } from "@orbis/ui/cn";
import { AlertTriangle, Check, Cloud, RefreshCw, WifiOff } from "../../../shared/ui/icons";

const stateInfo = {
  saved: { label: "已保存", Icon: Check, color: "bg-(--ob-save-success-bg) text-(--ob-save-success-ink)" },
  dirty: { label: "等待保存", Icon: Cloud, color: "bg-muted text-muted-foreground" },
  saving: { label: "保存中…", Icon: RefreshCw, color: "bg-(--ob-save-progress-bg) text-(--ob-save-progress-ink)" },
  offline: { label: "已离线", Icon: WifiOff, color: "bg-(--ob-save-offline-bg) text-(--ob-save-offline-ink)" },
  readonly: { label: "只读", Icon: Cloud, color: "bg-muted text-muted-foreground" },
  error: { label: "保存失败", Icon: AlertTriangle, color: "bg-destructive-soft text-destructive" },
  conflict: { label: "版本冲突", Icon: AlertTriangle, color: "bg-status-warning-background text-status-warning-foreground" },
  recovery: { label: "本机草稿需要恢复", Icon: AlertTriangle, color: "bg-status-warning-background text-status-warning-foreground" },
};

function subscribeOnline(listener: () => void) {
  window.addEventListener("online", listener);
  window.addEventListener("offline", listener);
  return () => {
    window.removeEventListener("online", listener);
    window.removeEventListener("offline", listener);
  };
}

export function DocumentSaveStatus({ state, label }: { state: keyof typeof stateInfo; label?: string }) {
  const online = useSyncExternalStore(subscribeOnline, () => navigator.onLine);
  const status = !online && state !== "readonly" && state !== "conflict" && state !== "recovery" ? "offline" : state;
  const { Icon, label: defaultLabel, color } = stateInfo[status];
  const text = status === "offline" ? defaultLabel : label ?? defaultLabel;
  return <span className={cn("document-save-state inline-flex h-7 shrink-0 items-center gap-1.5 rounded-full px-2.5 text-xs font-semibold whitespace-nowrap max-[768px]:size-7 max-[768px]:justify-center max-[768px]:p-0", `is-${status}`, color)} role="status" aria-live="polite" aria-atomic="true" title={status === "offline" ? label ?? "网络恢复后可继续同步" : text}>
    <Icon aria-hidden="true" size={14} className={cn("shrink-0", status === "saving" && "document-save-spinner animate-spin motion-reduce:animate-none")} />
    <span className="max-[768px]:sr-only">{text}</span>
  </span>;
}

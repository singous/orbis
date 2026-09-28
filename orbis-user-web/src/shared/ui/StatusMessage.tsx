import { Alert } from "@heroui/react/alert";
import type { ReactNode } from "react";

type StatusTone = "info" | "warning" | "error" | "success";

/** Persistent recovery context; transient operation feedback uses Toast. */
export function StatusMessage({ tone = "info", title, children, role = "status" }: { tone?: StatusTone; title: string; children?: ReactNode; role?: "alert" | "status" }) {
  return <Alert role={role} status={tone === "error" ? "danger" : tone === "info" ? "default" : tone}>
    <Alert.Indicator />
    <Alert.Content><Alert.Title>{title}</Alert.Title>{children ? <Alert.Description>{children}</Alert.Description> : null}</Alert.Content>
  </Alert>;
}

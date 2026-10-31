import { Badge } from "@orbis/ui/badge";
import type { ReactNode } from "react";

type TagTone = "neutral" | "accent" | "success" | "warning" | "danger";
export type TagProps = { tone?: TagTone | null; className?: string; children: ReactNode };

export function Tag({ tone, className, children }: TagProps) {
  return <Badge tone={tone ?? "neutral"} className={className}>{children}</Badge>;
}

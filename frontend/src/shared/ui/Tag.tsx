import { Chip } from "@heroui/react/chip";
import type { ReactNode } from "react";

type TagTone = "neutral" | "accent" | "success" | "warning" | "danger";
export type TagProps = { tone?: TagTone | null; className?: string; children: ReactNode };

export function Tag({ tone, className, children }: TagProps) {
  return <Chip size="sm" variant="soft" color={tone === "neutral" || !tone ? "default" : tone} className={className}>{children}</Chip>;
}

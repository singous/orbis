import type { CSSProperties } from "react";

const NAMED_COLORS = new Set(["black", "white", "brown", "transparent", "gray", "red", "orange", "yellow", "green", "blue", "purple", "pink"]);
const ALIGNMENTS = new Set(["left", "center", "right", "justify"]);

function color(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  return NAMED_COLORS.has(value) || /^#[\da-fA-F]{3,8}$/.test(value) ? value : undefined;
}

export function contentInlineStyle(value: Record<string, unknown>): CSSProperties {
  return { color: color(value.textColor), backgroundColor: color(value.backgroundColor) };
}

export function contentTextAlignment(value: unknown): CSSProperties["textAlign"] {
  return typeof value === "string" && ALIGNMENTS.has(value) ? value as CSSProperties["textAlign"] : undefined;
}

export function contentCellStyle(value: Record<string, unknown>): CSSProperties {
  return { ...contentInlineStyle(value), textAlign: contentTextAlignment(value.textAlignment) };
}

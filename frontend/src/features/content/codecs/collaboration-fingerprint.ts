import { digest } from "lib0/hash/sha256";
import * as Y from "yjs";

const CACHED_ATTRIBUTES = new Set(["orbisOriginal", "orbisSignature", "orbisCellOriginal"]);
export const COLLABORATION_ATOMIC_ATTRIBUTES = ["orbisProps", "orbisCellProps", "columnWidths", "colwidth"] as const;
function sorted(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sorted);
  if (value !== null && typeof value === "object") return Object.fromEntries(Object.keys(value).sort().map(key => [key, sorted((value as Record<string, unknown>)[key])]));
  return value;
}
function elementValue(element: Y.XmlElement): unknown {
  return {
    name: element.nodeName,
    attributes: Object.fromEntries(Object.entries(element.getAttributes()).filter(([key]) => !CACHED_ATTRIBUTES.has(key))),
    children: element.toArray().map(child => child instanceof Y.XmlElement ? elementValue(child) : child instanceof Y.XmlText ? { delta: child.toDelta() } : null),
  };
}

/** Proves the original structural-edit content without exposing the content in
 * the wire envelope. Browser and engine use exactly the same canonical form. */
export function fingerprintElement(element: Y.XmlElement): string {
  return fingerprintText(JSON.stringify(sorted(elementValue(element))));
}

export function fingerprintText(value: string): string {
  const bytes = new TextEncoder().encode(value);
  return Array.from(digest(bytes), byte => byte.toString(16).padStart(2, "0")).join("");
}

export function fingerprintValue(value: unknown): string {
  return fingerprintText(JSON.stringify(sorted({ value })));
}

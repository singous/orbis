/**
 * Timestamp formatting for the UI boundary. Storage and transport keep
 * millisecond Unix timestamps; conversion to a human-readable string happens
 * here and nowhere else.
 */

const shortDate = new Intl.DateTimeFormat("zh-CN", {
  month: "short",
  day: "numeric",
});

/** Compact day label, e.g. 8月17日 — for list rows and cards. */
export function formatDate(value: number): string {
  return shortDate.format(new Date(value));
}

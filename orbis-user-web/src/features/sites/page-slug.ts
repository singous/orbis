export const MAX_SITE_PAGES = 200;
export const MAX_PAGE_SLUG_LENGTH = 100;

/** Public paths depend only on reader-facing titles and occupied paths. */
export function createPageSlug(title: string, existingSlugs: readonly string[]): string {
  const occupied = new Set(existingSlugs);
  const base = title.normalize("NFKD").replace(/[\u0300-\u036f]/g, "")
    .toLowerCase().replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "").slice(0, MAX_PAGE_SLUG_LENGTH).replace(/-+$/g, "");
  if (base && !occupied.has(base)) return base;
  for (let index = base ? 2 : 1; ; index += 1) {
    const suffix = `-${index}`;
    const candidate = `${(base || "page").slice(0, MAX_PAGE_SLUG_LENGTH - suffix.length).replace(/-+$/g, "")}${suffix}`;
    if (!occupied.has(candidate)) return candidate;
  }
}

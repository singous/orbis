import type { PublishedPage, SiteSnapshot } from "../schemas";

export type NavigationNode = { page: PublishedPage; children: NavigationNode[] };
export type NavigationSection = { label: string; nodes: NavigationNode[] };
export type SearchResult = { page: PublishedPage; path: string; excerpt: string; score: number };

const DEFAULT_GROUP = "文档";

export function pageHref(basePath: string, slug: string): string {
  return `${basePath}/${encodeURIComponent(slug)}`;
}

export function resolveRedirect(slug: string | undefined, redirects: SiteSnapshot["redirects"]): string | null {
  if (!slug || !redirects) return null;
  const normalized = decodeURIComponent(slug).replace(/^\/+|\/+$/g, "");
  const target = redirects[normalized] ?? redirects[`/${normalized}`];
  return target ? target.replace(/^\/+|\/+$/g, "") : null;
}

export function pageAncestors(pages: PublishedPage[], page: PublishedPage): PublishedPage[] {
  const bySlug = new Map(pages.map((item) => [item.slug, item]));
  const result: PublishedPage[] = [];
  const visited = new Set<string>([page.slug]);
  let parentSlug = page.parent_slug;
  while (parentSlug) {
    const parent = bySlug.get(parentSlug);
    if (!parent || visited.has(parent.slug)) break;
    result.unshift(parent);
    visited.add(parent.slug);
    parentSlug = parent.parent_slug;
  }
  return result;
}

function navigationNodes(pages: PublishedPage[]): NavigationNode[] {
  const nodes = new Map(pages.map((page) => [page.slug, { page, children: [] as NavigationNode[] }]));
  const roots: NavigationNode[] = [];
  for (const page of pages) {
    const current = nodes.get(page.slug)!;
    const parent = page.parent_slug ? nodes.get(page.parent_slug) : undefined;
    if (parent && parent !== current) parent.children.push(current);
    else roots.push(current);
  }
  return roots;
}

export function navigationSections(pages: PublishedPage[]): NavigationSection[] {
  const roots = navigationNodes(pages);
  const result: NavigationSection[] = [];
  for (const node of roots) {
    const label = node.page.group || DEFAULT_GROUP;
    const previous = result[result.length - 1];
    if (previous?.label === label) previous.nodes.push(node);
    else result.push({ label, nodes: [node] });
  }
  return result;
}

export function topSections(pages: PublishedPage[]): Array<{ label: string; slug: string }> {
  const seen = new Set<string>();
  const sections: Array<{ label: string; slug: string }> = [];
  for (const page of pages) {
    const label = page.section?.trim();
    if (label && !seen.has(label)) {
      seen.add(label);
      sections.push({ label, slug: page.slug });
    }
  }
  return sections;
}

function excerptFor(text: string, query: string): string {
  const normalizedText = text.toLocaleLowerCase();
  const index = normalizedText.indexOf(query);
  const start = Math.max(0, index < 0 ? 0 : index - 34);
  const excerpt = text.slice(start, start + 116).trim();
  return `${start > 0 ? "…" : ""}${excerpt}${start + 116 < text.length ? "…" : ""}`;
}

export function searchPublishedPages(pages: PublishedPage[], rawQuery: string): SearchResult[] {
  const query = rawQuery.trim().toLocaleLowerCase();
  if (!query) return [];
  const results: SearchResult[] = [];
  for (const [index, page] of pages.entries()) {
    const title = page.title.toLocaleLowerCase();
    const body = page.plain_text.toLocaleLowerCase();
    const titleIndex = title.indexOf(query);
    const bodyIndex = body.indexOf(query);
    if (titleIndex < 0 && bodyIndex < 0) continue;
    const ancestors = pageAncestors(pages, page);
    const description = page.description || "";
    const excerptSource = description.toLocaleLowerCase().includes(query) ? description : page.plain_text;
    results.push({
      page,
      path: [page.group || DEFAULT_GROUP, ...ancestors.map((item) => item.title)].join(" / "),
      excerpt: excerptFor(excerptSource, query),
      score: (titleIndex >= 0 ? 10_000 - titleIndex * 10 : 1_000 - bodyIndex) - index / 1_000,
    });
  }
  return results.sort((left, right) => right.score - left.score);
}

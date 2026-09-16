import { useMemo, type ReactNode } from "react";
import { ContentLinkContext } from "../content/ContentMedia";
import { pageHref } from "./reader/reader-model";

/** Keep same-site links inside the authenticated or frozen preview. */
export function SitePreviewLinks({ siteSlug, basePath, onNavigate, children }: {
  siteSlug: string;
  basePath: string;
  onNavigate?: (slug: string) => void;
  children: ReactNode;
}) {
  const links = useMemo(() => {
    const prefix = `/s/${encodeURIComponent(siteSlug)}/`;
    function target(href: string) {
      if (!href.startsWith(prefix)) return null;
      const [slug, fragment] = href.slice(prefix.length).split("#", 2);
      return { slug, fragment: fragment ? `#${fragment}` : "" };
    }
    return {
      resolve(href: string) {
        const page = target(href);
        return page ? pageHref(basePath, page.slug) + page.fragment : href;
      },
      onClick: onNavigate ? (event: React.MouseEvent<HTMLAnchorElement>, href: string) => {
        const page = target(href);
        if (!page || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
        event.preventDefault();
        onNavigate(page.slug);
        if (page.fragment) requestAnimationFrame(() => document.getElementById(page.fragment.slice(1))?.scrollIntoView({ block: "start" }));
      } : undefined,
    };
  }, [siteSlug, basePath, onNavigate]);
  return <ContentLinkContext.Provider value={links}>{children}</ContentLinkContext.Provider>;
}

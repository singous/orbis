import { useEffect } from "react";

/** Keep client navigation aligned with the server's canonical metadata. */
export function useReaderMetadata(title: string, description: string, canonical: string | undefined, preview: boolean) {
  useEffect(() => {
    const previousTitle = document.title;
    document.title = title;
    const restore: Array<() => void> = [];
    function meta(attribute: "name" | "property", name: string, content: string) {
      let element = document.head.querySelector<HTMLMetaElement>(`meta[${attribute}="${name}"]`);
      if (!element) {
        element = document.createElement("meta");
        element.setAttribute(attribute, name);
        document.head.appendChild(element);
        restore.push(() => element?.remove());
      } else {
        const previous = element.getAttribute("content");
        const original = element;
        restore.push(() => { if (previous === null) original.removeAttribute("content"); else original.setAttribute("content", previous); });
      }
      element.content = content;
    }
    meta("name", "description", description);
    meta("name", "robots", preview ? "noindex, nofollow" : "index, follow");
    meta("property", "og:title", title);
    meta("property", "og:description", description);
    meta("property", "og:type", "article");
    if (preview) {
      for (const element of document.head.querySelectorAll('link[rel="canonical"], meta[property="og:url"]')) {
        element.remove();
        restore.push(() => document.head.appendChild(element));
      }
    }
    if (canonical && !preview) {
      meta("property", "og:url", canonical);
      let link = document.head.querySelector<HTMLLinkElement>('link[rel="canonical"]');
      if (!link) {
        link = document.createElement("link");
        link.rel = "canonical";
        document.head.appendChild(link);
        restore.push(() => link?.remove());
      } else {
        const previous = link.href;
        const original = link;
        restore.push(() => { original.href = previous; });
      }
      link.href = canonical;
    }
    return () => { document.title = previousTitle; restore.reverse().forEach((reset) => reset()); };
  }, [title, description, canonical, preview]);
}

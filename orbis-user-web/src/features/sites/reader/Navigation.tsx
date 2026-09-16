import { ChevronRight } from "lucide-react";
import { useEffect, useRef, type RefObject } from "react";
import { Link } from "react-router-dom";

import type { SiteBranding } from "../schemas";
import type { NavigationNode, NavigationSection } from "./reader-model";
import { pageHref } from "./reader-model";

function NavigationBranch({ node, currentSlug, basePath, depth, close }: { node: NavigationNode; currentSlug?: string; basePath: string; depth: number; close: () => void }) {
  const link = <Link to={pageHref(basePath, node.page.slug)} aria-current={currentSlug === node.page.slug ? "page" : undefined} onClick={close}>{node.page.title}</Link>;
  if (!node.children.length) return <li className="site-reader-navigation-item" style={{ "--tree-depth": depth } as React.CSSProperties}>{link}</li>;
  const containsCurrent = (branch: NavigationNode): boolean => branch.page.slug === currentSlug || branch.children.some(containsCurrent);
  return <li className="site-reader-navigation-branch" style={{ "--tree-depth": depth } as React.CSSProperties}>
    <details open={containsCurrent(node) || undefined}>
      <summary><ChevronRight aria-hidden="true" size={14} />{link}</summary>
      <ul>{node.children.map((child) => <NavigationBranch key={child.page.slug} node={child} currentSlug={currentSlug} basePath={basePath} depth={depth + 1} close={close} />)}</ul>
    </details>
  </li>;
}

export function Navigation({ sections, currentSlug, basePath, open, close, description, footerLinks, modal, returnFocusRef }: {
  sections: NavigationSection[];
  currentSlug?: string;
  basePath: string;
  open: boolean;
  close: () => void;
  description?: string;
  footerLinks: SiteBranding["footer_links"];
  modal: boolean;
  returnFocusRef: RefObject<HTMLButtonElement | null>;
}) {
  const drawerRef = useRef<HTMLElement>(null);
  const hiddenByCollapsedBranch = (element: HTMLElement) => {
    let ancestor = element.parentElement;
    while (ancestor && ancestor !== drawerRef.current) {
      if (ancestor instanceof HTMLDetailsElement && !ancestor.open) {
        const summary = Array.from(ancestor.children).find((child) => child.tagName === "SUMMARY");
        if (!summary?.contains(element)) return true;
      }
      ancestor = ancestor.parentElement;
    }
    return false;
  };
  const drawerFocusable = () => Array.from(drawerRef.current?.querySelectorAll<HTMLElement>("a[href], summary, button:not([disabled]), [tabindex]:not([tabindex='-1'])") ?? [])
    .filter((element) => !hiddenByCollapsedBranch(element));

  useEffect(() => {
    if (!modal || !open) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    drawerFocusable()[0]?.focus();
    return () => {
      document.body.style.overflow = previousOverflow;
      returnFocusRef.current?.focus();
    };
  }, [modal, open, returnFocusRef]);

  return <>
    {open ? <button type="button" className="site-reader-navigation-scrim" aria-label="收起站点导航" onClick={close} /> : null}
    <aside ref={drawerRef} id="site-navigation" className={`site-reader-navigation${open ? " is-open" : ""}`} role={modal && open ? "dialog" : undefined} aria-modal={modal && open ? "true" : undefined} aria-label={modal && open ? "站点导航抽屉" : undefined} onKeyDown={(event) => {
      if (!modal || !open) return;
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        close();
        return;
      }
      if (event.key !== "Tab") return;
      const focusable = drawerFocusable();
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    }}>
      {description ? <p className="site-reader-navigation-intro">{description}</p> : null}
      <nav aria-label="站点导航">
        {sections.map((section, index) => <section key={`${section.label}-${index}`}>
          <h2>{section.label}</h2>
          <ul>{section.nodes.map((node) => <NavigationBranch key={node.page.slug} node={node} currentSlug={currentSlug} basePath={basePath} depth={0} close={close} />)}</ul>
        </section>)}
      </nav>
      <footer className="site-reader-navigation-footer">
        {footerLinks.map((link) => <a key={`${link.label}-${link.url}`} href={link.url} rel="noopener noreferrer">{link.label}</a>)}
        <span>由 <strong>Orbis</strong> 提供支持</span>
      </footer>
    </aside>
  </>;
}

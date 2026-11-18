import { OrbisAttribution } from "../../../shared/ui/OrbisAttribution";
import { readerFocus } from "./chrome";
import { ChevronRight } from "../../../shared/ui/icons";
import { useEffect, useRef, type RefObject } from "react";
import { Link } from "react-router-dom";

import { ManagedContentLink } from "../../content/ContentMedia";
import type { SiteBranding } from "../schemas";
import type { NavigationNode, NavigationSection } from "./reader-model";
import { pageHref } from "./reader-model";

function NavigationBranch({ node, currentSlug, basePath, depth, close }: { node: NavigationNode; currentSlug?: string; basePath: string; depth: number; close: () => void }) {
  const link = <Link className={`block min-w-0 truncate rounded-[7px] py-[7px] pr-2.5 pl-[calc(10px+var(--ob-reader-tree-depth)*14px)] text-[length:var(--ob-prose-caption-size)] leading-[1.45] text-(--ob-reader-muted) hover:bg-(--ob-reader-surface-soft) hover:text-(--ob-reader-text) aria-[current=page]:bg-(--ob-reader-accent-soft) aria-[current=page]:font-[650] aria-[current=page]:text-(--ob-reader-accent) ${readerFocus}`} to={pageHref(basePath, node.page.slug)} aria-current={currentSlug === node.page.slug ? "page" : undefined} onClick={close}>{node.page.title}</Link>;
  if (!node.children.length) return <li className="site-reader-navigation-item min-w-0" style={{ "--ob-reader-tree-depth": depth } as React.CSSProperties}>{link}</li>;
  const containsCurrent = (branch: NavigationNode): boolean => branch.page.slug === currentSlug || branch.children.some(containsCurrent);
  return <li className="site-reader-navigation-branch relative min-w-0" style={{ "--ob-reader-tree-depth": depth } as React.CSSProperties}>
    <details className="[&[open]>summary>svg]:rotate-90" open={containsCurrent(node) || undefined}>
      <summary aria-label={`${node.page.title} 的子页面`} className={`grid h-[calc(var(--ob-prose-caption-size)*1.45+14px)] cursor-pointer list-none grid-cols-[14px_minmax(0,1fr)] items-center [&::-webkit-details-marker]:hidden ${readerFocus}`}><ChevronRight aria-hidden="true" size={14} className="text-(--ob-reader-muted) transition-transform duration-[140ms] ease-[ease] motion-reduce:transition-none" /></summary>
      <ul className="m-0 ml-1.5 list-none border-l border-(--ob-reader-border) p-0">{node.children.map((child) => <NavigationBranch key={child.page.slug} node={child} currentSlug={currentSlug} basePath={basePath} depth={depth + 1} close={close} />)}</ul>
    </details>
    {/* 父文档链接与展开控件分开，收起分支时仍可打开父文档。 */}
    <span className="absolute top-0 right-0 left-3.5 [&>a]:pl-[calc(2px+var(--ob-reader-tree-depth)*14px)]">{link}</span>
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
  const drawerFocusable = () => Array.from(drawerRef.current?.querySelectorAll<HTMLElement>("a[href], summary, button:not([disabled]), [tabindex]:not([tabindex='-1'])") ?? [])
    .filter((element) => !element.closest("details:not([open]) > :not(summary)"));

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
    {open ? <button type="button" className="site-reader-navigation-scrim fixed inset-[var(--ob-reader-header-height)_0_0] z-[38] hidden cursor-pointer border-0 bg-(--ob-reader-drawer-scrim) [@media(max-width:800px)]:block" aria-label="收起站点导航" onClick={close} /> : null}
    <aside ref={drawerRef} id="site-navigation" className={`site-reader-navigation sticky top-(--ob-reader-header-height) flex h-[calc(100dvh-var(--ob-reader-header-height))] flex-col self-start overflow-auto pt-[30px] pr-2 pb-[22px] [@media(max-width:800px)]:fixed [@media(max-width:800px)]:bottom-0 [@media(max-width:800px)]:left-0 [@media(max-width:800px)]:z-[39] [@media(max-width:800px)]:w-[min(310px,86vw)] [@media(max-width:800px)]:border-r [@media(max-width:800px)]:border-(--ob-reader-border) [@media(max-width:800px)]:bg-(--ob-reader-surface) [@media(max-width:800px)]:px-[18px] [@media(max-width:800px)]:py-6 [@media(max-width:800px)]:[box-shadow:var(--ob-reader-drawer-shadow)] ${open ? "is-open [@media(max-width:800px)]:flex" : "[@media(max-width:800px)]:hidden"}`} role={modal && open ? "dialog" : undefined} aria-modal={modal && open ? "true" : undefined} aria-label={modal && open ? "站点导航抽屉" : "站点目录"} onKeyDown={(event) => {
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
      {description ? <p className="site-reader-navigation-intro mx-2.5 mt-0 mb-7 text-[length:var(--ob-prose-caption-size)] leading-[1.8] text-(--ob-reader-muted)">{description}</p> : null}
      <nav aria-label="站点导航">
        {sections.map((section, index) => <section className="mb-[25px]" key={`${section.label}-${index}`}>
          <h2 className="mx-2.5 mt-0 mb-[9px] text-[length:var(--text-sm)] font-[680] tracking-[.01em] text-(--ob-reader-text)">{section.label}</h2>
          <ul className="m-0 list-none p-0">{section.nodes.map((node) => <NavigationBranch key={node.page.slug} node={node} currentSlug={currentSlug} basePath={basePath} depth={0} close={close} />)}</ul>
        </section>)}
      </nav>
      <footer className="site-reader-navigation-footer mt-auto flex flex-wrap gap-3 border-t border-(--ob-reader-border) px-2.5 pt-[25px] pb-0.5 text-[length:var(--ob-prose-caption-size)] text-(--ob-reader-muted)">
        {footerLinks.map((link) => <ManagedContentLink key={`${link.label}-${link.url}`} reference={link.url} fallback={link.url} className={`hover:text-(--ob-reader-accent) ${readerFocus}`}>{link.label}</ManagedContentLink>)}
        <OrbisAttribution appearance="provider" />
      </footer>
    </aside>
  </>;
}

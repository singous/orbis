import { ChevronRight } from "lucide-react";
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

export function Navigation({ sections, currentSlug, basePath, open, close, description, footerLinks }: {
  sections: NavigationSection[];
  currentSlug?: string;
  basePath: string;
  open: boolean;
  close: () => void;
  description?: string;
  footerLinks: SiteBranding["footer_links"];
}) {
  return <>
    {open ? <button type="button" className="site-reader-navigation-scrim" aria-label="收起站点导航" onClick={close} /> : null}
    <aside id="site-navigation" className={`site-reader-navigation${open ? " is-open" : ""}`}>
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

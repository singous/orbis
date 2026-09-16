import { BookOpen, Menu, Monitor, Moon, Search, Sun, X } from "lucide-react";
import type { RefObject } from "react";
import { Link } from "react-router-dom";

import { ManagedContentImage, ManagedContentLink } from "../../content/ContentMedia";
import type { SiteBranding } from "../schemas";

export type ReaderThemeMode = "system" | "light" | "dark";

const THEME_LABELS: Record<ReaderThemeMode, string> = { system: "跟随系统", light: "浅色", dark: "深色" };
const NEXT_THEME: Record<ReaderThemeMode, ReaderThemeMode> = { system: "light", light: "dark", dark: "system" };

export function Header({ name, basePath, logoUrl, links, cta, sections, currentSection, themeMode, onThemeChange, onSearch, searchButtonRef, navigationButtonRef, navigationOpen, onNavigationToggle }: {
  name: string;
  basePath: string;
  logoUrl: string | null;
  links: SiteBranding["links"];
  cta: SiteBranding["cta"];
  sections: Array<{ label: string; slug: string }>;
  currentSection?: string | null;
  themeMode: ReaderThemeMode;
  onThemeChange: (mode: ReaderThemeMode) => void;
  onSearch: () => void;
  searchButtonRef: RefObject<HTMLButtonElement | null>;
  navigationButtonRef: RefObject<HTMLButtonElement | null>;
  navigationOpen: boolean;
  onNavigationToggle: () => void;
}) {
  const nextTheme = NEXT_THEME[themeMode];
  const themeActionLabel = themeMode === "light" ? "切换深色主题" : themeMode === "dark" ? "切换跟随系统主题" : "当前跟随系统主题，切换为浅色主题";
  const ThemeIcon = themeMode === "system" ? Monitor : themeMode === "light" ? Sun : Moon;
  const brandMark = <span className="site-reader-brand-mark"><BookOpen aria-hidden="true" size={17} /></span>;
  return <header className="site-reader-header">
    <div className="site-reader-header-main">
      <Link to={basePath} className="site-reader-brand">
        {logoUrl ? <ManagedContentImage reference={logoUrl} fallback={logoUrl} alt="" unavailable={brandMark} /> : brandMark}
        <span>{name}</span>
      </Link>
      <button ref={searchButtonRef} type="button" className="site-reader-search-trigger" aria-label="搜索文档" onClick={onSearch}>
        <Search aria-hidden="true" size={15} /><span>搜索文档</span><kbd>⌘ K</kbd>
      </button>
      <div className="site-reader-header-links">
        {links.map((link) => <ManagedContentLink key={`${link.label}-${link.url}`} reference={link.url} fallback={link.url}>{link.label}</ManagedContentLink>)}
        {cta ? <ManagedContentLink className="site-reader-cta" reference={cta.url} fallback={cta.url}>{cta.label}</ManagedContentLink> : null}
        <button type="button" className="site-reader-icon-button" aria-label={themeActionLabel} title={`主题：${THEME_LABELS[themeMode]}，下一项：${THEME_LABELS[nextTheme]}`} onClick={() => onThemeChange(nextTheme)}><ThemeIcon aria-hidden="true" size={17} /></button>
        <button ref={navigationButtonRef} type="button" className="site-reader-icon-button site-reader-menu-toggle" aria-label={navigationOpen ? "关闭站点导航" : "打开站点导航"} aria-expanded={navigationOpen} aria-controls="site-navigation" onClick={onNavigationToggle}>{navigationOpen ? <X aria-hidden="true" size={20} /> : <Menu aria-hidden="true" size={20} />}</button>
      </div>
    </div>
    {sections.length ? <nav className="site-reader-sections" aria-label="文档栏目">
      {sections.map((section) => <Link key={section.label} to={`${basePath}/${encodeURIComponent(section.slug)}`} aria-current={section.label === currentSection ? "page" : undefined}>{section.label}</Link>)}
    </nav> : null}
  </header>;
}

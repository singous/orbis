import { Button, buttonVariants } from "@orbis/ui/button";
import { readerFocus } from "./chrome";
import { BookOpen, Menu, Monitor, Moon, Search, Sun, X } from "../../../shared/ui/icons";
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
  const brandMark = <span className="site-reader-brand-mark grid size-[29px] shrink-0 place-items-center rounded-lg bg-(--ob-reader-accent) text-primary-foreground [box-shadow:var(--ob-reader-brand-shadow)]"><BookOpen aria-hidden="true" size={18} /></span>;
  return <header className="site-reader-header sticky top-0 z-40 border-b border-(--ob-reader-border) bg-(--ob-reader-background)">
    <div className="site-reader-header-main mx-auto grid min-h-[70px] w-[min(100%-48px,1392px)] grid-cols-[minmax(220px,1fr)_minmax(280px,390px)_minmax(220px,1fr)] items-center gap-7 [@media(max-width:1180px)]:w-[min(100%-40px,1130px)] [@media(max-width:1180px)]:grid-cols-[minmax(190px,.8fr)_minmax(260px,350px)_minmax(190px,.8fr)] [@media(max-width:1180px)]:gap-5 [@media(max-width:800px)]:flex [@media(max-width:800px)]:min-h-[62px] [@media(max-width:800px)]:w-full [@media(max-width:800px)]:gap-3 [@media(max-width:800px)]:px-[17px]">
      <Link to={basePath} className={`site-reader-brand flex min-w-0 items-center gap-2.5 text-[length:var(--ob-prose-body-size)] font-[680] tracking-[-.02em] [@media(max-width:800px)]:flex-1 [&_img]:h-7 [&_img]:w-auto [&_img]:max-w-[132px] [&_img]:object-contain ${readerFocus}`}>
        {logoUrl ? <ManagedContentImage reference={logoUrl} fallback={logoUrl} alt="" unavailable={brandMark} /> : brandMark}
        <span className="truncate">{name}</span>
      </Link>
      <Button ref={searchButtonRef} type="button" className="site-reader-search-trigger w-full min-w-0 justify-start [@media(max-width:800px)]:w-auto [@media(max-width:800px)]:shrink-0" aria-label="搜索文档 ⌘ K" aria-keyshortcuts="Meta+K Control+K" onClick={onSearch} variant="outline">
        <Search aria-hidden="true" size={16} /><span className="flex-1 text-left text-[length:var(--ob-prose-body-size)] [@media(max-width:800px)]:hidden">搜索文档</span><kbd aria-hidden="true" className="rounded-[5px] border border-(--ob-reader-border) bg-(--ob-reader-surface-soft) px-1.5 py-0.5 font-mono text-[length:var(--ob-prose-caption-size)] leading-[1.4] text-(--ob-reader-muted-on-soft) [@media(max-width:800px)]:hidden">⌘ K</kbd>
      </Button>
      <div className="site-reader-header-links flex min-w-0 items-center justify-end gap-[18px] text-[length:var(--ob-prose-caption-size)] text-(--ob-reader-muted) [@media(max-width:800px)]:gap-[3px]">
        {links.map((link) => <ManagedContentLink key={`${link.label}-${link.url}`} reference={link.url} fallback={link.url} className={`hover:text-(--ob-reader-text) [@media(max-width:1180px)]:hidden ${readerFocus}`}>{link.label}</ManagedContentLink>)}
        {cta ? <ManagedContentLink className={`${buttonVariants()} site-reader-cta [@media(max-width:800px)]:hidden`} reference={cta.url} fallback={cta.url}>{cta.label}</ManagedContentLink> : null}
        <Button type="button" className="site-reader-icon-button" size="icon-sm" aria-label={themeActionLabel} title={`主题：${THEME_LABELS[themeMode]}，下一项：${THEME_LABELS[nextTheme]}`} onClick={() => onThemeChange(nextTheme)} variant="ghost"><ThemeIcon aria-hidden="true" size={18} /></Button>
        <Button ref={navigationButtonRef} type="button" className="site-reader-icon-button site-reader-menu-toggle hidden [@media(max-width:800px)]:inline-flex" size="icon-sm" aria-label={navigationOpen ? "关闭站点导航" : "打开站点导航"} aria-expanded={navigationOpen} aria-controls="site-navigation" onClick={onNavigationToggle} variant="ghost">{navigationOpen ? <X aria-hidden="true" size={20} /> : <Menu aria-hidden="true" size={20} />}</Button>
      </div>
    </div>
    {sections.length ? <nav className="site-reader-sections mx-auto flex h-[43px] w-[min(100%-48px,1392px)] items-end gap-7 overflow-x-auto [@media(max-width:1180px)]:w-[min(100%-40px,1130px)] [@media(max-width:800px)]:h-10 [@media(max-width:800px)]:w-full [@media(max-width:800px)]:gap-[22px] [@media(max-width:800px)]:px-[17px]" aria-label="文档栏目">
      {sections.map((section) => <Link key={section.label} to={`${basePath}/${encodeURIComponent(section.slug)}`} className={`flex h-[43px] items-center border-b-2 border-transparent text-[length:var(--ob-prose-caption-size)] whitespace-nowrap text-(--ob-reader-muted) hover:text-(--ob-reader-text) aria-[current=page]:border-(--ob-reader-accent) aria-[current=page]:font-[650] aria-[current=page]:text-(--ob-reader-text) [@media(max-width:800px)]:h-10 ${readerFocus}`} aria-current={section.label === currentSection ? "page" : undefined}>{section.label}</Link>)}
    </nav> : null}
  </header>;
}

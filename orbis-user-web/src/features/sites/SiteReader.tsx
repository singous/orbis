import { ArrowLeft, ArrowRight, BookOpen, Check, Copy, Link2 } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { Link, Navigate } from "react-router-dom";

import { ContentRenderer, contentOutline, safeContentUrl } from "../content/ContentRenderer";
import { SITE_KINDS, type PublishedPage, type SiteBranding, type SiteSnapshot } from "./schemas";
import { Header, type ReaderThemeMode } from "./reader/Header";
import { Navigation } from "./reader/Navigation";
import { Outline } from "./reader/Outline";
import { SearchDialog } from "./reader/SearchDialog";
import { navigationSections, pageAncestors, pageHref, resolveRedirect, topSections } from "./reader/reader-model";
import "../../styles/site-reader.css";

const THEME_STORAGE_KEY = "orbis-reader-theme";
const DEFAULT_BRANDING: SiteBranding = { logo_url: null, links: [], footer_links: [], cta: null, theme: "light" };

function storedTheme(fallback: ReaderThemeMode): ReaderThemeMode {
  try {
    const value = localStorage.getItem(THEME_STORAGE_KEY);
    return value === "system" || value === "light" || value === "dark" ? value : fallback;
  } catch {
    return fallback;
  }
}

function useEffectiveTheme(mode: ReaderThemeMode): "light" | "dark" {
  const [systemTheme, setSystemTheme] = useState<"light" | "dark">(() => typeof window.matchMedia === "function" && window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");
  useEffect(() => {
    if (typeof window.matchMedia !== "function") return;
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const update = () => setSystemTheme(media.matches ? "dark" : "light");
    update();
    media.addEventListener?.("change", update);
    return () => media.removeEventListener?.("change", update);
  }, []);
  return mode === "system" ? systemTheme : mode;
}

function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(() => typeof window.matchMedia === "function" && window.matchMedia(query).matches);
  useEffect(() => {
    if (typeof window.matchMedia !== "function") return;
    const media = window.matchMedia(query);
    const update = () => setMatches(media.matches);
    update();
    media.addEventListener?.("change", update);
    return () => media.removeEventListener?.("change", update);
  }, [query]);
  return matches;
}

async function pageMarkdown(page: PublishedPage): Promise<string> {
  const document = page.blocks as { schema_version?: number; blocks?: unknown[]; doc?: unknown };
  if (document.schema_version === 2 && Array.isArray(document.blocks)) {
    const { v2ToMarkdown } = await import("../notes/block-model");
    return `# ${page.title}\n\n${v2ToMarkdown(document.blocks as Parameters<typeof v2ToMarkdown>[0])}`.trim();
  }
  if (document.doc && typeof document.doc === "object") {
    const { tiptapDocToMarkdown } = await import("../notes/markdown-contract");
    return `# ${page.title}\n\n${tiptapDocToMarkdown(document.doc as Parameters<typeof tiptapDocToMarkdown>[0])}`.trim();
  }
  return `# ${page.title}\n\n${page.plain_text}`.trim();
}

function safeBranding(branding?: SiteBranding): SiteBranding {
  const value = branding ?? DEFAULT_BRANDING;
  const links = value.links.filter((link) => Boolean(safeContentUrl(link.url)));
  const footerLinks = value.footer_links.filter((link) => Boolean(safeContentUrl(link.url)));
  const cta = value.cta && safeContentUrl(value.cta.url) ? value.cta : null;
  return { ...value, logo_url: safeContentUrl(value.logo_url, true), links, footer_links: footerLinks, cta };
}

function formatDate(timestamp?: number | null): string | null {
  return timestamp ? new Date(timestamp).toLocaleDateString("zh-CN", { timeZone: "Asia/Shanghai", year: "numeric", month: "long", day: "numeric" }) : null;
}

export function SiteReader({ snapshot, basePath, pageSlug, preview = false }: {
  snapshot: SiteSnapshot;
  basePath: string;
  pageSlug?: string;
  preview?: boolean;
}) {
  const branding = useMemo(() => safeBranding(snapshot.branding), [snapshot.branding]);
  const [navigationOpen, setNavigationOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [themeMode, setThemeMode] = useState<ReaderThemeMode>(() => storedTheme(branding.theme));
  const [copyState, setCopyState] = useState<"link" | "page" | null>(null);
  const searchButtonRef = useRef<HTMLButtonElement>(null);
  const theme = useEffectiveTheme(themeMode);
  const compactOutline = useMediaQuery("(max-width: 1180px)");
  const redirectTarget = resolveRedirect(pageSlug, snapshot.redirects);
  const currentIndex = pageSlug ? snapshot.pages.findIndex((page) => page.slug === pageSlug) : 0;
  const current = snapshot.pages[currentIndex];
  const outline = useMemo(() => current ? contentOutline(current.blocks, current.title) : [], [current]);
  const sections = useMemo(() => navigationSections(snapshot.pages), [snapshot.pages]);
  const headerSections = useMemo(() => topSections(snapshot.pages), [snapshot.pages]);
  const ancestors = useMemo(() => current ? pageAncestors(snapshot.pages, current) : [], [current, snapshot.pages]);

  const closeSearch = useCallback(() => {
    setSearchOpen(false);
    window.setTimeout(() => searchButtonRef.current?.focus(), 0);
  }, []);

  useEffect(() => {
    const openSearch = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLocaleLowerCase() === "k") {
        event.preventDefault();
        setSearchOpen(true);
      }
    };
    window.addEventListener("keydown", openSearch);
    return () => window.removeEventListener("keydown", openSearch);
  }, []);

  useEffect(() => {
    setNavigationOpen(false);
    setSearchOpen(false);
    setCopyState(null);
  }, [pageSlug]);

  useEffect(() => {
    const previous = document.title;
    document.title = `${current?.title || "文档"} · ${snapshot.name}`;
    return () => { document.title = previous; };
  }, [current?.title, snapshot.name]);

  function changeTheme(mode: ReaderThemeMode) {
    setThemeMode(mode);
    try { localStorage.setItem(THEME_STORAGE_KEY, mode); } catch { /* Reading remains available without storage. */ }
  }

  async function copyLink() {
    if (!current) return;
    const url = new URL(pageHref(basePath, current.slug), window.location.href).href;
    await navigator.clipboard?.writeText(url);
    setCopyState("link");
  }

  async function copyPage() {
    if (!current) return;
    await navigator.clipboard?.writeText(await pageMarkdown(current));
    setCopyState("page");
  }

  if (redirectTarget && redirectTarget !== pageSlug) return <Navigate replace to={pageHref(basePath, redirectTarget)} />;

  const updatedAt = current?.updated_at_ms ?? snapshot.published_at_ms;
  return <div className={`site-reader${headerSections.length ? " has-site-sections" : ""}`} data-theme={theme} data-theme-mode={themeMode} style={{ "--site-accent": snapshot.accent_color } as CSSProperties}>
    <a className="site-reader-skip-link" href="#site-content">跳转到正文</a>
    {preview ? <div className="site-reader-preview-banner">发布预览 · 此页面只有工作空间成员可见</div> : null}
    <Header name={snapshot.name} basePath={basePath} logoUrl={branding.logo_url} links={branding.links} cta={branding.cta} sections={headerSections} currentSection={current?.section} themeMode={themeMode} onThemeChange={changeTheme} onSearch={() => setSearchOpen(true)} searchButtonRef={searchButtonRef} navigationOpen={navigationOpen} onNavigationToggle={() => setNavigationOpen((open) => !open)} />
    <div className="site-reader-layout">
      <Navigation sections={sections} currentSlug={current?.slug} basePath={basePath} open={navigationOpen} close={() => setNavigationOpen(false)} description={snapshot.description} footerLinks={branding.footer_links} />
      <main id="site-content" className="site-reader-content">
        {current ? <>
          <nav className="site-reader-breadcrumb" aria-label="面包屑">
            <span>{current.section || current.group || SITE_KINDS[snapshot.site_kind].label}</span>
            {ancestors.map((page) => <Link key={page.slug} to={pageHref(basePath, page.slug)}>{page.title}</Link>)}
            <span aria-current="page">{current.title}</span>
          </nav>
          <div className="site-reader-title-row">
            <div><h1>{current.title}</h1>{current.description ? <p>{current.description}</p> : null}</div>
            <div className="site-reader-copy-actions">
              <button type="button" onClick={() => void copyLink()}>{copyState === "link" ? <Check aria-hidden="true" size={15} /> : <Link2 aria-hidden="true" size={15} />}<span>{copyState === "link" ? "已复制" : "复制链接"}</span></button>
              <button type="button" onClick={() => void copyPage()}>{copyState === "page" ? <Check aria-hidden="true" size={15} /> : <Copy aria-hidden="true" size={15} />}<span>{copyState === "page" ? "已复制" : "复制页面"}</span></button>
            </div>
          </div>
          {compactOutline ? <Outline items={outline} mobile /> : null}
          <ContentRenderer blocks={current.blocks} pageTitle={current.title} />
          <nav className="site-reader-pagination" aria-label="相邻文档">
            {currentIndex > 0 ? <Link to={pageHref(basePath, snapshot.pages[currentIndex - 1].slug)}><ArrowLeft aria-hidden="true" size={17} /><span><small>上一篇</small>{snapshot.pages[currentIndex - 1].title}</span></Link> : <span />}
            {currentIndex < snapshot.pages.length - 1 ? <Link to={pageHref(basePath, snapshot.pages[currentIndex + 1].slug)}><span><small>下一篇</small>{snapshot.pages[currentIndex + 1].title}</span><ArrowRight aria-hidden="true" size={17} /></Link> : null}
          </nav>
          {updatedAt ? <footer className="site-reader-page-footer">最后更新于 {formatDate(updatedAt)}</footer> : null}
        </> : <div className="site-reader-empty"><BookOpen aria-hidden="true" size={30} /><h1>{snapshot.pages.length ? "页面不存在" : "还没有文档"}</h1><p>{snapshot.pages.length ? "这个地址可能已经变更，请从目录查找文档。" : "选择一些文档，开始建立你的站点。"}</p><Link to={basePath}>返回文档首页</Link></div>}
      </main>
      {current && !compactOutline ? <Outline items={outline} /> : null}
    </div>
    {searchOpen ? <SearchDialog pages={snapshot.pages} basePath={basePath} close={closeSearch} /> : null}
  </div>;
}

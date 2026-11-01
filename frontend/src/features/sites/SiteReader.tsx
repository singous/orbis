import { useMediaQuery } from "../../shared/platform/use-media-query";
import { controlFeedbackClassName } from "../../shared/ui/control-styles";
import { reportError } from "../../shared/api/request-feedback";
import { LoadingState } from "../../shared/ui/LoadingState";
import { Button } from "@orbis/ui/button";
import { readerFocus, readerTouchTarget } from "./reader/chrome";
import { ArrowLeft, ArrowRight, BookOpen, Check, Copy, Link2 } from "../../shared/ui/icons";
import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { Link, Navigate } from "react-router-dom";
import { showToast } from "../../shared/ui/Toast";

import { ContentRenderer, contentOutline, safeContentUrl } from "../content/ContentRenderer";
import { parseFileReference } from "../files/managed-files";
import { SITE_KINDS, type PublishedPage, type SiteBranding, type SiteSnapshot } from "./schemas";
import { Header, type ReaderThemeMode } from "./reader/Header";
import { Navigation } from "./reader/Navigation";
import { Outline } from "./reader/Outline";
import { SearchDialog } from "./reader/SearchDialog";
import { SitePreviewLinks } from "./SitePreviewLinks";
import { useReaderMetadata } from "./reader/head-metadata";
import { navigationSections, pageAncestors, pageHref, resolveRedirect, topSections } from "./reader/reader-model";
import "../../styles/site-reader.css";
import "./reader/theme.css";

const copyButtonClassName = `flex h-[34px] cursor-pointer items-center gap-[7px] rounded-ob-xl border-0 border-r border-current border-r-(--ob-reader-border) bg-transparent px-2.5 py-0 text-[length:var(--ob-prose-caption-size)] text-(--ob-reader-muted) last:border-r-0 last:border-r-current hover:bg-(--ob-reader-surface-soft) hover:text-(--ob-reader-text) disabled:cursor-not-allowed disabled:opacity-45 data-disabled:opacity-45 max-[420px]:w-[38px] max-[420px]:justify-center ${controlFeedbackClassName} ${readerFocus} ${readerTouchTarget}`;
const paginationLinkClassName = `flex min-w-0 items-center gap-3 rounded-[9px] border border-transparent p-3 text-[length:var(--ob-prose-caption-size)] leading-[1.5] text-(--ob-reader-text) hover:border-(--ob-reader-border) hover:bg-(--ob-reader-surface-soft) [@media(max-width:800px)]:px-[5px] [@media(max-width:800px)]:py-[9px] ${readerFocus}`;

const THEME_STORAGE_KEY = "orbis-reader-theme";
const DEFAULT_BRANDING: SiteBranding = { logo_url: null, links: [], footer_links: [], cta: null, theme: "light" };
type CopyFeedback = { action: "link" | "page"; status: "success" | "error" };

function storedTheme(fallback: ReaderThemeMode): ReaderThemeMode {
  try {
    const value = localStorage.getItem(THEME_STORAGE_KEY);
    return value === "system" || value === "light" || value === "dark" ? value : fallback;
  } catch {
    return fallback;
  }
}

async function pageMarkdown(page: PublishedPage): Promise<string> {
  const document = page.blocks as { schema_version?: number; blocks?: unknown[]; doc?: unknown };
  if (document.schema_version === 2 && Array.isArray(document.blocks)) {
    const { v2ToMarkdown } = await import("../content/blocks");
    return `# ${page.title}\n\n${v2ToMarkdown(document.blocks as Parameters<typeof v2ToMarkdown>[0])}`.trim();
  }
  if (document.doc && typeof document.doc === "object") {
    const { tiptapDocToMarkdown } = await import("../content/codecs/markdown");
    return `# ${page.title}\n\n${tiptapDocToMarkdown(document.doc as Parameters<typeof tiptapDocToMarkdown>[0])}`.trim();
  }
  return `# ${page.title}\n\n${page.plain_text}`.trim();
}

function safeBranding(branding: SiteBranding | undefined, preview: boolean): SiteBranding {
  const value = branding ?? DEFAULT_BRANDING;
  const safe = (url: string | null, media = false) => safeContentUrl(url, media) ?? (preview && url && parseFileReference(url) ? url : null);
  const links = value.links.filter((link) => Boolean(safe(link.url)));
  const footerLinks = value.footer_links.filter((link) => Boolean(safe(link.url)));
  const cta = value.cta && safe(value.cta.url) ? value.cta : null;
  return { ...value, logo_url: safe(value.logo_url, true), links, footer_links: footerLinks, cta };
}

function formatDate(timestamp?: number | null): string | null {
  return timestamp != null ? new Date(timestamp).toLocaleDateString("zh-CN", { timeZone: "Asia/Shanghai", year: "numeric", month: "long", day: "numeric" }) : null;
}

export function SiteReader({ snapshot, basePath, pageSlug, preview = false, loadSearch, loadMarkdown, contentState, canonicalBasePath }: {
  snapshot: SiteSnapshot;
  basePath: string;
  pageSlug?: string;
  preview?: boolean;
  loadSearch?: (query:string,signal?:AbortSignal) => Promise<PublishedPage[]>;
  loadMarkdown?: (slug: string) => Promise<string>;
  contentState?: { loading: boolean; error?: string; retry: () => void };
  canonicalBasePath?: string;
}) {
  const branding = useMemo(() => safeBranding(snapshot.branding, preview), [snapshot.branding, preview]);
  const [navigationOpen, setNavigationOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [themeMode, setThemeMode] = useState<ReaderThemeMode>(() => storedTheme(branding.theme));
  const [copyFeedback, setCopyFeedback] = useState<CopyFeedback | null>(null);
  const searchButtonRef = useRef<HTMLButtonElement>(null);
  const navigationButtonRef = useRef<HTMLButtonElement>(null);
  const systemDark = useMediaQuery("(prefers-color-scheme: dark)");
  const theme = themeMode === "system" ? systemDark ? "dark" : "light" : themeMode;
  const compactOutline = useMediaQuery("(max-width: 1180px)");
  const mobileNavigation = useMediaQuery("(max-width: 800px)");
  const redirectTarget = resolveRedirect(pageSlug, snapshot.redirects);
  const currentIndex = pageSlug ? snapshot.pages.findIndex((page) => page.slug === pageSlug) : 0;
  const current = snapshot.pages[currentIndex];
  const outline = useMemo(() => current ? contentOutline(current.blocks, current.title) : [], [current]);
  const sections = useMemo(() => navigationSections(snapshot.pages), [snapshot.pages]);
  const headerSections = useMemo(() => topSections(snapshot.pages), [snapshot.pages]);
  const ancestors = useMemo(() => current ? pageAncestors(snapshot.pages, current) : [], [current, snapshot.pages]);

  const closeSearch = useCallback(() => {
    setSearchOpen(false);
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
    setCopyFeedback(null);
    if (!window.location.hash && (window.scrollY || window.scrollX)) window.scrollTo(0, 0);
  }, [pageSlug]);

  useReaderMetadata(`${current?.title || "文档"} · ${snapshot.name}`, current?.description || snapshot.description,
    canonicalBasePath && current ? pageHref(canonicalBasePath, current.slug) : undefined, preview || !current);

  function changeTheme(mode: ReaderThemeMode) {
    setThemeMode(mode);
    try { localStorage.setItem(THEME_STORAGE_KEY, mode); } catch { /* Reading remains available without storage. */ }
  }

  async function writeClipboard(action: CopyFeedback["action"], value: string) {
    if (!navigator.clipboard?.writeText) {
      setCopyFeedback({ action, status: "error" });
      reportError(action === "link" ? "请从地址栏手动复制。" : "请手动选择页面正文。");
      return;
    }
    try {
      await navigator.clipboard.writeText(value);
      setCopyFeedback({ action, status: "success" });
      showToast({ title: action === "link" ? "链接已复制" : "页面 Markdown 已复制", tone: "success" });
    } catch {
      setCopyFeedback({ action, status: "error" });
      reportError("请检查浏览器权限后重试。");
    }
  }

  async function copyLink() {
    if (!current) return;
    const url = new URL(pageHref(canonicalBasePath || basePath, current.slug), window.location.href).href;
    await writeClipboard("link", url);
  }

  async function copyPage() {
    if (!current) return;
    try {
      await writeClipboard("page", loadMarkdown ? await loadMarkdown(current.slug) : await pageMarkdown(current));
    } catch (error) {
      setCopyFeedback({ action: "page", status: "error" });
      reportError(error);
    }
  }

  if (redirectTarget && redirectTarget !== pageSlug) return <Navigate replace to={pageHref(basePath, redirectTarget)} />;

  const updatedAt = current?.updated_at_ms ?? snapshot.published_at_ms;
  const reader = <div className={`site-reader min-h-dvh bg-(--ob-reader-background) font-ob-sans text-(--ob-reader-text) [&_a]:no-underline ${headerSections.length ? "has-site-sections" : ""}`} data-theme={theme} data-theme-mode={themeMode} style={{ "--site-accent": snapshot.accent_color } as CSSProperties}>
    <nav aria-label="页面跳转"><a className={`site-reader-skip-link fixed top-[-80px] left-[18px] z-[100] rounded-lg border border-(--ob-reader-accent) bg-(--ob-reader-surface) px-3.5 py-2.5 text-[length:var(--ob-prose-body-size)] focus:top-3 ${readerFocus}`} href="#site-content">跳转到正文</a></nav>
    {preview ? <div role="region" aria-label="发布预览说明" className="site-reader-preview-banner relative z-[45] bg-(--ob-reader-accent-soft) px-5 py-[9px] text-center text-[length:var(--ob-prose-caption-size)] font-semibold text-(--ob-reader-accent)">发布预览 · 此页面只有工作空间成员可见</div> : null}
    <Header name={snapshot.name} basePath={basePath} logoUrl={branding.logo_url} links={branding.links} cta={branding.cta} sections={headerSections} currentSection={current?.section} themeMode={themeMode} onThemeChange={changeTheme} onSearch={() => setSearchOpen(true)} searchButtonRef={searchButtonRef} navigationButtonRef={navigationButtonRef} navigationOpen={navigationOpen} onNavigationToggle={() => setNavigationOpen((open) => !open)} />
    <div className="site-reader-layout mx-auto grid w-[min(100%-48px,1392px)] grid-cols-[238px_minmax(0,1fr)_192px] gap-[42px] [@media(max-width:1180px)]:w-[min(100%-40px,1130px)] [@media(max-width:1180px)]:grid-cols-[218px_minmax(0,1fr)] [@media(max-width:1180px)]:gap-[34px] [@media(max-width:800px)]:block [@media(max-width:800px)]:w-full">
      <Navigation sections={sections} currentSlug={current?.slug} basePath={basePath} open={navigationOpen} close={() => setNavigationOpen(false)} description={snapshot.description} footerLinks={branding.footer_links} modal={mobileNavigation} returnFocusRef={navigationButtonRef} />
      <main id="site-content" className="site-reader-content w-[min(100%,760px)] min-w-0 justify-self-center pt-[45px] pb-[76px] [@media(max-width:800px)]:w-full [@media(max-width:800px)]:px-5 [@media(max-width:800px)]:pt-[30px] [@media(max-width:800px)]:pb-[60px]">
        {current ? <>
          <nav className="site-reader-breadcrumb mb-[13px] flex flex-wrap items-center gap-[7px] text-[length:var(--ob-prose-caption-size)] text-(--ob-reader-muted) [&>*:not(:last-child)]:after:ml-[7px] [&>*:not(:last-child)]:after:text-(--ob-reader-border) [&>*:not(:last-child)]:after:content-['/']" aria-label="面包屑">
            <span className="font-[650] text-(--ob-reader-accent)">{current.section || current.group || SITE_KINDS[snapshot.site_kind].label}</span>
            {ancestors.map((page) => <Link className={`hover:text-(--ob-reader-text) ${readerFocus}`} key={page.slug} to={pageHref(basePath, page.slug)}>{page.title}</Link>)}
            <span aria-current="page">{current.title}</span>
          </nav>
          <div className="site-reader-title-row mb-[35px] flex items-start justify-between gap-7 [@media(max-width:800px)]:mb-7 [@media(max-width:800px)]:block">
            <div><h1 className="m-0 text-[length:var(--ob-prose-title-size)] leading-[1.5] font-[720] tracking-[-.025em] text-(--ob-reader-text)">{current.title}</h1>{current.description ? <p className="mt-[13px] mb-0 max-w-[590px] text-[length:var(--ob-prose-body-size)] leading-[1.7] text-(--ob-reader-muted) [@media(max-width:800px)]:mt-2.5">{current.description}</p> : null}</div>
            <div className="site-reader-copy-area grid shrink-0 justify-items-end gap-[7px] [@media(max-width:800px)]:mt-[18px] [@media(max-width:800px)]:w-max [@media(max-width:800px)]:justify-items-start">
              <div className="site-reader-copy-actions mt-px flex shrink-0 overflow-hidden rounded-[9px] border border-(--ob-reader-border) bg-(--ob-reader-surface) [box-shadow:var(--ob-reader-subtle-shadow)] [@media(max-width:800px)]:w-max">
                <Button appearance="unstyled" type="button" className={copyButtonClassName} aria-label={copyFeedback?.action === "link" && copyFeedback.status === "success" ? "链接已复制" : "复制链接"} onClick={() => void copyLink()}>{copyFeedback?.action === "link" && copyFeedback.status === "success" ? <Check aria-hidden="true" size={16} /> : <Link2 aria-hidden="true" size={16} />}<span className="max-[420px]:hidden">{copyFeedback?.action === "link" && copyFeedback.status === "success" ? "已复制" : "复制链接"}</span></Button>
                <Button appearance="unstyled" type="button" className={copyButtonClassName} disabled={contentState?.loading || Boolean(contentState?.error)} aria-label={copyFeedback?.action === "page" && copyFeedback.status === "success" ? "页面 Markdown 已复制" : "复制页面"} onClick={() => void copyPage()}>{copyFeedback?.action === "page" && copyFeedback.status === "success" ? <Check aria-hidden="true" size={16} /> : <Copy aria-hidden="true" size={16} />}<span className="max-[420px]:hidden">{copyFeedback?.action === "page" && copyFeedback.status === "success" ? "已复制" : "复制页面"}</span></Button>
              </div>
            </div>
          </div>
          {compactOutline ? <Outline items={outline} mobile /> : null}
          {contentState?.loading ? <LoadingState label="正在加载正文…" variant="editor" /> : contentState?.error ? <div className="site-reader-body-status min-h-[35vh] py-[30px] text-[length:var(--ob-prose-body-size)] text-(--ob-reader-muted)"><Button appearance="unstyled" type="button" className={`cursor-pointer rounded-ob-xl border border-(--ob-reader-border) bg-(--ob-reader-surface) px-[11px] py-[7px] text-(--ob-reader-text) ${controlFeedbackClassName} ${readerFocus}`} onClick={contentState.retry}>重新加载正文</Button></div> : <ContentRenderer blocks={current.blocks} pageTitle={current.title} />}
          <nav className="site-reader-pagination mt-[58px] grid grid-cols-2 gap-3.5 border-t border-(--ob-reader-border) pt-[26px] [@media(max-width:800px)]:mt-[46px] [@media(max-width:800px)]:gap-[5px]" aria-label="相邻文档">
            {currentIndex > 0 ? <Link className={paginationLinkClassName} to={pageHref(basePath, snapshot.pages[currentIndex - 1].slug)}><ArrowLeft aria-hidden="true" size={18} /><span className="min-w-0 truncate"><small className="mb-0.5 block text-[length:var(--ob-prose-caption-size)] text-(--ob-reader-muted)">上一篇</small>{snapshot.pages[currentIndex - 1].title}</span></Link> : <span />}
            {currentIndex < snapshot.pages.length - 1 ? <Link className={`${paginationLinkClassName} justify-end text-right`} to={pageHref(basePath, snapshot.pages[currentIndex + 1].slug)}><span className="min-w-0 truncate"><small className="mb-0.5 block text-[length:var(--ob-prose-caption-size)] text-(--ob-reader-muted)">下一篇</small>{snapshot.pages[currentIndex + 1].title}</span><ArrowRight aria-hidden="true" size={18} /></Link> : null}
          </nav>
          {updatedAt != null ? <footer className="site-reader-page-footer mt-[25px] text-[length:var(--ob-prose-caption-size)] text-(--ob-reader-muted) max-[420px]:mt-5">最后更新于 {formatDate(updatedAt)}</footer> : null}
        </> : <div className="site-reader-empty flex min-h-[55vh] flex-col items-start justify-center gap-[17px] text-(--ob-reader-muted)"><BookOpen aria-hidden="true" size={30} /><h1 className="m-0 text-[length:var(--ob-prose-title-size)] text-(--ob-reader-text)">{snapshot.pages.length ? "页面不存在" : "还没有文档"}</h1><p className="m-0 text-[length:var(--ob-prose-body-size)]">{snapshot.pages.length ? "这个地址可能已经变更，请从目录查找文档。" : "选择一些文档，开始建立你的站点。"}</p><Link className={`text-[length:var(--ob-prose-body-size)] font-[650] text-(--ob-reader-accent) ${readerFocus}`} to={basePath}>返回文档首页</Link></div>}
      </main>
      {current && !compactOutline ? <Outline items={outline} /> : null}
    </div>
    <SearchDialog finalFocus={searchButtonRef} open={searchOpen} pages={snapshot.pages} basePath={basePath} close={closeSearch} loadPages={loadSearch} />
  </div>;
  return preview ? <SitePreviewLinks siteSlug={snapshot.slug} basePath={basePath}>{reader}</SitePreviewLinks> : reader;
}

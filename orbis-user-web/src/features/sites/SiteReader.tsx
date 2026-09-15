import { ArrowLeft, ArrowRight, BookOpen, Menu, Moon, Search, Sun, X } from "lucide-react";
import { useEffect, useMemo, useState, type CSSProperties } from "react";
import { Link } from "react-router-dom";

import { ContentRenderer, contentOutline } from "../content/ContentRenderer";
import { SITE_KINDS, type SiteSnapshot } from "./schemas";

function loadTheme(): "light" | "dark" {
  try { return localStorage.getItem("orbis-reader-theme") === "dark" ? "dark" : "light"; }
  catch { return "light"; }
}

export function SiteReader({ snapshot, basePath, pageSlug, preview = false }: {
  snapshot: SiteSnapshot; basePath: string; pageSlug?: string; preview?: boolean;
}) {
  const [query, setQuery] = useState("");
  const [navigationOpen, setNavigationOpen] = useState(false);
  const [theme, setTheme] = useState(loadTheme);
  const currentIndex = pageSlug ? snapshot.pages.findIndex((page) => page.slug === pageSlug) : 0;
  const current = snapshot.pages[currentIndex];
  const outline = useMemo(() => current ? contentOutline(current.blocks, current.title) : [], [current]);
  const matches = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase();
    return normalized ? snapshot.pages.filter((page) => `${page.title}\n${page.plain_text}`.toLocaleLowerCase().includes(normalized)) : [];
  }, [query, snapshot.pages]);
  const groups = useMemo(() => {
    const values: Array<[string, typeof snapshot.pages]> = [];
    for (const page of snapshot.pages) {
      const key = page.group || "文档";
      const last = values[values.length - 1];
      if (last?.[0] === key) last[1].push(page);
      else values.push([key, [page]]);
    }
    return values;
  }, [snapshot.pages]);

  useEffect(() => { setNavigationOpen(false); setQuery(""); }, [pageSlug]);
  useEffect(() => {
    const previous = document.title;
    document.title = `${current?.title || "文档"} · ${snapshot.name}`;
    return () => { document.title = previous; };
  }, [current?.title, snapshot.name]);

  function toggleTheme() {
    const next = theme === "light" ? "dark" : "light";
    setTheme(next);
    try { localStorage.setItem("orbis-reader-theme", next); } catch { /* Storage is optional for reading. */ }
  }
  const href = (slug: string) => `${basePath}/${encodeURIComponent(slug)}`;

  return (
    <div className="site-reader" data-theme={theme} style={{ "--site-accent": snapshot.accent_color } as CSSProperties}>
      <a className="site-skip-link" href="#site-content">跳转到正文</a>
      {preview ? <div className="site-preview-banner">发布预览 · 此页面只有工作空间成员可见</div> : null}
      <header className="site-header">
        <Link to={basePath} className="site-brand"><span className="site-brand-symbol"><BookOpen size={19} /></span><span>{snapshot.name}</span></Link>
        <div className="site-search">
          <Search size={16} aria-hidden="true" />
          <input type="search" aria-label="搜索文档" placeholder="搜索文档…" value={query} onChange={(event) => setQuery(event.target.value)} />
          {query.trim() ? <div className="site-search-results" aria-label="搜索结果">
            <p className="site-search-count">{matches.length} 条结果</p>
            {matches.length ? matches.map((page) => <Link key={page.slug} to={href(page.slug)} onClick={() => setQuery("")}><strong>{page.title}</strong><span>{page.plain_text.slice(Math.max(0, page.plain_text.toLocaleLowerCase().indexOf(query.trim().toLocaleLowerCase()) - 20), Math.max(0, page.plain_text.toLocaleLowerCase().indexOf(query.trim().toLocaleLowerCase()) - 20) + 120)}</span></Link>) : <p>没有找到相关内容</p>}
          </div> : null}
        </div>
        <div className="site-header-actions">
          <span className="site-kind-label">{SITE_KINDS[snapshot.site_kind].label}</span>
          <button type="button" className="site-icon-button" onClick={toggleTheme} aria-label={theme === "light" ? "切换深色主题" : "切换浅色主题"}>{theme === "light" ? <Moon size={17} /> : <Sun size={17} />}</button>
          <button type="button" className="site-icon-button site-menu-toggle" aria-label={navigationOpen ? "关闭站点导航" : "打开站点导航"} aria-expanded={navigationOpen} aria-controls="site-navigation" onClick={() => setNavigationOpen(!navigationOpen)}>{navigationOpen ? <X size={20} /> : <Menu size={20} />}</button>
        </div>
      </header>
      <div className="site-body">
        {navigationOpen ? <button type="button" className="site-navigation-scrim" aria-label="收起站点导航" onClick={() => setNavigationOpen(false)} /> : null}
        <aside id="site-navigation" className={`site-navigation${navigationOpen ? " is-open" : ""}`}>
          <div className="site-navigation-intro"><span>文档中心</span>{snapshot.description ? <p>{snapshot.description}</p> : null}</div>
          <nav aria-label="站点导航">{groups.map(([group, pages], index) => <section key={`${group}-${index}`}><h2>{group}</h2>{pages.map((page) => <Link key={page.slug} to={href(page.slug)} aria-current={current?.slug === page.slug ? "page" : undefined} onClick={() => setNavigationOpen(false)}>{page.title}</Link>)}</section>)}</nav>
          <div className="site-navigation-footer">由 <span>Orbis</span> 提供支持</div>
        </aside>
        <main id="site-content" className="site-content">
          {current ? <>
            <div className="site-breadcrumb">{current.group || SITE_KINDS[snapshot.site_kind].label}</div>
            <h1>{current.title}</h1>
            <ContentRenderer blocks={current.blocks} pageTitle={current.title} />
            <nav className="site-page-pagination" aria-label="相邻文档">
              {currentIndex > 0 ? <Link to={href(snapshot.pages[currentIndex - 1].slug)}><ArrowLeft size={17} /><span><small>上一篇</small>{snapshot.pages[currentIndex - 1].title}</span></Link> : <span />}
              {currentIndex < snapshot.pages.length - 1 ? <Link to={href(snapshot.pages[currentIndex + 1].slug)}><span><small>下一篇</small>{snapshot.pages[currentIndex + 1].title}</span><ArrowRight size={17} /></Link> : null}
            </nav>
            {snapshot.published_at_ms ? <footer className="site-page-footer">更新于 {new Date(snapshot.published_at_ms).toLocaleDateString("zh-CN", { timeZone: "Asia/Shanghai" })}</footer> : null}
          </> : <div className="site-empty"><BookOpen size={30} /><h1>{snapshot.pages.length ? "页面不存在" : "还没有文档"}</h1><p>{snapshot.pages.length ? "这个地址可能已经变更，请从目录查找文档。" : "选择一些文档，开始建立你的站点。"}</p><Link to={basePath}>返回文档首页</Link></div>}
        </main>
        <aside className="site-outline"><span>本页目录</span><nav aria-label="本页目录">{outline.map((item) => <a key={item.id} href={`#${item.id}`} style={{ paddingLeft: Math.max(0, item.level - 2) * 12 }}>{item.text}</a>)}</nav></aside>
      </div>
    </div>
  );
}

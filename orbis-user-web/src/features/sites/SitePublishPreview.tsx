import { AlertTriangle, RotateCw } from "lucide-react";
import { useState } from "react";

import { ContentRenderer } from "../content/ContentRenderer";
import { AuthenticatedFileContent } from "../files/FileContent";
import type { SitePreview, SiteSources } from "./schemas";
import { SiteChanges } from "./SiteChanges";
import { SitePreviewLinks } from "./SitePreviewLinks";

export function SitePublishPreview({
  siteId,
  preview,
  sources,
  busy,
  error,
  onConfirm,
  onRefresh,
  onCancel,
}: {
  siteId: string;
  preview: SitePreview;
  sources: SiteSources;
  busy: boolean;
  error: string;
  onConfirm: () => void;
  onRefresh: () => void;
  onCancel: () => void;
}) {
  const [selectedSlug, setSelectedSlug] = useState(preview.pages[0]?.slug ?? "");
  const selectedPage = preview.pages.find((page) => page.slug === selectedSlug) ?? preview.pages[0];
  return <div className="site-publish-preview">
    <div className="site-preview-summary"><strong>{preview.pages.length} 篇页面</strong><span>以下内容已冻结；确认发布不会在后台重新生成预览。</span></div>
    <SiteChanges changes={sources.changes} />
    {preview.pages.length ? <div className="site-preview-workspace">
      <nav aria-label="预览页面"><ul>{preview.pages.map((page) => <li key={page.slug}><button type="button" className={page.slug === selectedPage?.slug ? "active" : ""} onClick={() => setSelectedSlug(page.slug)}>{page.title}<small>/{page.slug}</small></button></li>)}</ul></nav>
      <article className="site-preview-page">{selectedPage ? <><header><span>冻结正文</span><h3>{selectedPage.title}</h3>{selectedPage.description ? <p>{selectedPage.description}</p> : null}</header><AuthenticatedFileContent><SitePreviewLinks siteSlug={preview.slug} basePath={`/sites/${siteId}/preview`} onNavigate={setSelectedSlug}><ContentRenderer blocks={selectedPage.blocks} pageTitle={selectedPage.title} /></SitePreviewLinks></AuthenticatedFileContent></> : null}</article>
    </div> : <div className="site-preview-empty"><AlertTriangle size={18} /><div><strong>来源中没有可发布页面</strong><p>请返回来源配置，确认笔记本中有文档且没有全部排除。</p></div></div>}
    {error ? <div className="site-preview-error" role="alert"><AlertTriangle size={16} /><span>{error}</span></div> : null}
    <div className="site-dialog-actions">
      {error ? <button className="mvp-button" type="button" disabled={busy} onClick={onRefresh}><RotateCw size={14} />重新预览</button> : null}
      <button className="mvp-button" type="button" disabled={busy} onClick={onCancel}>取消</button>
      <button className="mvp-button primary" type="button" disabled={busy || !preview.pages.length} onClick={onConfirm}>{busy ? "发布中…" : "确认发布"}</button>
    </div>
  </div>;
}

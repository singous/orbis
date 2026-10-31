import { SiteActionButton as ActionButton } from "./SiteManagementLayout";
import { Button } from "../../shared/ui/Button";
import { cn } from "@orbis/ui/cn";
import { SiteDialogActions, SiteNotice } from "./SiteManagementLayout";
import { AlertTriangle, RotateCw } from "../../shared/ui/icons";
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
  onConfirm,
  onRefresh,
  onCancel,
}: {
  siteId: string;
  preview: SitePreview;
  sources: SiteSources;
  busy: boolean;
  onConfirm: () => void;
  onRefresh: () => void;
  onCancel: () => void;
}) {
  const [selectedSlug, setSelectedSlug] = useState(preview.pages[0]?.slug ?? "");
  const selectedPage = preview.pages.find((page) => page.slug === selectedSlug) ?? preview.pages[0];
  return <div className="mt-[22px] grid gap-5">
    <div className="flex items-baseline justify-between gap-4"><strong className="text-sm">{preview.pages.length} 篇页面</strong><span className="text-xs text-ob-muted-foreground">以下内容已冻结；确认发布不会在后台重新生成预览。</span></div>
    <SiteChanges changes={sources.changes} />
    {preview.pages.length ? <div className="grid min-h-[330px] grid-cols-1 overflow-hidden rounded-ob-xl border border-ob-border min-[721px]:grid-cols-[210px_minmax(0,1fr)]">
      <nav className="border-b border-ob-border bg-ob-card p-[9px] min-[721px]:border-b-0 min-[721px]:border-e" aria-label="预览页面"><ul className="grid gap-[3px]">{preview.pages.map((page) => <li key={page.slug}><ActionButton className={cn("grid w-full gap-[2px] px-[9px] py-2 text-start text-sm text-ob-muted-foreground", page.slug === selectedPage?.slug && "active bg-ob-card text-ob-foreground shadow-(--ob-site-preview-active-shadow)")} onClick={() => setSelectedSlug(page.slug)}>{page.title}<small className="text-xs text-ob-muted-foreground">/{page.slug}</small></ActionButton></li>)}</ul></nav>
      <article className="overflow-auto px-8 py-[26px]">{selectedPage && <><header className="mb-[22px] border-b border-ob-border pb-4"><span className="text-xs tracking-[.08em] text-ob-muted-foreground">冻结正文</span><h3 className="mt-1.5 text-[length:var(--orbis-prose-title-size)] font-semibold leading-[1.5]">{selectedPage.title}</h3>{selectedPage.description && <p className="mt-[7px] text-xs text-ob-muted-foreground">{selectedPage.description}</p>}</header><AuthenticatedFileContent><SitePreviewLinks siteSlug={preview.slug} basePath={`/sites/${siteId}/preview`} onNavigate={setSelectedSlug}><ContentRenderer blocks={selectedPage.blocks} pageTitle={selectedPage.title} /></SitePreviewLinks></AuthenticatedFileContent></>}</article>
    </div> : <SiteNotice icon={<AlertTriangle size={18} />} title="来源中没有可发布页面" description="请返回来源配置，确认笔记本中有文档且没有全部排除。" descriptionClassName="mt-1" />}
    <SiteDialogActions>
      <Button disabled={busy} onClick={onRefresh}><RotateCw size={14} />重新预览</Button>
      <Button disabled={busy} onClick={onCancel}>取消</Button>
      <Button variant="primary" disabled={busy || !preview.pages.length} onClick={onConfirm}>{busy ? "发布中…" : "确认发布"}</Button>
    </SiteDialogActions>
  </div>;
}

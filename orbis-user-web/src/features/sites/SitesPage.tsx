import { ArrowUpRight, BookOpen, Globe, Plus } from "lucide-react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useStore } from "zustand";
import { authStore } from "../../shared/auth/auth-store";
import { useAuthRequest } from "../../shared/auth/use-auth-request";
import { Dialog, DialogContent } from "../../shared/ui/Dialog";
import { canMutateWorkspaceContent } from "../workspace/capabilities";
import { WorkspaceShell } from "../workspace/WorkspaceShell";
import { createSite } from "./api";
import { useSites } from "./queries";
import { SITE_KINDS, type SiteConfig } from "./schemas";
import { SiteSettingsForm } from "./SiteSettingsForm";

export const EMPTY_SITE_CONFIG: SiteConfig = { name: "", slug: "", description: "", site_kind: "knowledge", accent_color: "#0f766e", navigation: [] };

export function SitesPage() {
  const workspace = useStore(authStore, (state) => state.workspace);
  const canEdit = canMutateWorkspaceContent(workspace);
  const [page, setPage] = useState(1);
  const sites = useSites(page);
  const [open, setOpen] = useState(false);
  const [config, setConfig] = useState<SiteConfig>({ ...EMPTY_SITE_CONFIG });
  const auth = useAuthRequest();
  const client = useQueryClient();
  const navigate = useNavigate();
  const create = useMutation({ mutationFn: () => createSite(config, auth), onSuccess: async (site) => { await client.invalidateQueries({ queryKey: ["sites"] }); navigate(`/sites/${site.id}`); } });
  function submit(event: FormEvent) { event.preventDefault(); create.mutate(); }
  return <WorkspaceShell sectionTitle="发布与站点"><div className="mvp-page sites-overview">
    <div className="mvp-page-heading"><div><span className="mvp-eyebrow">从知识到分享</span><h1>你的文档站点</h1><p>把积累的知识，整理成值得阅读的文档。</p></div>{canEdit ? <button type="button" className="mvp-button primary" onClick={() => { setConfig({ ...EMPTY_SITE_CONFIG }); create.reset(); setOpen(true); }}><Plus size={17} />创建站点</button> : null}</div>
    <div className="site-scenario-strip">{Object.entries(SITE_KINDS).map(([kind, item]) => <div key={kind}><BookOpen size={18} /><span><strong>{item.label}</strong><small>{item.description}</small></span></div>)}</div>
    {sites.isPending ? <p className="mvp-muted">正在加载站点…</p> : sites.isError ? <div className="mvp-feedback error" role="alert">无法加载站点。<button type="button" onClick={() => void sites.refetch()}>重新加载</button></div> : sites.data.items.length ? <>
      <div className="site-list">{sites.data.items.map((site) => <div className="site-list-row" key={site.id}><span className="site-list-symbol" style={{ color: site.accent_color }}><Globe size={23} /></span><Link to={`/sites/${site.id}`} className="site-list-title"><strong>{site.name}</strong><span>{site.description || SITE_KINDS[site.site_kind].description}</span></Link><span className={`site-state${site.published_release_id ? " published" : ""}`}>{site.published_release_id ? "已发布" : "草稿"}</span><Link to={`/sites/${site.id}`} className="mvp-button">管理站点<ArrowUpRight size={15} /></Link></div>)}</div>
      <div className="mvp-pagination"><button type="button" disabled={!sites.data.pagination.has_previous} onClick={() => setPage(page - 1)}>上一页</button><span>第 {page} 页 · 共 {sites.data.pagination.total} 个站点</span><button type="button" disabled={!sites.data.pagination.has_next} onClick={() => setPage(page + 1)}>下一页</button></div>
    </> : <div className="site-first-empty"><span><Globe size={32} /></span><h2>从第一篇文档开始</h2><p>选择内容、安排目录、预览发布。<br />内部继续写作，读者看到你确认发布的版本。</p>{canEdit ? <button type="button" className="mvp-button" onClick={() => setOpen(true)}>创建第一个站点<ArrowUpRight size={16} /></button> : <p>工作空间的编辑者可以创建站点。</p>}</div>}
    <Dialog open={open} onOpenChange={setOpen}><DialogContent title="创建文档站点" description="先确定站点信息，下一步选择发布内容。"><form className="site-create-form" onSubmit={submit}><SiteSettingsForm value={config} onChange={setConfig} disabled={create.isPending} />{create.error ? <p role="alert" className="mvp-feedback error">{create.error.message}</p> : null}<button className="mvp-button primary" type="submit" disabled={create.isPending}>{create.isPending ? "创建中…" : "创建并选择文档"}</button></form></DialogContent></Dialog>
  </div></WorkspaceShell>;
}

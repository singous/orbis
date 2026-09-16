import { ArrowUpRight, ChevronRight, Globe, Plus } from "lucide-react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState, type FormEvent } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { useStore } from "zustand";
import "../../styles/site-management.css";

import { authStore } from "../../shared/auth/auth-store";
import { useAuthRequest } from "../../shared/auth/use-auth-request";
import { Button } from "../../shared/ui/Button";
import { Dialog, DialogContent } from "../../shared/ui/Dialog";
import { PageContainer } from "../../shared/ui/PageContainer";
import { canMutateWorkspaceContent } from "../workspace/capabilities";
import { WorkspaceShell } from "../workspace/WorkspaceShell";
import { createSite } from "./api";
import { useSites } from "./queries";
import { SITE_KINDS, type SiteConfig } from "./schemas";
import { SiteSettingsForm } from "./SiteSettingsForm";
import { SiteSourceEditor } from "./SiteSourceEditor";

export const EMPTY_SITE_CONFIG: SiteConfig = {
  name: "", slug: "", description: "", site_kind: "knowledge", accent_color: "#0f766e", navigation: [],
  source: { kind: "manual", notebooks: [], excluded_note_ids: [], page_overrides: [] },
  branding: { logo_url: null, links: [], footer_links: [], cta: null, theme: "system" },
};

function createInitialConfig(notebookId: string | null): SiteConfig {
  if (!notebookId) return { ...EMPTY_SITE_CONFIG };
  return { ...EMPTY_SITE_CONFIG, source: { kind: "notebooks", notebooks: [{ notebook_id: notebookId, root_note_id: null, label: null }], excluded_note_ids: [], page_overrides: [] } };
}

export function SitesPage() {
  const workspace = useStore(authStore, (state) => state.workspace);
  const canEdit = canMutateWorkspaceContent(workspace);
  const [searchParams] = useSearchParams();
  const initialNotebookId = searchParams.get("notebook");
  const [page, setPage] = useState(1);
  const sites = useSites(page);
  const [open, setOpen] = useState(Boolean(initialNotebookId) && canEdit);
  const [config, setConfig] = useState<SiteConfig>(() => createInitialConfig(initialNotebookId));
  const auth = useAuthRequest();
  const client = useQueryClient();
  const navigate = useNavigate();
  const create = useMutation({ mutationFn: () => createSite(config, auth), onSuccess: async (site) => { await client.invalidateQueries({ queryKey: ["sites"] }); navigate(`/sites/${site.id}`); } });

  function openCreate() {
    setConfig({ ...EMPTY_SITE_CONFIG });
    create.reset();
    setOpen(true);
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    create.mutate();
  }

  return (
    <WorkspaceShell>
      <PageContainer title="你的文档站点" description="管理站点、组织目录并发布文档。" actions={canEdit ? <Button variant="primary" icon={<Plus aria-hidden="true" size={16} />} onClick={openCreate}>创建站点</Button> : null}>
        <section className="workbench-section" aria-label="文档站点">
          <header className="workbench-section-heading"><h2>全部站点</h2>{sites.data ? <span className="workbench-section-count">{sites.data.pagination.total} 个站点</span> : null}</header>
          {sites.isPending ? <div className="empty-panel">正在加载站点…</div> : sites.isError ? (
            <div className="mvp-feedback error" role="alert">无法加载站点。<button type="button" onClick={() => void sites.refetch()}>重新加载</button></div>
          ) : sites.data.items.length ? <>
            <div className="workbench-resource-grid">
              {sites.data.items.map((site) => (
                <Link to={`/sites/${site.id}`} className="workbench-resource-card workbench-site-card" key={site.id} aria-label={`管理站点 ${site.name}`}>
                  <span className="workbench-resource-icon" style={{ color: site.accent_color }}><Globe aria-hidden="true" size={25} /></span>
                  <span className="workbench-resource-copy"><strong>{site.name}</strong><span>{site.description || SITE_KINDS[site.site_kind].description}</span><span className="workbench-site-status"><i className={site.published_release_id ? "is-published" : ""} />{site.published_release_id ? "已发布" : "草稿"}</span></span>
                  <ChevronRight className="workbench-resource-chevron" aria-hidden="true" size={17} />
                </Link>
              ))}
            </div>
            <div className="mvp-pagination"><button type="button" disabled={!sites.data.pagination.has_previous} onClick={() => setPage(page - 1)}>上一页</button><span>第 {page} 页 · 共 {sites.data.pagination.total} 个站点</span><button type="button" disabled={!sites.data.pagination.has_next} onClick={() => setPage(page + 1)}>下一页</button></div>
          </> : (
            <div className="workbench-empty-section workbench-site-empty"><Globe aria-hidden="true" size={30} /><h2>从第一篇文档开始</h2><p>选择内容、安排目录、预览发布。<br />读者看到你确认发布的版本。</p>{canEdit ? <Button variant="secondary" onClick={openCreate}>创建第一个站点<ArrowUpRight aria-hidden="true" size={15} /></Button> : <p>工作空间的编辑者可以创建站点。</p>}</div>
          )}
        </section>
      </PageContainer>
      <Dialog open={open} onOpenChange={setOpen}><DialogContent className="site-create-dialog" title="创建文档站点" description="先确定站点信息与内容来源，提交前不会创建站点。"><form className="site-create-form" onSubmit={submit}><SiteSettingsForm value={config} onChange={setConfig} disabled={create.isPending} /><SiteSourceEditor value={config.source} onChange={(source) => setConfig({ ...config, source })} disabled={create.isPending} />{create.error ? <p role="alert" className="mvp-feedback error">{create.error.message}</p> : null}<div className="site-create-actions"><button className="mvp-button" type="button" disabled={create.isPending} onClick={() => setOpen(false)}>取消</button><button className="mvp-button primary" type="submit" disabled={create.isPending || config.source?.kind === "notebooks" && !config.source.notebooks.length}>{create.isPending ? "创建中…" : "创建站点"}</button></div></form></DialogContent></Dialog>
    </WorkspaceShell>
  );
}

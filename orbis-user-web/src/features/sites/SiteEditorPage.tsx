import { ArrowLeft, ExternalLink, Eye, Globe, History, Rocket, RotateCcw } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { useState, type FormEvent } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useStore } from "zustand";
import { authStore } from "../../shared/auth/auth-store";
import { useAuthRequest } from "../../shared/auth/use-auth-request";
import { Dialog, DialogContent } from "../../shared/ui/Dialog";
import { canManageWorkspaceMembers, canMutateWorkspaceContent } from "../workspace/capabilities";
import { WorkspaceShell } from "../workspace/WorkspaceShell";
import { activateSiteRelease, getSite, publishSite, saveSite, unpublishSite } from "./api";
import { useSite, useSiteReleases } from "./queries";
import { siteConfigSchema, type Site, type SiteConfig } from "./schemas";
import { SiteNavigationEditor } from "./SiteNavigationEditor";
import { SiteSettingsForm } from "./SiteSettingsForm";

type PublishAction = { type: "publish" } | { type: "unpublish" } | { type: "activate"; releaseId: string; number: number };

function SiteEditor({ site }: { site: Site }) {
  const auth = useAuthRequest();
  const workspace = useStore(authStore, (state) => state.workspace);
  const canEdit = canMutateWorkspaceContent(workspace);
  const canPublish = canManageWorkspaceMembers(workspace);
  const [draft, setDraft] = useState<SiteConfig>(() => siteConfigSchema.parse(site));
  const [saved, setSaved] = useState<SiteConfig>(() => siteConfigSchema.parse(site));
  const [version, setVersion] = useState(site.config_version);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [pendingAction, setPendingAction] = useState<PublishAction | null>(null);
  const [releasePage, setReleasePage] = useState(1);
  const releases = useSiteReleases(site.id, releasePage);
  const client = useQueryClient();
  const navigate = useNavigate();
  const dirty = JSON.stringify(draft) !== JSON.stringify(saved);

  async function updateCache(next: Site) {
    client.setQueryData(["site", site.id], next);
    await Promise.all([client.invalidateQueries({ queryKey: ["sites"] }), client.invalidateQueries({ queryKey: ["site-releases", site.id] }), client.invalidateQueries({ queryKey: ["site-preview", site.id] }), client.invalidateQueries({ queryKey: ["public-site"] })]);
  }
  async function saveCurrent() {
    if (!dirty) return;
    const next = await saveSite(site.id, draft, version, auth);
    const config = siteConfigSchema.parse(next);
    setDraft(config); setSaved(config); setVersion(next.config_version);
    await updateCache(next);
  }
  async function perform(operation: () => Promise<void>) {
    setBusy(true); setError(""); setMessage("");
    try { await operation(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "操作失败，请重试"); }
    finally { setBusy(false); }
  }
  function submit(event: FormEvent) {
    event.preventDefault();
    void perform(async () => { await saveCurrent(); setMessage("设置已保存"); });
  }
  async function preview() {
    await perform(async () => { if (canEdit) await saveCurrent(); navigate(`/sites/${site.id}/preview`); });
  }
  async function confirmAction() {
    if (!pendingAction) return;
    await perform(async () => {
      if (pendingAction.type === "publish") {
        await saveCurrent();
        await publishSite(site.id, auth);
        await updateCache(await getSite(site.id, auth));
        setMessage("站点已发布，读者现在可以访问新版本。");
      } else {
        const next = pendingAction.type === "unpublish" ? await unpublishSite(site.id, auth) : await activateSiteRelease(site.id, pendingAction.releaseId, auth);
        if (JSON.stringify(siteConfigSchema.parse(next)) === JSON.stringify(saved)) setVersion(next.config_version);
        await updateCache(next);
        setMessage(pendingAction.type === "unpublish" ? "站点已撤回，公开入口现已关闭。" : "已切换公开版本，内部文档保持当前内容。");
      }
      setPendingAction(null);
    });
  }

  return <WorkspaceShell sectionTitle="发布与站点"><div className="mvp-page site-editor-page">
    <Link className="mvp-back" to="/sites"><ArrowLeft size={15} />所有站点</Link>
    <div className="mvp-page-heading"><div><span className="mvp-eyebrow">发布管理</span><h1>{site.name}</h1><p>组织面向读者的内容，让每次发布都清晰可控。</p></div><span className={`site-state${site.published_release_id ? " published" : ""}`}><span />{site.published_release_id ? "已发布" : "尚未发布"}</span></div>
    <div className="site-publishing-bar"><span><Globe size={17} />{site.published_slug ? <Link to={`/s/${site.published_slug}`} target="_blank" rel="noopener noreferrer">查看公开站点<ExternalLink size={14} /></Link> : "站点将在发布后对外开放"}</span><div><button type="button" className="mvp-button" disabled={busy} onClick={() => void preview()}><Eye size={16} />预览</button>{canPublish ? <button type="button" className="mvp-button primary" disabled={busy || !draft.navigation.length} onClick={() => setPendingAction({ type: "publish" })}><Rocket size={16} />发布站点</button> : <span className="mvp-muted">由所有者或管理员发布</span>}</div></div>
    {error ? <div role="alert" className="mvp-feedback error">{error}</div> : null}{message ? <div role="status" className="mvp-feedback success">{message}</div> : null}
    <form onSubmit={submit}>
      <div className="site-editor-columns"><section className="site-settings-section"><div className="site-section-heading"><div><h2>站点设置</h2><p>名称、场景与阅读风格。</p></div></div><SiteSettingsForm value={draft} onChange={setDraft} disabled={!canEdit || busy} /></section><SiteNavigationEditor value={draft.navigation} onChange={(navigation) => setDraft({ ...draft, navigation })} disabled={!canEdit || busy} /></div>
      <div className="site-save-row"><span className="mvp-muted">{dirty ? "有尚未保存的设置" : "设置已与服务器同步"}</span>{canEdit ? <button className="mvp-button primary" type="submit" disabled={busy}>{busy ? "处理中…" : "保存设置"}</button> : null}</div>
    </form>
    <section className="site-releases"><div className="site-section-heading"><div><h2><History size={18} />发布历史</h2><p>切换版本只改变公开站点，草稿仍可继续编辑。</p></div>{canPublish && site.published_release_id ? <button className="mvp-button danger-text" type="button" disabled={busy} onClick={() => setPendingAction({ type: "unpublish" })}>撤回站点</button> : null}</div>
      {releases.isPending ? <p className="mvp-muted">正在加载发布记录…</p> : releases.isError ? <p role="alert">无法加载发布记录。<button onClick={() => void releases.refetch()} type="button">重试</button></p> : releases.data.items.length ? <>
        {releases.data.items.map((release) => <div className="site-release-row" key={release.id}><span className="site-release-number">v{release.release_number}</span><span>{new Date(release.published_at_ms).toLocaleString("zh-CN", { timeZone: "Asia/Shanghai" })}</span>{release.is_active ? <span className="site-state published">当前公开版本</span> : canPublish ? <button className="mvp-button" type="button" disabled={busy} onClick={() => setPendingAction({ type: "activate", releaseId: release.id, number: release.release_number })}><RotateCcw size={14} />切换到此版本</button> : null}</div>)}
        <div className="mvp-pagination"><button type="button" disabled={!releases.data.pagination.has_previous} onClick={() => setReleasePage(releasePage - 1)}>上一页</button><span>第 {releasePage} 页</span><button type="button" disabled={!releases.data.pagination.has_next} onClick={() => setReleasePage(releasePage + 1)}>下一页</button></div>
      </> : <p className="site-empty-history">第一次发布后，版本会保存在这里。</p>}
    </section>
    <Dialog open={pendingAction !== null} onOpenChange={(open) => { if (!open && !busy) setPendingAction(null); }}><DialogContent title={pendingAction?.type === "publish" ? "确认发布站点" : pendingAction?.type === "unpublish" ? "确认撤回站点" : "切换公开版本"} description={pendingAction?.type === "publish" ? `将公开所选 ${draft.navigation.length} 篇文档当前已保存的内容。后续内部修改需要再次发布才会上线。` : pendingAction?.type === "unpublish" ? "公开链接将不再提供内容，内部文档和发布历史会保留。" : `将公开站点切换到版本 ${pendingAction?.type === "activate" ? pendingAction.number : ""}，内部草稿保持不变。`}>
      {error ? <p className="mvp-feedback error">{error}</p> : null}<div className="site-dialog-actions"><button className="mvp-button" type="button" disabled={busy} onClick={() => setPendingAction(null)}>取消</button><button className="mvp-button primary" type="button" disabled={busy} onClick={() => void confirmAction()}>{busy ? "处理中…" : pendingAction?.type === "publish" ? "确认发布" : "确认操作"}</button></div>
    </DialogContent></Dialog>
  </div></WorkspaceShell>;
}

export function SiteEditorPage() {
  const { siteId = "" } = useParams();
  const query = useSite(siteId);
  if (!query.data) return <WorkspaceShell sectionTitle="发布与站点"><div className="mvp-page"><h1>{query.isPending ? "正在打开站点…" : "无法打开站点"}</h1>{query.error ? <p role="alert">{query.error.message}</p> : null}<Link to="/sites">返回所有站点</Link></div></WorkspaceShell>;
  return <SiteEditor key={siteId} site={query.data} />;
}

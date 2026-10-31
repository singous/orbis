import { reportError } from "../../shared/api/request-feedback";
import { newUUID } from "../../shared/ids";
import { LoadingState } from "../../shared/ui/LoadingState";
import { Tag } from "../../shared/ui/Tag";
import { ActionButton } from "../../shared/ui/ActionButton";
import { ArrowLeft, ExternalLink, Eye, Globe, History, Rocket, RotateCcw } from "../../shared/ui/icons";
import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { Link, useBlocker, useNavigate, useParams } from "react-router-dom";
import { useStore } from "zustand";
import { Button } from "../../shared/ui/Button";
import { workbenchStyles } from "../../shared/ui/workbench-styles";
import { SiteManagementScope, SiteSectionHeading, SitePagination, SiteDialogActions, SiteWideDialogContent } from "./SiteManagementLayout";

import { authStore } from "../../shared/auth/auth-store";
import { registerPendingNavigation } from "../../shared/navigation/pending-navigation";
import { useAuthRequest } from "../../shared/auth/use-auth-request";
import { Dialog, DialogContent } from "../../shared/ui/Dialog";
import { PageContainer, pageBaseColumnClassName } from "../../shared/ui/PageContainer";
import { canManageWorkspaceMembers, canMutateWorkspaceContent } from "../workspace/capabilities";
import { WorkspaceShell } from "../workspace/WorkspaceShell";
import { activateSiteRelease, getSiteSources, previewSite, publishSite, saveSite, unpublishSite } from "./api";
import { useSite, useSiteReleases, useSiteSources } from "./queries";
import { siteConfigSchema, type Site, type SiteConfig, type SitePreview, type SiteSources } from "./schemas";
import { sourceOrManual } from "./source-model";
import { SiteNavigationEditor } from "./SiteNavigationEditor";
import { SitePublishPreview } from "./SitePublishPreview";
import { SiteDraftFields } from "./SiteDraftFields";

type ReleaseAction = ({ type: "unpublish" } | { type: "activate"; releaseId: string; number: number }) & {expectedVersion:number;operationId:string};
type PreviewBundle = { preview: SitePreview; sources: SiteSources };

function SiteEditor({ site }: { site: Site }) {
  const auth = useAuthRequest();
  const workspace = useStore(authStore, (state) => state.workspace);
  const canEdit = canMutateWorkspaceContent(workspace);
  const canPublish = canManageWorkspaceMembers(workspace);
  const [draft, setDraft] = useState<SiteConfig>(() => siteConfigSchema.parse(site));
  const [saved, setSaved] = useState<SiteConfig>(() => siteConfigSchema.parse(site));
  const [version, setVersion] = useState(site.config_version);
  const versionRef=useRef(site.config_version);
  function observedVersion(value:number){versionRef.current=value;setVersion(value);}
  const [savedAtMs, setSavedAtMs] = useState(site.updated_at_ms);
  const [busy, setBusy] = useState(false);
  const [previewBundle, setPreviewBundle] = useState<(PreviewBundle & {siteVersion:number;operationId:string}) | null>(null);
  const [pendingAction, setPendingAction] = useState<ReleaseAction | null>(null);
  const [releasePage, setReleasePage] = useState(1);
  const releases = useSiteReleases(site.id, releasePage);
  const savedSource = sourceOrManual(saved.source);
  const sourceIsSaved = JSON.stringify(sourceOrManual(draft.source)) === JSON.stringify(savedSource);
  const sourceState = useSiteSources(site.id, savedSource.kind === "notebooks");
  const client = useQueryClient();
  const navigate = useNavigate();
  const dirty = JSON.stringify(draft) !== JSON.stringify(saved);
  const navigationStateRef = useRef({ dirty, busy });
  navigationStateRef.current = { dirty, busy };
  const navigationBlocker = useBlocker(({ currentLocation, nextLocation }) =>
    navigationStateRef.current.dirty && currentLocation.pathname !== nextLocation.pathname,
  );
  useEffect(() => {
    if (!dirty && !busy) return;
    const warnBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", warnBeforeUnload);
    return () => window.removeEventListener("beforeunload", warnBeforeUnload);
  }, [dirty, busy]);
  useEffect(() => registerPendingNavigation(async () => {
    if (navigationStateRef.current.dirty) throw new Error("请先保存站点设置，再打开其他内容。");
    if (navigationStateRef.current.busy) throw new Error("站点操作尚未完成，请稍后再打开其他内容。");
  }), [site.id]);

  async function updateCache(next: Site) {
    client.setQueryData(["site", site.id], next);
    await Promise.all([
      ["sites"],
      ["global-search"],
      ["site-releases", site.id],
      ["site-preview", site.id],
      ["site-sources", site.id],
      ["public-site"],
    ].map((queryKey) => client.invalidateQueries({ queryKey })));
  }

  async function saveCurrent(notifySuccess = false): Promise<SiteConfig> {
    if (!dirty) return saved;
    const next = await saveSite(site.id, draft, version, { ...auth, feedback: { ...auth.feedback, success: notifySuccess } });
    const config = siteConfigSchema.parse(next);
    setDraft(config);
    setSaved(config);
    observedVersion(next.config_version);
    setSavedAtMs(next.updated_at_ms);
    navigationStateRef.current.dirty = false;
    await updateCache(next);
    return config;
  }

  async function perform(operation: () => Promise<void>) {
    setBusy(true);

    try { await operation(); }
    catch (cause) { reportError(cause); }
    finally { setBusy(false); }
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    void perform(async () => { await saveCurrent(true); });
  }

  async function openReaderPreview() {
    await perform(async () => { if (canEdit) await saveCurrent(); navigate(`/sites/${site.id}/preview`); });
  }

  async function preparePublishPreview() {
    await perform(async () => {
      await saveCurrent();
      const [sources, preview] = await Promise.all([getSiteSources(site.id, auth), previewSite(site.id, auth)]);
      if (sources.source_fingerprint !== preview.source_fingerprint) throw new Error("来源在生成预览时发生变化，请重新预览后再发布。");
      setPreviewBundle({ sources, preview,siteVersion:versionRef.current,operationId:newUUID() });
    });
  }

  async function confirmPublish() {
    if (!previewBundle) return;
    await perform(async () => {
      const next=await publishSite(site.id,auth,{operation_id:previewBundle.operationId,expected_version:previewBundle.siteVersion,expected_source_fingerprint:previewBundle.preview.source_fingerprint});
      observedVersion(next.config_version);
      await updateCache(next);
      setPreviewBundle(null);
    });
  }

  async function confirmReleaseAction() {
    if (!pendingAction) return;
    await perform(async () => {
      const next = pendingAction.type === "unpublish" ? await unpublishSite(site.id, auth,pendingAction.expectedVersion,pendingAction.operationId) : await activateSiteRelease(site.id,pendingAction.releaseId,auth,pendingAction.expectedVersion,pendingAction.operationId);
      if (JSON.stringify(siteConfigSchema.parse(next)) === JSON.stringify(saved)) observedVersion(next.config_version);
      await updateCache(next);

      setPendingAction(null);
    });
  }

  const draftSource = sourceOrManual(draft.source);
  const sourceReady = draftSource.kind === "manual" || draftSource.notebooks.length > 0;
  const canPreparePublish = draftSource.kind === "notebooks" ? sourceReady : draft.navigation.length > 0;

  return <PageContainer title={site.name} description="管理站点设置、内容来源与公开版本。" actions={<Tag tone={site.published_release_id ? "success" : "neutral"}>{site.published_release_id ? "已发布" : "尚未发布"}</Tag>}><SiteManagementScope appearance="editor"><div data-ui="site-management">
    <Link className={workbenchStyles.back} to="/sites"><ArrowLeft aria-hidden="true" size={16} />所有站点</Link>
    <div className="mb-8 flex items-center justify-between gap-5 border-b border-ob-border pb-6 max-[850px]:flex-col max-[850px]:items-start max-[850px]:gap-[17px]"><span className="flex items-center gap-[9px] text-xs text-ob-muted-foreground"><Globe size={18} />{site.published_slug ? <Link className="flex items-center gap-[9px] text-ob-primary" to={`/s/${site.published_slug}`} target="_blank" rel="noopener noreferrer">查看公开站点<ExternalLink size={14} /></Link> : "站点将在发布后对外开放"}</span><div className="flex items-center gap-[9px]"><Button disabled={busy} onClick={openReaderPreview}><Eye size={16} />预览</Button>{canPublish ? <Button variant="primary" disabled={busy || !canPreparePublish} onClick={preparePublishPreview}><Rocket size={16} />发布站点</Button> : <span className="text-sm text-ob-muted-foreground">由所有者或管理员发布</span>}</div></div>

    <form onSubmit={submit}>
      <SiteDraftFields value={draft} onChange={setDraft} onSourceChange={(source) => setDraft({ ...draft, source })} disabled={!canEdit || busy} saved={sourceIsSaved} sources={sourceIsSaved ? sourceState.data : undefined} savedAtMs={savedAtMs}>
        {draftSource.kind === "manual" && <SiteNavigationEditor value={draft.navigation} onChange={(navigation) => setDraft({ ...draft, navigation })} disabled={!canEdit || busy} />}
      </SiteDraftFields>
      <div className="mt-9 flex items-center justify-between border-t border-ob-border pt-5"><span className="text-sm text-ob-muted-foreground">{!sourceReady ? "请添加来源或切换到手动选择" : dirty ? "有尚未保存的设置" : "设置已与服务器同步"}</span>{canEdit && <Button variant="primary" type="submit" disabled={busy || !sourceReady}>{busy ? "处理中…" : "保存设置"}</Button>}</div>
    </form>
    <section className="mt-[44px] border-t border-ob-border pt-7"><SiteSectionHeading title={<><History size={18} />发布历史</>} description="切换版本只改变公开站点，草稿仍可继续编辑。" actions={canPublish && site.published_release_id && <Button className="text-(--ob-page-danger)" disabled={busy} onClick={() => setPendingAction({ type: "unpublish",expectedVersion:versionRef.current,operationId:newUUID() })}>撤回站点</Button>} />
      {releases.isPending ? <LoadingState label="正在加载发布记录…" compact /> : releases.isError ? null : releases.data.items.length ? <>
        {releases.data.items.map((release) => <div className="flex items-center gap-[22px] border-b border-ob-border py-3.5 text-xs text-ob-muted-foreground [&>:last-child]:ml-auto max-[800px]:flex-wrap max-[800px]:gap-3" key={release.id}><span className="min-w-[34px] font-semibold text-ob-foreground">v{release.release_number}</span><span>{new Date(release.published_at_ms).toLocaleString("zh-CN", { timeZone: "Asia/Shanghai" })}</span>{release.is_active ? <Tag tone="success">当前公开版本</Tag> : canPublish && <Button disabled={busy} onClick={() => setPendingAction({ type: "activate", releaseId: release.id, number: release.release_number,expectedVersion:versionRef.current,operationId:newUUID() })}><RotateCcw size={14} />切换到此版本</Button>}</div>)}
        <SitePagination hasPrevious={releases.data.pagination.has_previous} hasNext={releases.data.pagination.has_next} onPrevious={() => setReleasePage(releasePage - 1)} onNext={() => setReleasePage(releasePage + 1)}>第 {releasePage} 页</SitePagination>
      </> : <p className="py-[15px] text-xs text-ob-muted-foreground">第一次发布后，版本会保存在这里。</p>}
    </section>
    <Dialog open={previewBundle !== null} onOpenChange={(open) => { if (!open && !busy) { setPreviewBundle(null);  } }}><SiteWideDialogContent title="确认发布站点" description="核对来源变化与冻结正文。确认后只会发布这里显示的版本。">{previewBundle && <SitePublishPreview siteId={site.id} preview={previewBundle.preview} sources={previewBundle.sources} busy={busy} onConfirm={confirmPublish} onRefresh={preparePublishPreview} onCancel={() => setPreviewBundle(null)} />}</SiteWideDialogContent></Dialog>
    <Dialog open={pendingAction !== null} onOpenChange={(open) => { if (!open && !busy) setPendingAction(null); }}><DialogContent title={pendingAction?.type === "unpublish" ? "确认撤回站点" : "切换公开版本"} description={pendingAction?.type === "unpublish" ? "公开链接将不再提供内容，内部文档和发布历史会保留。" : `将公开站点切换到版本 ${pendingAction?.type === "activate" ? pendingAction.number : ""}，内部草稿保持不变。`}>
      <SiteDialogActions><Button disabled={busy} onClick={() => setPendingAction(null)}>取消</Button><Button variant="primary" disabled={busy} onClick={confirmReleaseAction}>{busy ? "处理中…" : "确认操作"}</Button></SiteDialogActions>
    </DialogContent></Dialog>
    <Dialog open={navigationBlocker.state === "blocked"} onOpenChange={(open) => { if (!open && !busy && navigationBlocker.state === "blocked") navigationBlocker.reset(); }}>
      <DialogContent title="站点设置尚未保存" description="离开前可以保存设置、放弃本次修改，或返回继续编辑。保存设置不会发布站点。">
        <SiteDialogActions>
          <ActionButton disabled={busy} onClick={() => { if (navigationBlocker.state === "blocked") navigationBlocker.reset(); }}>继续编辑</ActionButton>
          <ActionButton disabled={busy} onClick={() => { if (navigationBlocker.state === "blocked") navigationBlocker.proceed(); }}>放弃修改并离开</ActionButton>
          <ActionButton variant="primary" isPending={busy} disabled={busy} onClick={() => void perform(async () => { await saveCurrent(); if (navigationBlocker.state === "blocked") navigationBlocker.proceed(); })}>保存并离开</ActionButton>
        </SiteDialogActions>
      </DialogContent>
    </Dialog>
  </div></SiteManagementScope></PageContainer>;
}

export function SiteEditorPage() {
  const { siteId = "" } = useParams();
  const query = useSite(siteId);
  return <WorkspaceShell>{query.isPending
    ? <PageContainer title="站点设置"><LoadingState label="正在打开站点…" variant="editor" /></PageContainer>
    : query.data ? <SiteEditor key={siteId} site={query.data} />
      : <div className={`${pageBaseColumnClassName} max-[1150px]:p-[30px] max-[800px]:px-5 max-[800px]:pt-[25px] max-[800px]:pb-[45px]`}><h1 className="mb-2.5 text-2xl font-semibold tracking-[-.04em]">无法打开站点</h1><Link to="/sites">返回所有站点</Link></div>
  }</WorkspaceShell>;
}

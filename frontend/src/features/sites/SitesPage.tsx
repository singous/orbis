import { Spinner } from "@orbis/ui/spinner";
import { reportError } from "../../shared/api/request-feedback";
import { LoadingState } from "../../shared/ui/LoadingState";
import { cn } from "@orbis/ui/cn";
import { WorkbenchResourceLink } from "../../shared/ui/WorkbenchResourceLink";
import { workbenchStyles } from "../../shared/ui/workbench-styles";
import { ArrowUpRight, ChevronRight, Globe, Plus } from "../../shared/ui/icons";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useRef, useState, type FormEvent } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useStore } from "zustand";
import { SitePagination } from "./SiteManagementLayout";

import { authStore } from "../../shared/auth/auth-store";
import { useAuthRequest } from "../../shared/auth/use-auth-request";
import { Button } from "@orbis/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogDescription } from "@orbis/ui/dialog";
import { PageContainer } from "../../shared/ui/PageContainer";
import { canMutateWorkspaceContent } from "../workspace/capabilities";
import { WorkspaceShell } from "../workspace/WorkspaceShell";
import { createSite } from "./api";
import { useSites } from "./queries";
import { SITE_KINDS, type SiteConfig } from "./schemas";
import { SiteDraftFields } from "./SiteDraftFields";

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
  const createButtonRef = useRef<HTMLButtonElement>(null);
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
  const create = useMutation({
    mutationFn: () => createSite(config, auth),
    onSuccess: async (site) => { await Promise.all([client.invalidateQueries({ queryKey: ["sites"] }), client.invalidateQueries({ queryKey: ["global-search"] })]); navigate(`/sites/${site.id}`); },
    onError: (error) => reportError(error),
  });

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
      <PageContainer title="你的文档站点" description="管理站点、组织目录并发布文档。" actions={canEdit ? <Button ref={createButtonRef} variant="default" onClick={openCreate}><Plus aria-hidden="true" size={16} />创建站点</Button> : null}>
        <section className={workbenchStyles.section} aria-label="文档站点">
          <header className={workbenchStyles.sectionHeading}><h2 className={workbenchStyles.sectionTitle}>全部站点</h2>{sites.data ? <span className={workbenchStyles.sectionCount}>{sites.data.pagination.total} 个站点</span> : null}</header>
          {sites.isPending ? <LoadingState label="正在加载站点…" variant="cards" /> : sites.isError ? (
            null
          ) : sites.data.items.length ? <>
            <div className={workbenchStyles.resourceGrid}>
              {sites.data.items.map((site) => (
                <WorkbenchResourceLink appearance="card" to={`/sites/${site.id}`} className="min-h-[108px] max-[850px]:min-h-[84px]" key={site.id} aria-label={`管理站点 ${site.name}`} icon={<Globe aria-hidden="true" size={24} />} iconStyle={{ color: site.accent_color }} title={site.name} caption={site.description || SITE_KINDS[site.site_kind].description} end={<ChevronRight className={workbenchStyles.resourceChevron} aria-hidden="true" size={18} />}>
                  <span className="mt-[3px] flex items-center gap-1.5 truncate text-sm text-(--muted-foreground)"><i className={cn("size-[5px] rounded-full", site.published_release_id ? "bg-(--status-success-foreground)" : "bg-(--muted-foreground)")} />{site.published_release_id ? "已发布" : "草稿"}</span>
                </WorkbenchResourceLink>
              ))}
            </div>
            <SitePagination hasPrevious={sites.data.pagination.has_previous} hasNext={sites.data.pagination.has_next} onPrevious={() => setPage(page - 1)} onNext={() => setPage(page + 1)}>第 {page} 页 · 共 {sites.data.pagination.total} 个站点</SitePagination>
          </> : (
            <div className={cn(workbenchStyles.emptySection, "min-h-[250px]")}><Globe aria-hidden="true" size={30} /><h2 className={workbenchStyles.emptyTitle}>从第一篇文档开始</h2><p className={workbenchStyles.emptyDescription}>选择内容、安排目录、预览发布。<br />读者看到你确认发布的版本。</p>{canEdit ? <Button onClick={openCreate} variant="outline">创建第一个站点<ArrowUpRight aria-hidden="true" size={16} /></Button> : <p className={workbenchStyles.emptyDescription}>工作空间的编辑者可以创建站点。</p>}</div>
          )}
        </section>
      </PageContainer>
      <Dialog open={open} onOpenChange={setOpen}><DialogContent className="max-h-[85dvh] overflow-y-auto sm:max-w-4xl" finalFocus={createButtonRef}><DialogHeader><DialogTitle>{"创建文档站点"}</DialogTitle><DialogDescription>{"先确定站点信息与内容来源，提交前不会创建站点。"}</DialogDescription></DialogHeader><form className="mt-[30px] grid min-w-0 gap-7 overflow-visible p-0" onSubmit={submit}><SiteDraftFields autoFocusName value={config} onChange={setConfig} disabled={create.isPending} /><DialogFooter className="mt-0 pt-1.5 max-[560px]:flex-wrap"><Button disabled={create.isPending} onClick={() => setOpen(false)} variant="outline">取消</Button><Button variant="default" type="submit" disabled={(create.isPending) || (create.isPending || config.source?.kind === "notebooks" && !config.source.notebooks.length)} focusableWhenDisabled={(create.isPending) && !(create.isPending || config.source?.kind === "notebooks" && !config.source.notebooks.length)} aria-busy={create.isPending || undefined}>{create.isPending ? <Spinner aria-hidden="true" /> : null}{create.isPending ? "创建中…" : "创建站点"}</Button></DialogFooter></form></DialogContent></Dialog>
    </WorkspaceShell>
  );
}

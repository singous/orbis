
import { cn } from "@orbis/ui/cn";
import { pageActionsClassName } from "@/shared/ui/PageContainer";
import { workbenchStyles } from "@/shared/ui/workbench-styles";
import { documentActionsMenuClassName } from "./document-layout";
import { releaseFeatures } from "../../shared/release-features";
import { reportError } from "../../shared/api/request-feedback";
import { DraftActions } from "../../shared/ui/DraftActions";

import {ApiError} from "../../shared/api/api-client";
import type { Notebook } from "../../shared/api/schemas";
import { newUUID } from "../../shared/ids";
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem } from "@orbis/ui/dropdown-menu";
import { Button } from "@orbis/ui/button";
import { Hand, Pin } from "@orbis/ui/icons";
import { ArrowLeft, Download, Globe2, Import, MoreHorizontal, Plus, Settings2 } from "../../shared/ui/icons";
import { type ChangeEvent, useEffect, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useStore } from "zustand";

import { ShareButton } from "../sharing/ShareButton";
import { authStore,getAuthSessionKey } from "../../shared/auth/auth-store";

import { DocumentContextPanel, DocumentContextSummaryProvider, useDocumentContextSummary } from "./DocumentContextPanel";
import { canMutateWorkspaceContent } from "../workspace/capabilities";
import { DocumentShell } from "./DocumentShell";
import { NotebookDialog } from "./NotebookDialog";
import { NotebookIdentity } from "./NotebookIdentity";
import { usePinnedNotebooks } from "./pinned-notebooks";
import { isUnavailableResourceError } from "./resource-errors";
import {
  useCreateNote,
  useExportMarkdown,
  useImportMarkdown,
  useNotebook,
  useUpdateNotebook,
} from "./queries";

const MAX_MARKDOWN_IMPORT_BYTES=2*1024*1024;

function NotebookPageContent({ collectionId }: { collectionId: string }) {
  const navigate = useNavigate();
  const workspace = useStore(authStore, (state) => state.workspace);
  const { isPinned, togglePin } = usePinnedNotebooks(workspace?.id);
  const pinned = isPinned(collectionId);
  const canEdit = canMutateWorkspaceContent(workspace);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const actionsTriggerRef = useRef<HTMLButtonElement>(null);
  const notebookQuery = useNotebook(collectionId);
  const importMarkdown = useImportMarkdown();
  const exportMarkdown = useExportMarkdown();
  const createNote = useCreateNote();
  const updateNotebook = useUpdateNotebook();
  const [editing, setEditing] = useState<Notebook | null>(null);
  function closeNotebookEditor() {
    setEditing(null);
  }
  const pendingImport = useRef<{intent:string;input:Parameters<typeof importMarkdown.mutateAsync>[0];uncertain:boolean}|null>(null);
  const [pendingImportTitle,setPendingImportTitle]=useState<string|null>(null);
  const [importBusy,setImportBusy]=useState(false);
  const importing=useRef(false);
  const importOwner=useRef(true);
  useEffect(()=>{importOwner.current=true;return()=>{importOwner.current=false;};},[]);
  const treeSummary = useDocumentContextSummary();
  const notebook = notebookQuery.data;
  const collectionUnavailable =
    isUnavailableResourceError(notebookQuery.error) || (!notebookQuery.isLoading && !notebookQuery.isError && !notebook);

  useEffect(() => {
    if (!collectionUnavailable) return;
    navigate("/documents/collections", {
      replace: true,
      state: {
        resourceError: "无法打开笔记本：它不存在、已归档，或你没有访问权限。",
      },
    });
  }, [collectionUnavailable, navigate]);

  async function executeImport(pending:NonNullable<typeof pendingImport.current>,scopeKey:string){
    const current=()=>importOwner.current&&getAuthSessionKey(authStore.getState())===scopeKey;
    try{
      const note=await importMarkdown.mutateAsync(pending.input);
      if(!current())return;
      pendingImport.current=null;setPendingImportTitle(null);navigate(`/documents/${note.id}`);
    }catch(error){
      if(!current())return;
      if(!pending.uncertain&&error instanceof ApiError&&error.status>=400&&error.status<500){pendingImport.current=null;setPendingImportTitle(null);}
      else{pending.uncertain=true;setPendingImportTitle(pending.input.title);}
      reportError(error);
    }
  }
  async function retryImport(){
    if(importing.current||!pendingImport.current)return;
    const key=getAuthSessionKey(authStore.getState());importing.current=true;setImportBusy(true);
    try{await executeImport(pendingImport.current,key);}
    finally{importing.current=false;if(importOwner.current&&getAuthSessionKey(authStore.getState())===key)setImportBusy(false);}
  }
  async function handleImport(event:ChangeEvent<HTMLInputElement>){
    const file=event.target.files?.[0];event.target.value="";
    if(!file||importing.current)return;
    const scopeKey=getAuthSessionKey(authStore.getState());importing.current=true;setImportBusy(true);
    try{
      if(file.size>MAX_MARKDOWN_IMPORT_BYTES)throw new Error("Markdown 文件不能超过 2 MiB。");
      const markdown=await file.text();
      if(!importOwner.current||getAuthSessionKey(authStore.getState())!==scopeKey)return;
      const title=file.name.replace(/\.md$/i,"")||"导入文档";
      const intent=JSON.stringify([collectionId,title,markdown]);
      if(pendingImport.current&&pendingImport.current.intent!==intent)throw new Error("上次导入结果尚未确认，请先重试原文件。");
      if(!pendingImport.current){pendingImport.current={intent,uncertain:false,input:{notebook_id:collectionId,title,markdown,parent_id:null,sort_order:treeSummary.rootCount,operation_id:newUUID()}};}
      await executeImport(pendingImport.current,scopeKey);
    }catch(error){if(importOwner.current&&getAuthSessionKey(authStore.getState())===scopeKey)reportError(error);}
    finally{importing.current=false;if(importOwner.current&&getAuthSessionKey(authStore.getState())===scopeKey)setImportBusy(false);}
  }

  async function createDocument() {
    const note = await createNote.mutateAsync({
      notebook_id: collectionId,
      title: "未命名文档",
      parent_id: null,
      sort_order: treeSummary.rootCount,
    });
    navigate(`/documents/${note.id}`);
  }

  async function exportAllDocuments() {
    for (const noteId of treeSummary.noteIds) {
      const result = await exportMarkdown.mutateAsync(noteId);
      const url = URL.createObjectURL(new Blob([result.markdown], { type: "text/markdown;charset=utf-8" }));
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = result.filename;
      anchor.click();
      URL.revokeObjectURL(url);
    }
  }

  if (collectionUnavailable) return null;

  return (
    <DocumentShell notebookId={collectionId}>
      <div className="notebook-home mx-auto w-full max-w-[1200px] px-[clamp(20px,3vw,48px)] pt-6 pb-12 max-[600px]:px-3 max-[600px]:pt-4 max-[600px]:pb-7">
        <Link to="/documents" className={workbenchStyles.back}><ArrowLeft aria-hidden="true" size={14} />文档中心</Link>
        <article className="min-h-[calc(100dvh-160px)] rounded-[16px] bg-card px-[clamp(28px,4vw,64px)] pt-12 pb-16 max-[600px]:min-h-[calc(100dvh-140px)] max-[600px]:rounded-xl max-[600px]:px-5 max-[600px]:pt-7 max-[600px]:pb-10" aria-label="笔记本首页">
          <header className="notebook-page-header mb-[120px] flex flex-wrap items-start justify-between gap-x-8 gap-y-6 max-[600px]:relative max-[600px]:mb-12 max-[600px]:gap-6">
            <NotebookIdentity notebook={notebook} variant="cover" metadata={treeSummary.state === "loading" ? "正在读取目录…" : treeSummary.state === "error" ? "目录暂不可用" : <><strong>{treeSummary.noteCount}</strong>{" "}<span>篇文档</span></>} />
            <div className={cn(pageActionsClassName, "gap-2.5 pt-0.5 max-[600px]:gap-2 max-[600px]:pt-0")}>
              {releaseFeatures.documentFavorites && <Button className="min-h-(--ob-control-height-md) rounded-xl border border-border bg-card enabled:hover:bg-(--accent)" size="sm" aria-label={pinned ? "取消常用笔记本" : "设为常用笔记本"} aria-pressed={pinned} title="常用笔记本会显示在左侧菜单和文档首页顶部"  onClick={() => togglePin(collectionId)} disabled={!workspace || !notebook}><Pin aria-hidden="true" />{pinned ? "已设为常用" : "设为常用"}</Button>}
              {canEdit && notebook && releaseFeatures.documentSharing ? <ShareButton notebookId={collectionId} title={notebook.title} /> : null}
              {canEdit ? <Button className="min-h-(--ob-control-height-md) rounded-xl border border-border bg-card enabled:hover:bg-(--accent)" size="sm"  onClick={() => void createDocument().catch(reportError)} disabled={createNote.isPending}><Plus aria-hidden="true" size={14} />新建文档</Button> : null}
              <input ref={fileInputRef} hidden type="file" accept=".md,text/markdown,text/plain" onChange={handleImport} />
              <DropdownMenu>
                <DropdownMenuTrigger render={<Button  ref={actionsTriggerRef} type="button" className={"grid size-(--ob-control-height-md) rounded-xl border border-border bg-card max-[600px]:absolute max-[600px]:top-0 max-[600px]:end-0"} aria-label="笔记本操作" title="更多操作" variant="ghost" size="icon"><MoreHorizontal aria-hidden="true" size={18} /></Button>} />
                <DropdownMenuContent className={cn(documentActionsMenuClassName, "w-[205px] p-[5px]")} align="end" sideOffset={8} aria-label="笔记本操作">
                  {canEdit ? <DropdownMenuItem label="编辑笔记本" onClick={() => setEditing(notebook ?? null)}><Settings2 aria-hidden="true" size={16} />编辑笔记本</DropdownMenuItem> : null}
                  {canEdit ? <DropdownMenuItem label="导入 Markdown" disabled={importBusy} onClick={() => fileInputRef.current?.click()}><Import aria-hidden="true" size={16} />导入 Markdown</DropdownMenuItem> : null}
                  <DropdownMenuItem label="导出全部" disabled={!treeSummary.noteCount || exportMarkdown.isPending} onClick={() => void exportAllDocuments().catch(reportError)}><Download aria-hidden="true" size={16} />导出全部</DropdownMenuItem>
                  {canEdit && releaseFeatures.sites ? <DropdownMenuItem label="创建文档站点" render={<Link to={`/sites?notebook=${collectionId}`}><Globe2 aria-hidden="true" size={16} />创建文档站点</Link>} /> : null}
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          </header>
          {pendingImportTitle?<DraftActions label="导入操作"><Button disabled={importBusy} onClick={()=>void retryImport()}>重试导入</Button></DraftActions>:null}
          <section className="notebook-home-intro mb-[104px] flex items-start gap-3 max-[600px]:mb-12" aria-labelledby="notebook-welcome-heading">
            <Hand aria-hidden="true" size={20} className="mt-0.5 shrink-0 text-(--ob-icon-amber)" />
            <div>
              <h2 id="notebook-welcome-heading" className="m-0 text-base font-semibold leading-6">欢迎来到笔记本</h2>
              <p className="mt-3.5 text-base leading-[1.9] text-(--muted-foreground) max-[600px]:mt-2.5 max-[600px]:text-sm max-[600px]:leading-[1.9]">笔记本就像一本书，让多篇文档结构化，方便知识的创作与沉淀。</p>
            </div>
          </section>
          <section aria-labelledby="notebook-directory-heading">
            <h2 id="notebook-directory-heading" className="sr-only">目录</h2>
            <DocumentContextPanel notebookId={collectionId} variant="main" />
          </section>
        </article>
      </div>
      {editing ? <NotebookDialog open title="编辑笔记本" initialValue={editing.title} initialIcon={editing.icon} submitLabel="保存" pending={updateNotebook.isPending} finalFocus={actionsTriggerRef} onClose={closeNotebookEditor} onSubmit={async ({ title, icon }) => { await updateNotebook.mutateAsync({ id: editing.id,expected_version:editing.metadata_version, title, icon }); closeNotebookEditor(); }} /> : null}
    </DocumentShell>
  );
}

export function NotebookPage() {
  const { collectionId = "" } = useParams();
  return <DocumentContextSummaryProvider key={collectionId}><NotebookPageContent collectionId={collectionId} /></DocumentContextSummaryProvider>;
}

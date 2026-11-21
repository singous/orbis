
import { cn } from "@orbis/ui/cn";
import { pageActionsClassName } from "@/shared/ui/PageContainer";
import { releaseFeatures } from "../../shared/release-features";
import { reportError } from "../../shared/api/request-feedback";
import { DraftActions } from "../../shared/ui/DraftActions";

import {ApiError} from "../../shared/api/api-client";
import type { Notebook } from "../../shared/api/schemas";
import { newUUID } from "../../shared/ids";
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem } from "@orbis/ui/dropdown-menu";
import { Button } from "@orbis/ui/button";
import { Pin } from "@orbis/ui/icons";
import { NotebookHomeLayout, NotebookHomeViews } from "./NotebookHomeLayout";
import { Download, Globe2, Import, MoreHorizontal, Settings2 } from "../../shared/ui/icons";
import { type ChangeEvent, useEffect, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useStore } from "zustand";

import { ShareButton } from "../sharing/ShareButton";
import { authStore,getAuthSessionKey } from "../../shared/auth/auth-store";

import { DocumentContextPanel, DocumentContextSummaryProvider, useDocumentContextSummary } from "./DocumentContextPanel";
import { canMutateWorkspaceContent } from "../workspace/capabilities";
import { DocumentShell } from "./DocumentShell";
import { EditNotebookDialog } from "./NotebookDialog";
import { NotebookCreateAction, useNotebookCreation } from "./NotebookSectionMenu";
import { NotebookMindMap } from "./NotebookMindMap";
import { NotebookIdentity } from "./NotebookIdentity";
import { usePinnedNotebooks } from "./pinned-notebooks";
import { isUnavailableResourceError } from "./resource-errors";
import {
  useDocumentGroups,
  useExportMarkdown,
  useImportMarkdown,
  useNotebook,
} from "./queries";

const MAX_MARKDOWN_IMPORT_BYTES=2*1024*1024;

function NotebookPageContent({ collectionId }: { collectionId: string }) {
  const navigate = useNavigate();
  const creation = useNotebookCreation(collectionId);
  const workspace = useStore(authStore, (state) => state.workspace);
  const { isPinned, togglePin } = usePinnedNotebooks(workspace?.id);
  const pinned = isPinned(collectionId);
  const canEdit = canMutateWorkspaceContent(workspace);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const actionsTriggerRef = useRef<HTMLButtonElement>(null);
  const notebookQuery = useNotebook(collectionId);
  const importMarkdown = useImportMarkdown();
  const exportMarkdown = useExportMarkdown();
  const groups = useDocumentGroups().data?.items ?? [];
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
  const groupName = groups.find(group => group.id === notebook?.group_id)?.name;
  const collectionUnavailable =
    isUnavailableResourceError(notebookQuery.error) || (!notebookQuery.isLoading && !notebookQuery.isError && !notebook);

  useEffect(() => {
    if (!collectionUnavailable) return;
    navigate("/documents", {
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
    <DocumentShell notebookId={collectionId} createAction={<NotebookCreateAction creation={creation} />}>
      <NotebookHomeLayout
        groupName={groupName}
        identity={<NotebookIdentity notebook={notebook} variant="cover" metadata={treeSummary.state === "loading" ? "正在读取目录…" : treeSummary.state === "error" ? "目录暂不可用" : <>
              <span>{treeSummary.noteCount} 项内容</span><span aria-hidden="true">·</span>
              <span>{treeSummary.kinds.document} 篇文档、{treeSummary.kinds.sheet} 个数据表、{treeSummary.kinds.board} 块画板</span>
            </>} />}
        actions={
            <div className={cn(pageActionsClassName, "gap-2 pt-1")}>
              {canEdit && notebook && releaseFeatures.documentSharing ? <ShareButton notebookId={collectionId} title={notebook.title} /> : null}
              {canEdit ? <NotebookCreateAction creation={creation} placement="header" /> : null}
              <input ref={fileInputRef} hidden type="file" accept=".md,text/markdown,text/plain" onChange={handleImport} />
              <DropdownMenu>
                <DropdownMenuTrigger render={<Button  ref={actionsTriggerRef} type="button" className="size-[34px]" aria-label="笔记本操作" title="更多操作" variant="secondary" size="icon"><MoreHorizontal aria-hidden="true" size={18} /></Button>} />
                <DropdownMenuContent size="sm" className="document-actions-popover" align="end" sideOffset={8} aria-label="笔记本操作">
                  {releaseFeatures.documentFavorites ? <DropdownMenuItem label={pinned ? "取消常用笔记本" : "设为常用笔记本"} disabled={!workspace || !notebook} onClick={() => togglePin(collectionId)}><Pin aria-hidden="true" />{pinned ? "取消常用笔记本" : "设为常用笔记本"}</DropdownMenuItem> : null}
                  {canEdit ? <DropdownMenuItem label="编辑笔记本" onClick={() => setEditing(notebook ?? null)}><Settings2 aria-hidden="true" size={16} />编辑笔记本</DropdownMenuItem> : null}
                  {canEdit ? <DropdownMenuItem label="导入 Markdown" disabled={importBusy} onClick={() => fileInputRef.current?.click()}><Import aria-hidden="true" size={16} />导入 Markdown</DropdownMenuItem> : null}
                  <DropdownMenuItem label="导出全部" disabled={!treeSummary.noteCount || exportMarkdown.isPending} onClick={() => void exportAllDocuments().catch(reportError)}><Download aria-hidden="true" size={16} />导出全部</DropdownMenuItem>
                  {canEdit && releaseFeatures.sites ? <DropdownMenuItem label="创建文档站点" render={<Link to={`/sites?notebook=${collectionId}`}><Globe2 aria-hidden="true" size={16} />创建文档站点</Link>} /> : null}
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
        }
        notice={pendingImportTitle?<DraftActions label="导入操作"><Button disabled={importBusy} onClick={()=>void retryImport()}>重试导入</Button></DraftActions>:null}
      >
        <NotebookHomeViews
          directory={<DocumentContextPanel notebookId={collectionId} variant="main" />}
          mindMap={<NotebookMindMap notebookId={collectionId} title={notebook?.title ?? "笔记本"} />}
        />
      </NotebookHomeLayout>
      {editing ? <EditNotebookDialog notebook={editing} finalFocus={actionsTriggerRef} onClose={closeNotebookEditor} /> : null}
    </DocumentShell>
  );
}

export function NotebookPage() {
  const { collectionId = "" } = useParams();
  return <DocumentContextSummaryProvider key={collectionId}><NotebookPageContent collectionId={collectionId} /></DocumentContextSummaryProvider>;
}

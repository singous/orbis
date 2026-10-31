import { releaseFeatures } from "../../shared/release-features";
import { reportError } from "../../shared/api/request-feedback";
import { DraftActions } from "../../shared/ui/DraftActions";

import {ApiError} from "../../shared/api/api-client";
import type { Notebook } from "../../shared/api/schemas";
import { newUUID } from "../../shared/ids";
import { ActionButton } from "../../shared/ui/ActionButton";
import { Dropdown } from "@heroui/react/dropdown";
import { Label } from "@heroui/react/label";
import { Hand, Pin } from "lucide-react";
import { ArrowLeft, Download, Globe2, Import, MoreHorizontal, Plus, Settings2 } from "../../shared/ui/icons";
import { type ChangeEvent, useEffect, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useStore } from "zustand";

import { ShareButton } from "../sharing/ShareButton";
import { authStore,getAuthSessionKey } from "../../shared/auth/auth-store";
import { Button } from "../../shared/ui/Button";
import { DocumentContextPanel, DocumentContextSummaryProvider, useDocumentContextSummary } from "./DocumentContextPanel";
import { canMutateWorkspaceContent } from "../workspace/capabilities";
import { DocumentShell } from "./DocumentShell";
import { NotebookDialog } from "./NotebookDialog";
import { NotebookIcon } from "./NotebookIcon";
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
    // The menu item that opened the dialog has unmounted. Restore its stable trigger.
    requestAnimationFrame(() => requestAnimationFrame(() => {
      const active = document.activeElement;
      if (!active || active === document.body || !active.isConnected || active.closest(".notebook-dialog")) {
        actionsTriggerRef.current?.focus();
      }
    }));
  }
  const pendingImport = useRef<{intent:string;operationID:string;input:Parameters<typeof importMarkdown.mutateAsync>[0];uncertain:boolean}|null>(null);
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
      if(!pendingImport.current){const operationID=newUUID();pendingImport.current={intent,operationID,uncertain:false,input:{notebook_id:collectionId,title,markdown,parent_id:null,sort_order:treeSummary.rootCount,operation_id:operationID}};}
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
      <div className="page-container notebook-home">
        <Link to="/documents" className="workbench-back"><ArrowLeft aria-hidden="true" size={14} />文档中心</Link>
        <article className="notebook-home-sheet" aria-label="笔记本首页">
          <header className="page-header notebook-page-header">
            <div className="notebook-identity">
              <NotebookIcon icon={notebook?.icon} size="lg" />
              <div className="notebook-identity-copy">
                <h1 className="page-title truncate" title={notebook?.title}>{notebook?.title ?? "正在加载…"}</h1>
                <p className="page-description notebook-home-stats" role="status" aria-label="文档统计">{treeSummary.state === "loading" ? "正在读取目录…" : treeSummary.state === "error" ? "目录暂不可用" : <><strong>{treeSummary.noteCount}</strong>{" "}<span>篇文档</span></>}</p>
              </div>
            </div>
            <div className="page-actions">
              {releaseFeatures.documentFavorites && <Button size="sm" aria-label={isPinned(collectionId) ? "取消常用笔记本" : "设为常用笔记本"} aria-pressed={isPinned(collectionId)} title="常用笔记本会显示在左侧菜单和文档首页顶部" icon={<Pin aria-hidden="true" />} onClick={() => togglePin(collectionId)} disabled={!workspace || !notebook}>{isPinned(collectionId) ? "已设为常用" : "设为常用"}</Button>}
              {canEdit && notebook ? (releaseFeatures.documentSharing ? <ShareButton notebookId={collectionId} title={notebook.title} /> : null) : null}
              {canEdit ? <Button size="sm" icon={<Plus aria-hidden="true" size={14} />} onClick={() => void createDocument().catch((error) => reportError(error))} disabled={createNote.isPending}>新建文档</Button> : null}
              <input ref={fileInputRef} className="hidden" type="file" accept=".md,text/markdown,text/plain" onChange={handleImport} />
              <Dropdown>
                <ActionButton ref={actionsTriggerRef} type="button" className="icon-button notebook-actions-trigger" aria-label="笔记本操作" title="更多操作"><MoreHorizontal aria-hidden="true" size={18} /></ActionButton>
                <Dropdown.Popover className="notebook-actions-popover" placement="bottom end" offset={8}>
                  <Dropdown.Menu aria-label="笔记本操作" onAction={(key) => {
                    if (key === "edit") setEditing(notebook ?? null);
                    if (key === "import") fileInputRef.current?.click();
                    if (key === "export") void exportAllDocuments().catch((error) => reportError(error));
                  }}>
                    {canEdit ? <Dropdown.Item id="edit" textValue="编辑笔记本"><Settings2 aria-hidden="true" /><Label>编辑笔记本</Label></Dropdown.Item> : null}
                    {canEdit ? <Dropdown.Item id="import" textValue="导入 Markdown" isDisabled={importBusy}><Import aria-hidden="true" /><Label>导入 Markdown</Label></Dropdown.Item> : null}
                    <Dropdown.Item id="export" textValue="导出全部" isDisabled={!treeSummary.noteCount || exportMarkdown.isPending}><Download aria-hidden="true" /><Label>导出全部</Label></Dropdown.Item>
                    {canEdit ? (releaseFeatures.sites ? <Dropdown.Item id="site" href={`/sites?notebook=${collectionId}`} textValue="创建文档站点" render={(props) => "href" in props ? <Link {...props} to={`/sites?notebook=${collectionId}`} /> : <div {...props} />}><Globe2 aria-hidden="true" /><Label>创建文档站点</Label></Dropdown.Item> : null) : null}
                  </Dropdown.Menu>
                </Dropdown.Popover>
              </Dropdown>
            </div>
          </header>
          {pendingImportTitle?<DraftActions label="导入操作"><Button disabled={importBusy} onClick={()=>void retryImport()}>重试导入</Button></DraftActions>:null}
          <section className="notebook-home-intro" aria-labelledby="notebook-welcome-heading">
            <Hand aria-hidden="true" size={20} className="notebook-home-welcome-icon" />
            <div>
              <h2 id="notebook-welcome-heading">欢迎来到笔记本</h2>
              <p>笔记本就像一本书，让多篇文档结构化，方便知识的创作与沉淀。</p>
            </div>
          </section>
          <section className="notebook-home-directory" aria-labelledby="notebook-directory-heading">
            <h2 id="notebook-directory-heading" className="sr-only">目录</h2>
            <DocumentContextPanel notebookId={collectionId} variant="main" />
          </section>
        </article>
      </div>
      {editing ? <NotebookDialog open={Boolean(editing)} title="编辑笔记本" initialValue={editing.title} initialIcon={editing.icon} submitLabel="保存" pending={updateNotebook.isPending} onClose={closeNotebookEditor} onSubmit={async ({ title, icon }) => { await updateNotebook.mutateAsync({ id: editing.id,expected_version:editing.metadata_version, title, icon }); closeNotebookEditor(); }} /> : null}
    </DocumentShell>
  );
}

export function NotebookPage() {
  const { collectionId = "" } = useParams();
  return <DocumentContextSummaryProvider key={collectionId}><NotebookPageContent collectionId={collectionId} /></DocumentContextSummaryProvider>;
}

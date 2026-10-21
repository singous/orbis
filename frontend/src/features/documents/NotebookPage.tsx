import {StatusMessage} from "../../shared/ui/StatusMessage";
import {ApiError} from "../../shared/api/api-client";
import type { Notebook } from "../../shared/api/schemas";
import { newUUID } from "../../shared/ids";
import { ActionButton } from "../../shared/ui/ActionButton";
import { Dropdown } from "@heroui/react/dropdown";
import { Label } from "@heroui/react/label";
import { ArrowLeft, Download, Globe2, Import, MoreHorizontal, Plus, Settings2 } from "../../shared/ui/icons";
import { type ChangeEvent, useEffect, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useStore } from "zustand";

import { ShareButton } from "../sharing/ShareButton";
import { authStore,getAuthSessionKey } from "../../shared/auth/auth-store";
import { Button } from "../../shared/ui/Button";
import { showToast } from "../../shared/ui/Toast";
import { DocumentContextPanel, DocumentContextSummaryProvider, useDocumentContextSummary } from "./DocumentContextPanel";
import { canMutateWorkspaceContent } from "../workspace/capabilities";
import { DocumentShell } from "./DocumentShell";
import { NotebookDialog } from "./NotebookDialog";
import { NotebookIcon } from "./NotebookIcon";
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
  const canEdit = canMutateWorkspaceContent(workspace);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const notebookQuery = useNotebook(collectionId);
  const importMarkdown = useImportMarkdown();
  const exportMarkdown = useExportMarkdown();
  const createNote = useCreateNote();
  const updateNotebook = useUpdateNotebook();
  const [editing, setEditing] = useState<Notebook | null>(null);
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
      showToast({title:"导入失败",description:error instanceof Error?error.message:"请稍后重试。",tone:"danger"});
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
    }catch(error){if(importOwner.current&&getAuthSessionKey(authStore.getState())===scopeKey)showToast({title:"导入失败",description:error instanceof Error?error.message:"请稍后重试。",tone:"danger"});}
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
        <header className="page-header notebook-page-header">
          <div className="notebook-identity">
            <NotebookIcon icon={notebook?.icon} size="lg" />
            <div className="notebook-identity-copy">
              <h1 className="page-title truncate" title={notebook?.title}>{notebook?.title ?? "正在加载…"}</h1>
              <p className="page-description">{treeSummary.state === "loading" ? "正在读取目录…" : `${treeSummary.noteCount} 篇文档`}</p>
            </div>
          </div>
          <div className="page-actions">
            {canEdit && notebook ? <ShareButton notebookId={collectionId} title={notebook.title} /> : null}
            {canEdit ? <Button variant="primary" icon={<Plus aria-hidden="true" size={14} />} onClick={() => void createDocument().catch((error) => showToast({ title: "创建文档失败", description: error instanceof Error ? error.message : "请稍后重试。", tone: "danger" }))} disabled={createNote.isPending}>新建文档</Button> : null}
            <input ref={fileInputRef} className="hidden" type="file" accept=".md,text/markdown,text/plain" onChange={handleImport} />
            <Dropdown>
              <ActionButton type="button" className="icon-button notebook-actions-trigger" aria-label="笔记本操作" title="更多操作"><MoreHorizontal aria-hidden="true" size={18} /></ActionButton>
              <Dropdown.Popover className="notebook-actions-popover" placement="bottom end" offset={8}>
                <Dropdown.Menu aria-label="笔记本操作" onAction={(key) => {
                  if (key === "edit") setEditing(notebook ?? null);
                  if (key === "import") fileInputRef.current?.click();
                  if (key === "export") void exportAllDocuments().catch((error) => showToast({ title: "导出失败", description: error instanceof Error ? error.message : "请稍后重试。", tone: "danger" }));
                }}>
                  {canEdit ? <Dropdown.Item id="edit" textValue="编辑笔记本"><Settings2 aria-hidden="true" /><Label>编辑笔记本</Label></Dropdown.Item> : null}
                  {canEdit ? <Dropdown.Item id="import" textValue="导入 Markdown" isDisabled={importBusy}><Import aria-hidden="true" /><Label>导入 Markdown</Label></Dropdown.Item> : null}
                  <Dropdown.Item id="export" textValue="导出全部" isDisabled={!treeSummary.noteCount || exportMarkdown.isPending}><Download aria-hidden="true" /><Label>导出全部</Label></Dropdown.Item>
                  {canEdit ? <Dropdown.Item id="site" href={`/sites?notebook=${collectionId}`} textValue="创建文档站点" render={(props) => "href" in props ? <Link {...props} to={`/sites?notebook=${collectionId}`} /> : <div {...props} />}><Globe2 aria-hidden="true" /><Label>创建文档站点</Label></Dropdown.Item> : null}
                </Dropdown.Menu>
              </Dropdown.Popover>
            </Dropdown>
          </div>
        </header>
        {pendingImportTitle?<StatusMessage tone="warning" title="导入结果尚未确认">原文件“{pendingImportTitle}”已保留，可以重试以确认结果。<Button disabled={importBusy} onClick={()=>void retryImport()}>重试导入</Button></StatusMessage>:null}
        <section className="notebook-home-directory" aria-labelledby="notebook-directory-heading">
          <div className="workbench-section-heading"><h2 id="notebook-directory-heading">目录</h2>{treeSummary.noteCount ? <span className="notebook-directory-updated-label">更新时间</span> : null}</div>
          <DocumentContextPanel notebookId={collectionId} variant="main" />
        </section>
      </div>
      {editing ? <NotebookDialog open={Boolean(editing)} title="编辑笔记本" initialValue={editing.title} initialIcon={editing.icon} submitLabel="保存" pending={updateNotebook.isPending} onClose={() => setEditing(null)} onSubmit={async ({ title, icon }) => { await updateNotebook.mutateAsync({ id: editing.id,expected_version:editing.metadata_version, title, icon }); setEditing(null); }} /> : null}
    </DocumentShell>
  );
}

export function NotebookPage() {
  const { collectionId = "" } = useParams();
  return <DocumentContextSummaryProvider key={collectionId}><NotebookPageContent collectionId={collectionId} /></DocumentContextSummaryProvider>;
}

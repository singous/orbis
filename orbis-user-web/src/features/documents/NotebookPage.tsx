import { ActionButton } from "../../shared/ui/ActionButton";
import { Dropdown } from "@heroui/react/dropdown";
import { Label } from "@heroui/react/label";
import { ArrowLeft, Download, Globe2, Import, MoreHorizontal, Plus, Settings2 } from "../../shared/ui/icons";
import { type ChangeEvent, useEffect, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useStore } from "zustand";

import { ShareButton } from "../sharing/ShareButton";
import { authStore } from "../../shared/auth/auth-store";
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
  const [editing, setEditing] = useState(false);
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

  async function handleImport(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    try {
      const markdown = await file.text();
      const title = file.name.replace(/\.md$/i, "") || "导入文档";
      const note = await importMarkdown.mutateAsync({ notebook_id: collectionId, title, markdown, parent_id: null, sort_order: treeSummary.rootCount });
      navigate(`/documents/${note.id}`);
    } catch (error) {
      showToast({ title: "导入失败", description: error instanceof Error ? error.message : "请稍后重试。", tone: "danger" });
    }
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
                  if (key === "edit") setEditing(true);
                  if (key === "import") fileInputRef.current?.click();
                  if (key === "export") void exportAllDocuments().catch((error) => showToast({ title: "导出失败", description: error instanceof Error ? error.message : "请稍后重试。", tone: "danger" }));
                }}>
                  {canEdit ? <Dropdown.Item id="edit" textValue="编辑笔记本"><Settings2 aria-hidden="true" /><Label>编辑笔记本</Label></Dropdown.Item> : null}
                  {canEdit ? <Dropdown.Item id="import" textValue="导入 Markdown" isDisabled={importMarkdown.isPending}><Import aria-hidden="true" /><Label>导入 Markdown</Label></Dropdown.Item> : null}
                  <Dropdown.Item id="export" textValue="导出全部" isDisabled={!treeSummary.noteCount || exportMarkdown.isPending}><Download aria-hidden="true" /><Label>导出全部</Label></Dropdown.Item>
                  {canEdit ? <Dropdown.Item id="site" href={`/sites?notebook=${collectionId}`} textValue="创建文档站点" render={(props) => "href" in props ? <Link {...props} to={`/sites?notebook=${collectionId}`} /> : <div {...props} />}><Globe2 aria-hidden="true" /><Label>创建文档站点</Label></Dropdown.Item> : null}
                </Dropdown.Menu>
              </Dropdown.Popover>
            </Dropdown>
          </div>
        </header>
        <section className="notebook-home-directory" aria-labelledby="notebook-directory-heading">
          <div className="workbench-section-heading"><h2 id="notebook-directory-heading">目录</h2>{treeSummary.noteCount ? <span className="notebook-directory-updated-label">更新时间</span> : null}</div>
          <DocumentContextPanel notebookId={collectionId} variant="main" />
        </section>
      </div>
      {notebook ? <NotebookDialog open={editing} title="编辑笔记本" initialValue={notebook.title} initialIcon={notebook.icon} submitLabel="保存" pending={updateNotebook.isPending} onClose={() => setEditing(false)} onSubmit={async ({ title, icon }) => { await updateNotebook.mutateAsync({ id: notebook.id, title, icon }); setEditing(false); }} /> : null}
    </DocumentShell>
  );
}

export function NotebookPage() {
  const { collectionId = "" } = useParams();
  return <DocumentContextSummaryProvider key={collectionId}><NotebookPageContent collectionId={collectionId} /></DocumentContextSummaryProvider>;
}

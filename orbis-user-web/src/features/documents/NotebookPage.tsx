import { ArrowLeft, Download, Globe2, Import, Plus, Settings2 } from "lucide-react";
import { type ChangeEvent, useEffect, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useStore } from "zustand";

import { authStore } from "../../shared/auth/auth-store";
import { Button } from "../../shared/ui/Button";
import { DocumentContextPanel, DocumentContextSummaryProvider, useDocumentContextSummary } from "./DocumentContextPanel";
import { canMutateWorkspaceContent } from "../workspace/capabilities";
import { DocumentShell } from "./DocumentShell";
import { NotebookDialog } from "./NotebookDialog";
import { NotebookIcon } from "./NotebookIcon";
import { NotebookSectionMenu } from "./NotebookSectionMenu";
import {
  useCreateNote,
  useExportMarkdown,
  useImportMarkdown,
  useNotebooks,
  useUpdateNotebook,
} from "./queries";

function NotebookPageContent({ collectionId }: { collectionId: string }) {
  const navigate = useNavigate();
  const workspace = useStore(authStore, (state) => state.workspace);
  const canEdit = canMutateWorkspaceContent(workspace);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const notebooksQuery = useNotebooks();
  const importMarkdown = useImportMarkdown();
  const exportMarkdown = useExportMarkdown();
  const createNote = useCreateNote();
  const updateNotebook = useUpdateNotebook();
  const [editing, setEditing] = useState(false);
  const treeSummary = useDocumentContextSummary();
  const notebook = notebooksQuery.data?.items.find((item) => item.id === collectionId);
  const collectionUnavailable =
    !notebooksQuery.isLoading && !notebooksQuery.isError && !notebook;

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
    const markdown = await file.text();
    const title = file.name.replace(/\.md$/i, "") || "导入文档";
    const note = await importMarkdown.mutateAsync({ notebook_id: collectionId, title, markdown, parent_id: null, sort_order: treeSummary.rootCount });
    navigate(`/documents/${note.id}`);
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

  async function exportAllVisible() {
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
    <DocumentShell sectionMenu={<NotebookSectionMenu notebookId={collectionId} />}>
      <div className="page-container">
        <Link to="/documents" className="workbench-back"><ArrowLeft aria-hidden="true" size={14} />文档中心</Link>
        <header className="page-header notebook-page-header">
          <div className="notebook-identity">
            <NotebookIcon icon={notebook?.icon} size="lg" />
            <div className="notebook-identity-copy">
              <h1 className="page-title truncate">{notebook?.title ?? "正在加载…"}</h1>
              <p className="page-description">{treeSummary.noteCount} 篇文档</p>
            </div>
          </div>
          <div className="page-actions">
            {canEdit ? <button type="button" className="icon-button" aria-label="编辑笔记本" title="编辑名称和图标" onClick={() => setEditing(true)}><Settings2 size={17} /></button> : null}
            <input ref={fileInputRef} className="hidden" type="file" accept=".md,text/markdown,text/plain" onChange={handleImport} />
            <Button variant="secondary" icon={<Download aria-hidden="true" size={14} />} onClick={exportAllVisible} disabled={!treeSummary.noteCount || exportMarkdown.isPending}>导出全部</Button>
            {canEdit ? <Link className="ui-button ui-button--md border border-[var(--border-subtle)] bg-[var(--surface-content)] text-[var(--text-primary)] hover:bg-[var(--surface-hover)]" to={`/sites?notebook=${collectionId}`}><Globe2 aria-hidden="true" size={14} />创建文档站点</Link> : null}
            {canEdit ? <Button variant="secondary" icon={<Import aria-hidden="true" size={14} />} onClick={() => fileInputRef.current?.click()} disabled={importMarkdown.isPending}>导入 Markdown</Button> : null}
            {canEdit ? <Button variant="primary" icon={<Plus aria-hidden="true" size={14} />} onClick={() => void createDocument()} disabled={createNote.isPending}>新建文档</Button> : null}
          </div>
        </header>
        <div className="workbench-section-heading"><h2>文档列表</h2><span className="workbench-section-count">{treeSummary.noteCount} 篇</span></div>

        <DocumentContextPanel notebookId={collectionId} variant="main" />
      </div>
      {notebook ? <NotebookDialog open={editing} title="编辑笔记本" initialValue={notebook.title} initialIcon={notebook.icon} submitLabel="保存" pending={updateNotebook.isPending} onClose={() => setEditing(false)} onSubmit={async ({ title, icon }) => { await updateNotebook.mutateAsync({ id: notebook.id, title, icon }); setEditing(false); }} /> : null}
    </DocumentShell>
  );
}

export function NotebookPage() {
  const { collectionId = "" } = useParams();
  return <DocumentContextSummaryProvider key={collectionId}><NotebookPageContent collectionId={collectionId} /></DocumentContextSummaryProvider>;
}

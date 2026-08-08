import { ArrowLeft, BookOpen, Download, FilePlus2, Import } from "lucide-react";
import { type ChangeEvent, useRef } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useStore } from "zustand";

import { authStore } from "../../shared/auth/auth-store";
import { Button } from "../../shared/ui/Button";
import { StatusMessage } from "../../shared/ui/StatusMessage";
import { DocumentContextPanel, DocumentContextSummaryProvider, useDocumentContextSummary } from "./DocumentContextPanel";
import { DocumentShell } from "./DocumentShell";
import {
  useExportMarkdown,
  useImportMarkdown,
  useNotebooks,
} from "./queries";

function NotebookPageContent({ collectionId }: { collectionId: string }) {
  const navigate = useNavigate();
  const workspace = useStore(authStore, (state) => state.workspace);
  const canEdit = workspace?.role !== "normal";
  const fileInputRef = useRef<HTMLInputElement>(null);
  const notebooksQuery = useNotebooks();
  const importMarkdown = useImportMarkdown();
  const exportMarkdown = useExportMarkdown();
  const treeSummary = useDocumentContextSummary();
  const notebook = notebooksQuery.data?.items.find((item) => item.id === collectionId);

  async function handleImport(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    const markdown = await file.text();
    const title = file.name.replace(/\.md$/i, "") || "导入文档";
    const note = await importMarkdown.mutateAsync({ notebook_id: collectionId, title, markdown, parent_id: null, sort_order: treeSummary.rootCount });
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

  if (!notebooksQuery.isLoading && !notebook) {
    return <DocumentShell><div className="mx-auto max-w-3xl p-8"><StatusMessage tone="error" title="文集不存在">它可能已归档，或你没有访问权限。</StatusMessage><Link to="/documents" className="mt-4 inline-flex text-sm font-semibold">返回文档中心</Link></div></DocumentShell>;
  }

  return (
    <DocumentShell contextPanel={<DocumentContextPanel notebookId={collectionId} />}>
      <div className="mx-auto max-w-[1040px] px-5 py-8 lg:px-10 lg:py-10">
        <Link to="/documents" className="mb-8 inline-flex items-center gap-2 text-xs font-medium text-[var(--muted)] hover:text-black"><ArrowLeft aria-hidden="true" size={14} />文档中心</Link>
        <header className="notebook-hero">
          <div className="document-icon large"><BookOpen aria-hidden="true" size={25} /></div>
          <div className="min-w-0 flex-1"><div className="mb-2 text-[10px] font-semibold uppercase tracking-[0.18em] text-[var(--muted-light)]">Collection</div><h1 className="truncate text-4xl font-semibold tracking-[-0.045em] lg:text-5xl">{notebook?.title ?? "正在加载…"}</h1><p className="mt-4 max-w-2xl text-sm leading-6 text-[var(--muted)]">集中管理这个文集里的章节与页面。子文档会继承清晰的层级，但内容始终独立保存。</p><div className="mt-5 flex flex-wrap gap-2"><span className="tag">{treeSummary.noteCount} 篇文档</span><span className="tag">结构化内容</span><span className="tag">自动保存</span></div></div>
        </header>

        <div className="mb-5 mt-10 flex flex-wrap items-center justify-between gap-3">
          <div><h2 className="text-lg font-semibold tracking-[-0.02em]">文档操作</h2><p className="mt-1 text-xs text-[var(--muted)]">目录已移至右侧上下文面板</p></div>
          <div className="flex flex-wrap gap-2">
            <input ref={fileInputRef} className="hidden" type="file" accept=".md,text/markdown,text/plain" onChange={handleImport} />
            {canEdit ? <Button variant="secondary" icon={<Import aria-hidden="true" size={14} />} onClick={() => fileInputRef.current?.click()} disabled={importMarkdown.isPending}>导入 Markdown</Button> : null}
            <Button variant="secondary" icon={<Download aria-hidden="true" size={14} />} onClick={exportAllVisible} disabled={!treeSummary.noteCount || exportMarkdown.isPending}>导出全部</Button>
          </div>
        </div>

        {treeSummary.state === "loading" ? <div className="empty-panel">正在加载文档目录…</div> : null}
        {treeSummary.state === "success" && !treeSummary.noteCount ? <div className="empty-panel py-16"><FilePlus2 aria-hidden="true" className="mx-auto mb-3" size={26} /><div className="font-semibold text-black">从第一篇文档开始</div><p className="mt-1">可以直接写作，也可以导入已有 Markdown。</p></div> : null}
      </div>
    </DocumentShell>
  );
}

export function NotebookPage() {
  const { collectionId = "" } = useParams();
  return <DocumentContextSummaryProvider key={collectionId}><NotebookPageContent collectionId={collectionId} /></DocumentContextSummaryProvider>;
}

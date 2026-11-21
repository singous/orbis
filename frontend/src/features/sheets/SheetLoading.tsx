import { Button } from "@orbis/ui/button";
import { MessageSquare, MoreHorizontal } from "@orbis/ui/icons";
import { LoadingState } from "../../shared/ui/LoadingState";
import { releaseFeatures } from "../../shared/release-features";
import { DocumentBreadcrumb } from "../documents/editor/DocumentEditorHeading";
import { DocumentSaveStatus } from "../documents/editor/DocumentSaveStatus";
import { createNotebookSidebar } from "../documents/NotebookSectionMenu";
import { WorkspaceShell } from "../workspace/WorkspaceShell";
import { SheetRecordToolbar } from "./SheetRecordToolbar";
import { sheetWorkspaceClassName } from "./sheet-chrome";

type Props = {
  title?: string;
  notebookId?: string;
  notebookTitle?: string;
  documentId?: string;
  canEdit: boolean;
  embedded?: boolean;
  onRetry?: () => void;
};

export function SheetLoading({ title = "数据表", notebookId, notebookTitle, documentId, canEdit, embedded, onRetry }: Props) {
  const records = (
    <div className={sheetWorkspaceClassName}>
      <div className="min-h-11" />
      <SheetRecordToolbar canEdit={canEdit} embedded={embedded} />
      {onRetry ? <div className="flex items-center gap-3 px-5 py-4 text-muted-foreground" role="alert">
        无法读取数据表。<Button size="sm" variant="secondary" onClick={onRetry}>重试</Button>
      </div> : <div className="px-5"><LoadingState label="正在读取数据表…" compact /></div>}
    </div>
  );
  if (embedded) return records;
  return (
    <WorkspaceShell contentLayout="document" sidebar={notebookId ? createNotebookSidebar(notebookId, documentId) : undefined}
      sectionTitle={<DocumentBreadcrumb notebookId={notebookId} notebookTitle={notebookTitle} title={title} />}
      toolbar={<div className="sheet-header-actions flex items-center gap-2">
        <DocumentSaveStatus state={onRetry ? "error" : "loading"} label={onRetry ? "读取失败" : undefined} />
        {releaseFeatures.documentCollaboration ? <Button disabled variant="ghost" size="sm" aria-label="评论"><MessageSquare size={16} /><span>评论</span></Button> : null}
        <Button disabled variant="ghost" size="icon" aria-label="更多文档操作"><MoreHorizontal size={18} /></Button>
      </div>}
    >{records}</WorkspaceShell>
  );
}

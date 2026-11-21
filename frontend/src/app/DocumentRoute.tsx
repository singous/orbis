import { lazy, Suspense, useMemo } from "react";
import { Navigate, useParams } from "react-router-dom";
import { useStore } from "zustand";
import { Button } from "@orbis/ui/button";
import { MessageSquare, MoreHorizontal } from "@orbis/ui/icons";
import { BoardLoading } from "../features/boards/BoardLoading";
import { SheetLoading } from "../features/sheets/SheetLoading";
import { DocumentBreadcrumb, DocumentEditorHeading } from "../features/documents/editor/DocumentEditorHeading";
import { DocumentFormatToolbar } from "../features/documents/editor/DocumentFormatToolbar";
import { DocumentSaveStatus } from "../features/documents/editor/DocumentSaveStatus";
import { EditorLayout, EditorOutlineStore } from "../features/documents/editor/EditorLayout";
import { documentHeaderActionsClassName, editorCanvasClassName } from "../features/documents/editor/document-chrome";
import { LoadingState } from "../shared/ui/LoadingState";
import { DocumentShell } from "../features/documents/DocumentShell";
import { DocumentPendingContent, documentPendingChrome } from "../features/documents/DocumentPending";
import { isUnavailableResourceError } from "../features/documents/resource-errors";
import { useNote, useNotebook } from "../features/documents/queries";
import { canMutateWorkspaceContent } from "../features/workspace/capabilities";
import type { Note } from "../shared/api/schemas";
import { authStore } from "../shared/auth/auth-store";
import { releaseFeatures } from "../shared/release-features";

const LegacyDocumentEditorPage = lazy(() => import("../features/documents/editor/LegacyDocumentEditorPage").then(module => ({ default: module.LegacyDocumentEditorPage })));
const SheetDocument = lazy(() => import("../features/sheets/SheetWorkspace").then(module => ({ default: module.SheetWorkspace })));
const BoardDocument = lazy(() => import("../features/boards/BoardEditor").then(module => ({ default: module.BoardEditor })));
const CollaborativeDocumentEditorPage = lazy(() => import("../features/documents/editor/CollaborativeDocumentEditorPage"));

function DocumentLoading({ note, noteId, canEdit }: { note?: Note; noteId: string; canEdit: boolean }) {
  const outline = useMemo(() => new EditorOutlineStore(), [noteId]);
  const notebook = useNotebook(note?.notebook_id);
  const title = note?.title || "文档";
  if (!note) return <DocumentShell editorLayout breadcrumb={documentPendingChrome.sectionTitle} toolbar={documentPendingChrome.toolbar}>
    <DocumentPendingContent />
  </DocumentShell>;
  const toolbar = (
    <div className={documentHeaderActionsClassName}>
      <DocumentSaveStatus state="loading" />
      {releaseFeatures.documentCollaboration ? <Button disabled size="icon" variant="secondary" aria-label="评论与历史"><MessageSquare size={16} /></Button> : null}
      {canEdit ? <Button disabled size="icon" variant="secondary" aria-label="更多文档操作"><MoreHorizontal size={18} /></Button> : null}
    </div>
  );
  return (
    <DocumentShell editorLayout pendingFormat={canEdit ? <DocumentFormatToolbar /> : undefined} notebookId={note?.notebook_id} activeNoteId={noteId}
      breadcrumb={<DocumentBreadcrumb notebookId={note?.notebook_id} notebookTitle={notebook.data?.title} title={title} />}
      toolbar={toolbar}
    >
      <EditorLayout outlineStore={outline} pending>
        <article className={editorCanvasClassName}>
          <DocumentEditorHeading title={title} updatedAt={note?.updated_at_ms} />
          <LoadingState label="正在打开文档…" variant="editor-body" bones="document-body" />
        </article>
      </EditorLayout>
    </DocumentShell>
  );
}

const unavailableDocumentState = { resourceError: "无法打开文档：它不存在、已归档，或你没有访问权限。" };

/** Select a document runtime without importing another editor's implementation. */
export function DocumentRoute() {
  const { noteId = "" } = useParams();
  const note = useNote(noteId);
  const canEdit = canMutateWorkspaceContent(useStore(authStore, state => state.workspace));
  if (isUnavailableResourceError(note.error)) return <Navigate to="/documents" replace state={unavailableDocumentState} />;
  if (note.isPending) return <DocumentLoading noteId={noteId} canEdit={canEdit} />;
  if (note.data?.board_id) {
    const board = { title: note.data.title, collection_id: note.data.notebook_id, document_id: note.data.id };
    return <Suspense fallback={<BoardLoading board={board} />}><BoardDocument key={note.data.id} id={note.data.board_id} document={board} /></Suspense>;
  }
  if (note.data?.sheet_id) {
    const sheet = note.data;
    return (
      <Suspense fallback={<SheetLoading canEdit={canEdit} title={sheet.title} notebookId={sheet.notebook_id} documentId={noteId} />}>
        <SheetDocument key={sheet.id} id={note.data.sheet_id} documentNote={sheet} />
      </Suspense>
    );
  }
  const fallback = <DocumentLoading note={note.data} noteId={noteId} canEdit={canEdit} />;
  if (note.data?.collaboration_available === true) return <Suspense fallback={fallback}><CollaborativeDocumentEditorPage /></Suspense>;
  return <Suspense fallback={fallback}><LegacyDocumentEditorPage /></Suspense>;
}

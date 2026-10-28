import { lazy, Suspense } from "react";
import { Navigate, useParams } from "react-router-dom";
import { LoadingState } from "../shared/ui/LoadingState";
import { DocumentShell } from "../features/documents/DocumentShell";
import { isUnavailableResourceError } from "../features/documents/resource-errors";
import { useNote } from "../features/documents/queries";

const LegacyDocumentEditorPage = lazy(() => import("../features/documents/editor/LegacyDocumentEditorPage").then(module => ({ default: module.LegacyDocumentEditorPage })));
const SheetDocument = lazy(() => import("../features/sheets/SheetWorkspace").then(module => ({ default: module.SheetWorkspace })));
const BoardDocument = lazy(() => import("../features/boards/BoardEditor").then(module => ({ default: module.BoardEditor })));
const CollaborativeDocumentEditorPage = lazy(() => import("../features/documents/editor/CollaborativeDocumentEditorPage"));

function DocumentLoading({ label = "正在打开文档…" }: { label?: string }) {
  return <DocumentShell loading><LoadingState label={label} variant="editor" /></DocumentShell>;
}

const unavailableDocumentState = { resourceError: "无法打开文档：它不存在、已归档，或你没有访问权限。" };

/** Select a document runtime without importing another editor's implementation. */
export function DocumentRoute() {
  const { noteId = "" } = useParams();
  const note = useNote(noteId);
  if (isUnavailableResourceError(note.error)) return <Navigate to="/documents/collections" replace state={unavailableDocumentState} />;
  if (note.isPending) return <DocumentLoading />;
  if (note.data?.board_id) return <Suspense fallback={<DocumentLoading label="正在打开画板…" />}><BoardDocument key={note.data.id} id={note.data.board_id}/></Suspense>;
  if (note.data?.sheet_id) return <Suspense fallback={<DocumentLoading label="正在打开数据表…" />}><SheetDocument key={note.data.id} id={note.data.sheet_id} /></Suspense>;
  if (note.data?.collaboration_available === true) return <Suspense fallback={<DocumentLoading />}><CollaborativeDocumentEditorPage /></Suspense>;
  return <Suspense fallback={<DocumentLoading />}><LegacyDocumentEditorPage /></Suspense>;
}

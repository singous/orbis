import { LoadingState } from "../../shared/ui/LoadingState";
import { DocumentBreadcrumb } from "./editor/DocumentEditorHeading";
import { DocumentSaveStatus } from "./editor/DocumentSaveStatus";
import { editorCanvasClassName } from "./editor/document-chrome";

export const documentPendingChrome = {
  contentLayout: "document",
  sectionTitle: <DocumentBreadcrumb title="文档" />,
  toolbar: <DocumentSaveStatus state="loading" />,
} as const;

export function DocumentPendingContent() {
  return (
    <article className={`${editorCanvasClassName} mx-auto`} aria-label="文档正文">
      <LoadingState label="正在打开文档…" variant="editor-body" />
    </article>
  );
}

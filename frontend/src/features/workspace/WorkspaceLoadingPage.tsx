import { WorkspaceLoadingContent, type WorkspaceLoadingKind } from "./WorkspaceLoadingContent";
import { WorkspaceShell } from "./WorkspaceShell";
import { documentPendingChrome } from "../documents/DocumentPending";
import { LoadingState } from "../../shared/ui/LoadingState";
import { notebookSidebarLayout, NotebookSidebarBackLink } from "../documents/NotebookSidebarLayout";

const pendingNotebookSidebar = {
  ...notebookSidebarLayout,
  leadingActions: <NotebookSidebarBackLink />,
  title: <span className="text-sm text-muted-foreground">笔记本</span>,
  content: <LoadingState label="正在读取笔记本导航…" compact />,
};

/** Lazy routes keep the same workspace frame while their code is arriving. */
export function WorkspaceLoadingPage({ loadingKind }: { loadingKind?: WorkspaceLoadingKind }) {
  return (
    <WorkspaceShell loading={!loadingKind} {...(loadingKind === "document" ? documentPendingChrome : {})}
      sidebar={loadingKind === "notebook" ? pendingNotebookSidebar : undefined}
    >
      <WorkspaceLoadingContent loadingKind={loadingKind} />
    </WorkspaceShell>
  );
}

import { ActionButton } from "../../shared/ui/ActionButton";
import type { ReactNode } from "react";
import { PanelRightClose } from "../../shared/ui/icons";
import { useEffect, useState } from "react";
import { useStore } from "zustand";

import { authStore } from "../../shared/auth/auth-store";
import { EditorToolbarFrame } from "./editor/EditorToolbarHost";
import { createNotebookSidebar } from "./NotebookSectionMenu";
import { WorkspaceNavigation } from "../workspace/WorkspaceNavigation";
import { WorkspaceShell } from "../workspace/WorkspaceShell";
import { readDocumentContextOpen, writeDocumentContextOpen } from "./document-context-state";

type DocumentShellProps = {
  children: ReactNode;
  toolbar?: ReactNode;
  breadcrumb?: ReactNode;
  editorLayout?: boolean;
  contextPanel?: ReactNode;
  contextOpen?: boolean;
  onOpenContext?: () => void;
  notebookId?: string;
  activeNoteId?: string;
};

export function DocumentShell({ children, toolbar, breadcrumb, editorLayout = false, contextPanel, contextOpen, onOpenContext, notebookId, activeNoteId }: DocumentShellProps) {
  const workspaceId = useStore(authStore, (state) => state.workspace?.id);
  const [storedContextOpen, setStoredContextOpen] = useState(() => workspaceId ? readDocumentContextOpen(workspaceId) : true);
  const isContextOpen = contextOpen ?? storedContextOpen;

  useEffect(() => {
    setStoredContextOpen(workspaceId ? readDocumentContextOpen(workspaceId) : true);
  }, [workspaceId]);

  function setContextOpen(next: boolean) {
    if (workspaceId) writeDocumentContextOpen(workspaceId, next);
    setStoredContextOpen(next);
  }

  return (
    <WorkspaceShell
      sidebar={notebookId ? createNotebookSidebar(notebookId, activeNoteId) : { title: <h2>在线文档</h2>, content: <WorkspaceNavigation /> }}
      toolbar={toolbar}
      sectionTitle={breadcrumb}
      contentLayout={editorLayout ? "document" : "page"}
      contextPanel={contextPanel ? <div className="document-context-shell">{contextPanel}{isContextOpen ? <ActionButton type="button" className="document-context-close" aria-label="收起上下文面板" onClick={() => setContextOpen(false)}><PanelRightClose aria-hidden="true" size={16} /></ActionButton> : null}</div> : undefined}
      contextOpen={isContextOpen}
      onOpenContext={isContextOpen ? undefined : () => { setContextOpen(true); onOpenContext?.(); }}
    >
      {editorLayout ? <EditorToolbarFrame>{children}</EditorToolbarFrame> : children}
    </WorkspaceShell>
  );
}

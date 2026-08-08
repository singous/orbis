import type { ReactNode } from "react";
import { PanelRightClose } from "lucide-react";
import { useEffect, useState } from "react";
import { useStore } from "zustand";

import { authStore } from "../../shared/auth/auth-store";
import { WorkspaceShell } from "../workspace/WorkspaceShell";
import { readDocumentContextOpen, writeDocumentContextOpen } from "./document-context-state";

type DocumentShellProps = {
  children: ReactNode;
  toolbar?: ReactNode;
  contextPanel?: ReactNode;
  contextOpen?: boolean;
  onOpenContext?: () => void;
  activeNotebookId?: string;
  activeNoteId?: string;
};

export function DocumentShell({ children, toolbar, contextPanel, contextOpen, onOpenContext }: DocumentShellProps) {
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
      toolbar={toolbar}
      contextPanel={contextPanel ? <div className="document-context-shell">{contextPanel}{isContextOpen ? <button type="button" className="document-context-close" aria-label="收起上下文面板" onClick={() => setContextOpen(false)}><PanelRightClose aria-hidden="true" size={15} /></button> : null}</div> : undefined}
      contextOpen={isContextOpen}
      onOpenContext={isContextOpen ? undefined : () => { setContextOpen(true); onOpenContext?.(); }}
    >
      {children}
    </WorkspaceShell>
  );
}

import type { ReactNode } from "react";

import { WorkspaceShell } from "../workspace/WorkspaceShell";

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
  return (
    <WorkspaceShell toolbar={toolbar} contextPanel={contextPanel} contextOpen={contextOpen} onOpenContext={onOpenContext}>
      {children}
    </WorkspaceShell>
  );
}
